import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { createDb, type Db } from "@lore/db";
import type { FastifyInstance } from "fastify";
import { createApp } from "../app.ts";

process.env.BLOBS_DIR ??= join(tmpdir(), "lore-blobs-test");

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://lore:lore@localhost:5432/lore_test";

/** Build a one-file multipart body (the route reads a single `file` part). */
function multipart(filename: string, content: string, mime: string, boundary: string): string {
  return [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    `Content-Type: ${mime}`,
    "",
    content,
    `--${boundary}--`,
  ].join("\r\n");
}

describe("M3 ingestion: document upload, dedupe, list, read, reprocess", () => {
  let db: Db;
  let app: FastifyInstance;
  let token: string;
  let orgId: string;

  beforeAll(async () => {
    db = createDb(DATABASE_URL);
    app = createApp(db);
    await app.ready();
    const suffix = crypto.randomUUID().slice(0, 8);
    const r = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: {
        email: `m3-${suffix}@example.test`,
        password: "m3-password-1",
        displayName: "M3",
        orgName: `M3 Org ${suffix}`,
      },
    });
    const body = r.json() as { token: string; user: { orgId: string } };
    token = body.token;
    orgId = body.user.orgId;
  });

  afterAll(async () => {
    await app.close();
    await db.$client.end({ timeout: 5 });
  });

  // ─── Upload ────────────────────────────────────────────────────────────────

  test("POST /documents/upload accepts a text file and returns 202", async () => {
    const content = "Hello, this is a test document for M3 ingestion.\nIt has multiple lines.\nEach line is content.";
    const boundary = "----M3TestBoundary123";
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="test.txt"',
      "Content-Type: text/plain",
      "",
      content,
      `--${boundary}--`,
    ].join("\r\n");

    const r = await app.inject({
      method: "POST",
      url: "/documents/upload",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    expect(r.statusCode).toBe(202);
    const json = r.json() as { id: string; status: string };
    expect(json.id).toBeTruthy();
    expect(json.status).toBe("queued");
  });

  test("POST /documents/upload deduplicates by SHA-256", async () => {
    const content = "Duplicate content test for dedupe verification.";
    const boundary = "----M3DedupeBoundary";
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="dupe.txt"',
      "Content-Type: text/plain",
      "",
      content,
      `--${boundary}--`,
    ].join("\r\n");

    // First upload
    const r1 = await app.inject({
      method: "POST",
      url: "/documents/upload",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    expect(r1.statusCode).toBe(202);
    const id1 = (r1.json() as { id: string }).id;

    // Second upload (same content)
    const r2 = await app.inject({
      method: "POST",
      url: "/documents/upload",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    expect(r2.statusCode).toBe(200);
    const json2 = r2.json() as { id: string; deduplicated: boolean };
    expect(json2.deduplicated).toBe(true);
    expect(json2.id).toBe(id1);
  });

  test("POST /documents/upload re-runs ingestion for a previously failed document", async () => {
    const content = `Failed ingestion recovery ${crypto.randomUUID()}`;
    const boundary = "----M3FailedRetry";
    const body = multipart("failed.txt", content, "text/plain", boundary);
    const post = () =>
      app.inject({
        method: "POST",
        url: "/documents/upload",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload: body,
      });

    const first = await post();
    expect(first.statusCode).toBe(202);
    const docId = (first.json() as { id: string }).id;

    // Simulate the worker having failed the document (a lost source blob does this).
    await db.execute(sql`UPDATE documents SET status = 'failed', error = 'boom' WHERE id = ${docId}::uuid`);

    const retry = await post();
    expect(retry.statusCode).toBe(202);
    const json = retry.json() as { id: string; status: string; reprocessed?: boolean };
    expect(json.id).toBe(docId);
    expect(json.status).toBe("queued");
    expect(json.reprocessed).toBe(true);

    // The row is usable again: queued, with the previous error cleared.
    const detail = await app.inject({
      method: "GET",
      url: `/documents/${docId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const doc = (detail.json() as { document: { status: string; error: string | null } }).document;
    expect(doc.status).toBe("queued");
    expect(doc.error).toBeNull();
  });

  test("POST /documents/:id/reprocess returns 409 when the stored blob is gone", async () => {
    const content = `Missing blob ${crypto.randomUUID()}`;
    const boundary = "----M3MissingBlob";
    const upload = await app.inject({
      method: "POST",
      url: "/documents/upload",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: multipart("gone.txt", content, "text/plain", boundary),
    });
    const docId = (upload.json() as { id: string }).id;

    const detail = await app.inject({
      method: "GET",
      url: `/documents/${docId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const storageKey = (detail.json() as { document: { storageKey: string } }).document.storageKey;
    await unlink(join(process.env.BLOBS_DIR as string, storageKey));

    const r = await app.inject({
      method: "POST",
      url: `/documents/${docId}/reprocess`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(409);
    expect((r.json() as { error: string }).error).toMatch(/upload the document again/i);
  });

  test("POST /documents/upload rejects unsupported MIME type", async () => {    const boundary = "----M3BadMime";
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="evil.exe"',
      "Content-Type: application/x-msdownload",
      "",
      "MZ...",
      `--${boundary}--`,
    ].join("\r\n");

    const r = await app.inject({
      method: "POST",
      url: "/documents/upload",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    expect(r.statusCode).toBe(415);
  });

  // ─── List ──────────────────────────────────────────────────────────────────

  test("GET /documents lists uploaded documents", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/documents",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    const json = r.json() as { documents: Array<{ id: string; filename: string; status: string }> };
    expect(Array.isArray(json.documents)).toBe(true);
    expect(json.documents.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Read ──────────────────────────────────────────────────────────────────

  test("GET /documents/:id returns document metadata", async () => {
    // Upload a fresh doc to get an ID
    const content = `Unique read test ${crypto.randomUUID()}`;
    const boundary = "----M3ReadTest";
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="read-test.txt"',
      "Content-Type: text/plain",
      "",
      content,
      `--${boundary}--`,
    ].join("\r\n");

    const upload = await app.inject({
      method: "POST",
      url: "/documents/upload",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    const docId = (upload.json() as { id: string }).id;

    const r = await app.inject({
      method: "GET",
      url: `/documents/${docId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    const json = r.json() as { document: { id: string; filename: string; mime: string; status: string }; chunks: unknown[] };
    expect(json.document.id).toBe(docId);
    expect(json.document.filename).toBe("read-test.txt");
    expect(json.document.mime).toBe("text/plain");
    expect(Array.isArray(json.chunks)).toBe(true);
  });

  test("GET /documents/:id returns 404 for missing document", async () => {
    const r = await app.inject({
      method: "GET",
      url: `/documents/${crypto.randomUUID()}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(404);
  });

  // ─── Reprocess ─────────────────────────────────────────────────────────────

  test("POST /documents/:id/reprocess returns 202", async () => {
    const content = `Reprocess test ${crypto.randomUUID()}`;
    const boundary = "----M3Reprocess";
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="reproc.txt"',
      "Content-Type: text/plain",
      "",
      content,
      `--${boundary}--`,
    ].join("\r\n");

    const upload = await app.inject({
      method: "POST",
      url: "/documents/upload",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    const docId = (upload.json() as { id: string }).id;

    const r = await app.inject({
      method: "POST",
      url: `/documents/${docId}/reprocess`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(202);
    const json = r.json() as { id: string; status: string };
    expect(json.id).toBe(docId);
    expect(json.status).toBe("queued");
  });

  // ─── Auth enforcement ──────────────────────────────────────────────────────

  test("document routes require authentication", async () => {
    const r = await app.inject({ method: "GET", url: "/documents" });
    expect(r.statusCode).toBe(401);
  });
});
