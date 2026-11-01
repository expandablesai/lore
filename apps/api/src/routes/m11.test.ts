import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import {
  createDb,
  getDocumentChunks,
  insertChunks,
  insertDocument,
  insertEmbeddings,
  type Db,
} from "@lore/db";
import type { FastifyInstance } from "fastify";
import {
  deterministicEmbed,
  EMBEDDING_DIM,
  HASH_DIM,
  HASH_MODEL,
  vectorToPgText,
  zeroPad,
} from "@lore/core";
import { createApp } from "../app.ts";

// Storing an LLM key encrypts it, so the key material has to be present.
process.env.LORE_ENCRYPTION_KEY ??= "0".repeat(64);

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://lore:lore@localhost:5432/lore_test";

/**
 * M11 retrieval inspector: `GET /recall/context` shows the passages an answer
 * would be built from, without writing anything.
 *
 * It must be the *same* selection `/chat` makes — both call `selectContext` — so
 * what is asserted here is the per-document cap, the fact block, and that asking
 * what the model would see creates nothing.
 */
describe("M11 retrieval inspector", () => {
  let db: Db;
  let app: FastifyInstance;
  let token: string;
  let orgId: string;
  let userId: string;

  beforeAll(async () => {
    db = createDb(DATABASE_URL);
    app = createApp(db);
    await app.ready();
    const suffix = crypto.randomUUID().slice(0, 8);
    const r = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: {
        email: `m11-${suffix}@example.test`,
        password: "m11-password-1",
        displayName: "M11",
        orgName: `M11 Org ${suffix}`,
      },
    });
    const body = r.json() as { token: string; user: { id: string; orgId: string } };
    token = body.token;
    orgId = body.user.orgId;
    userId = body.user.id;

    // One document with five chunks, so the per-document cap has something to
    // drop. Vectors go into the local space, which is where an org with no
    // embed-capable key indexes and queries.
    const doc = await insertDocument(db, {
      orgId,
      projectId: null,
      ownerUserId: userId,
      scope: "org",
      filename: "screenplay.md",
      mime: "text/markdown",
      sizeBytes: 1024,
      sha256: `m11-${crypto.randomUUID()}`.replaceAll("-", ""),
      storageKey: `m11-${suffix}.md`,
    });

    const texts = [
      "the lighthouse keeper counts the ships at dusk",
      "the lighthouse keeper hides the ledger beneath the lamp",
      "the lighthouse keeper refuses to sell the tower",
      "a storm takes the bridge out at midnight",
      "the harbour master signs the register in winter",
    ];
    await insertChunks(
      db,
      texts.map((text, seq) => ({
        documentId: doc.id,
        orgId,
        seq,
        text,
        tokens: text.split(" ").length,
        pageFrom: null,
        pageTo: null,
      })),
    );
    const stored = await getDocumentChunks(db, doc.id);
    await insertEmbeddings(
      db,
      stored.map((chunk) => ({
        entityType: "chunk",
        entityId: chunk.id,
        model: HASH_MODEL,
        dim: HASH_DIM,
        vec: vectorToPgText(zeroPad(deterministicEmbed(chunk.text, HASH_DIM), EMBEDDING_DIM)),
      })),
    );
  });

  afterAll(async () => {
    await app.close();
    await db.$client.end({ timeout: 5 });
  });

  const inspect = (q: string) =>
    app.inject({
      method: "GET",
      url: `/recall/context?q=${encodeURIComponent(q)}`,
      headers: { authorization: `Bearer ${token}` },
    });

  test("an unauthenticated caller is refused", async () => {
    const r = await app.inject({ method: "GET", url: "/recall/context?q=lighthouse" });
    expect(r.statusCode).toBe(401);
  });

  test("a blank question is a 400, not an empty answer", async () => {
    const r = await inspect("   ");
    expect(r.statusCode).toBe(400);
    expect(r.json()).toEqual({ error: "q is required" });
  });

  test("an absurdly long question is refused before it is embedded", async () => {
    const r = await inspect("a".repeat(501));
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: string }).error).toContain("500 characters");
  });

  test("a question about the workspace shows the ranking, the naive top-6 and what the cap dropped", async () => {
    const r = await inspect("who keeps the lighthouse");
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      model: string;
      candidateCount: number;
      selected: { rank: number; filename: string }[];
      naive: { rank: number }[];
      dropped: { reason: string }[];
      facts: unknown[];
      askedForImage: boolean;
    };

    expect(body.model).toBe(HASH_MODEL);
    expect(body.askedForImage).toBe(false);
    expect(body.candidateCount).toBe(5);
    // Two passages from one document, even though it is the only document.
    expect(body.selected.length).toBe(2);
    expect(body.selected.every((row) => row.filename === "screenplay.md")).toBe(true);
    // The naive baseline takes the flat top-k, so it can fill up from one file.
    expect(body.naive.length).toBe(5);
    expect(body.dropped.length).toBeGreaterThan(0);
    expect(body.dropped.some((row) => row.reason.includes("2 passages"))).toBe(true);
    expect(body.facts).toEqual([]);
  });

  test("what the reader has stated about themselves travels with it", async () => {
    const remembered = await app.inject({
      method: "POST",
      url: "/remember",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        scope: "personal",
        subject: "the user",
        predicate: "name",
        object: "Mira",
        sources: [{ type: "event", id: crypto.randomUUID() }],
      },
    });
    expect(remembered.statusCode).toBe(201);

    const r = await inspect("who keeps the lighthouse");
    const body = r.json() as { facts: { predicate: string; object: string }[] };
    expect(body.facts).toContainEqual({ predicate: "name", object: "Mira" });
  });

  test("asking what the model would see creates no conversation and no message", async () => {
    const count = async (table: "chats" | "chat_messages") => {
      const rows = (await db.execute(
        sql`select count(*)::int as n from ${sql.raw(table)} where org_id = ${orgId}`,
      )) as unknown as { n: number }[];
      return rows[0]?.n ?? 0;
    };

    const chatsBefore = await count("chats");
    const messagesBefore = await count("chat_messages");
    await inspect("who keeps the lighthouse");
    expect(await count("chats")).toBe(chatsBefore);
    expect(await count("chat_messages")).toBe(messagesBefore);
  });
});
