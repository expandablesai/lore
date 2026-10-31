// M6 profile: a picture can be uploaded, served back to the org, replaced and
// removed; documents carry the metadata the capture screen reports.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createDb, type Db } from "@lore/db";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { createApp } from "../app.ts";

process.env.BLOBS_DIR ??= join(tmpdir(), "lore-blobs-avatar-test");
process.env.LORE_ENCRYPTION_KEY ??= "0".repeat(64);

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://lore:lore@localhost:5432/lore_test";

/** A one-pixel PNG, enough to prove the bytes round-trip. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function multipart(filename: string, content: Buffer, mime: string, boundary: string): string {
  return [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    `Content-Type: ${mime}`,
    "",
    content.toString("binary"),
    `--${boundary}--`,
  ].join("\r\n");
}

describe("M6 profile and document metadata", () => {
  let db: Db;
  let app: FastifyInstance;
  let token: string;
  let userId: string;

  beforeAll(async () => {
    db = createDb(DATABASE_URL);
    app = createApp(db);
    await app.ready();
    const suffix = crypto.randomUUID().slice(0, 8);
    const r = await app.inject({
      method: "POST", url: "/auth/signup",
      payload: { email: `m6-${suffix}@example.test`, password: "m6-password-1", displayName: "Ada Lovelace", orgName: `M6 Org ${suffix}` },
    });
    const body = r.json() as { token: string; user: { id: string } };
    token = body.token;
    userId = body.user.id;
  });

  afterAll(async () => {
    await app.close();
    await db.$client.end({ timeout: 5 });
  });

  test("a profile picture can be uploaded and served back", async () => {
    const boundary = "----M6Avatar";
    const upload = await app.inject({
      method: "POST", url: "/me/avatar",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: multipart("me.png", PNG, "image/png", boundary),
    });
    expect(upload.statusCode).toBe(201);
    expect((upload.json() as { hasAvatar: boolean }).hasAvatar).toBe(true);

    const me = await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${token}` } });
    expect((me.json() as { hasAvatar: boolean }).hasAvatar).toBe(true);

    const served = await app.inject({
      method: "GET", url: `/users/${userId}/avatar`, headers: { authorization: `Bearer ${token}` },
    });
    expect(served.statusCode).toBe(200);
    expect(served.headers["content-type"]).toContain("image/png");
  });

  test("an avatar is never served anonymously or across orgs", async () => {
    const anonymous = await app.inject({ method: "GET", url: `/users/${userId}/avatar` });
    expect(anonymous.statusCode).toBe(401);

    const suffix = crypto.randomUUID().slice(0, 8);
    const other = await app.inject({
      method: "POST", url: "/auth/signup",
      payload: { email: `m6-other-${suffix}@example.test`, password: "m6-password-2", displayName: "Other", orgName: `M6 Other ${suffix}` },
    });
    const otherToken = (other.json() as { token: string }).token;
    const foreign = await app.inject({
      method: "GET", url: `/users/${userId}/avatar`, headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(foreign.statusCode).toBe(404);
  });

  test("only images are accepted as a picture", async () => {
    const boundary = "----M6BadAvatar";
    const r = await app.inject({
      method: "POST", url: "/me/avatar",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: multipart("notes.txt", Buffer.from("hello"), "text/plain", boundary),
    });
    expect(r.statusCode).toBe(415);
  });

  test("removing the picture leaves the profile without one", async () => {
    const removed = await app.inject({
      method: "DELETE", url: "/me/avatar", headers: { authorization: `Bearer ${token}` },
    });
    expect(removed.statusCode).toBe(200);
    expect((removed.json() as { hasAvatar: boolean }).hasAvatar).toBe(false);

    const gone = await app.inject({
      method: "GET", url: `/users/${userId}/avatar`, headers: { authorization: `Bearer ${token}` },
    });
    expect(gone.statusCode).toBe(404);
  });

  test("documents report who saved them, when, and how many chunks", async () => {
    const boundary = "----M6Meta";
    await app.inject({
      method: "POST", url: "/documents/upload",
      headers: { authorization: `Bearer ${token}`, "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: multipart("meta.txt", Buffer.from("metadata check"), "text/plain", boundary),
    });

    const list = await app.inject({ method: "GET", url: "/documents", headers: { authorization: `Bearer ${token}` } });
    const docs = (list.json() as { documents: Array<{ filename: string; uploadedByName: string | null; chunkCount: number; createdAt: string }> }).documents;
    const doc = docs.find((d) => d.filename === "meta.txt");
    expect(doc?.uploadedByName).toBe("Ada Lovelace");
    expect(typeof doc?.chunkCount).toBe("number");
    expect(doc?.createdAt).toBeTruthy();
  });
});
