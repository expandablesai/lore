import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createDb, type Db } from "@lore/db";
import type { FastifyInstance } from "fastify";
import { createApp } from "../app.ts";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://lore:lore@localhost:5432/lore_test";

describe("M2 memory: events hash-chain, T0-never-confirmed, forget cascade", () => {
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
      method: "POST", url: "/auth/signup",
      payload: { email: `m2-${suffix}@example.test`, password: "m2-password-1", displayName: "M2", orgName: `M2 Org ${suffix}` },
    });
    const body = r.json() as { token: string; user: { orgId: string } };
    token = body.token;
    orgId = body.user.orgId;
  });

  afterAll(async () => {
    await app.close();
    await db.$client.end({ timeout: 5 });
  });

  // ─── Events hash-chain ────────────────────────────────────────────────────

  test("POST /remember writes a hash-chained event", async () => {
    const r = await app.inject({
      method: "POST", url: "/remember",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        scope: "personal",
        subject: "hash-chain-test",
        predicate: "has",
        object: "event",
        sources: [{ type: "event", id: crypto.randomUUID() }],
        trust: 2,
      },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { id: string };
    expect(body.id).toBeTruthy();
  });

  test("events form a hash chain (prevHash links)", async () => {
    // Write two events and verify the chain
    const r1 = await app.inject({
      method: "POST", url: "/remember",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        scope: "personal", subject: "chain-1", predicate: "p", object: "o1",
        sources: [{ type: "event", id: crypto.randomUUID() }], trust: 1,
      },
    });
    expect(r1.statusCode).toBe(201);
    const r2 = await app.inject({
      method: "POST", url: "/remember",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        scope: "personal", subject: "chain-2", predicate: "p", object: "o2",
        sources: [{ type: "event", id: crypto.randomUUID() }], trust: 1,
      },
    });
    expect(r2.statusCode).toBe(201);
    // Verify chain integrity via direct DB query
    const { events } = await import("@lore/db/schema");
    const { eq, desc } = await import("drizzle-orm");
    const rows = await db.select({ prevHash: events.prevHash, hash: events.hash })
      .from(events).where(eq(events.orgId, orgId)).orderBy(desc(events.ts)).limit(2);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // The older event's hash should be the newer event's prevHash
    expect(rows[1]!.hash).toBe(rows[0]!.prevHash);
  });

  // ─── T0-never-confirmed ───────────────────────────────────────────────────

  test("POST /remember rejects trust=0 (T0 quarantined)", async () => {
    const r = await app.inject({
      method: "POST", url: "/remember",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        scope: "personal", subject: "t0-test", predicate: "p", object: "o",
        sources: [{ type: "event", id: crypto.randomUUID() }], trust: 0,
      },
    });
    expect(r.statusCode).toBe(400);
    const body = r.json() as { error: string };
    expect(body.error).toContain("T0");
  });

  test("POST /remember accepts trust=1 (T1 proposed)", async () => {
    const r = await app.inject({
      method: "POST", url: "/remember",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        scope: "personal", subject: "t1-test", predicate: "p", object: "o",
        sources: [{ type: "event", id: crypto.randomUUID() }], trust: 1,
      },
    });
    expect(r.statusCode).toBe(201);
  });

  // ─── Forget cascade ───────────────────────────────────────────────────────

  test("POST /forget returns a receipt", async () => {
    // First create an assertion
    const r1 = await app.inject({
      method: "POST", url: "/remember",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        scope: "personal", subject: "forget-test", predicate: "p", object: "o",
        sources: [{ type: "event", id: crypto.randomUUID() }], trust: 1,
      },
    });
    expect(r1.statusCode).toBe(201);
    const assertionId = (r1.json() as { id: string }).id;

    // Now forget it
    const r2 = await app.inject({
      method: "POST", url: "/forget",
      headers: { authorization: `Bearer ${token}` },
      payload: { id: assertionId, reason: "test cleanup" },
    });
    expect(r2.statusCode).toBe(200);
    const body = r2.json() as { forgotten: string; receipt: { by: string; reason: string; at: string } };
    expect(body.forgotten).toBe(assertionId);
    expect(body.receipt.reason).toBe("test cleanup");
    expect(body.receipt.at).toBeTruthy();
  });

  test("POST /forget on missing id returns 404", async () => {
    const r = await app.inject({
      method: "POST", url: "/forget",
      headers: { authorization: `Bearer ${token}` },
      payload: { id: crypto.randomUUID() },
    });
    expect(r.statusCode).toBe(404);
  });

  // ─── Recall ───────────────────────────────────────────────────────────────

  test("POST /recall returns assertions for the user", async () => {
    const r = await app.inject({
      method: "POST", url: "/recall",
      headers: { authorization: `Bearer ${token}` },
      payload: { scope: "personal" },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as Array<{ id: string; scope: string }>;
    expect(Array.isArray(body)).toBe(true);
  });
});
