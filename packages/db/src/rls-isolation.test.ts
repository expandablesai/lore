import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createDb, type Db, withRls } from "@lore/db";
import { assertions } from "@lore/db/schema";
import { eq, and } from "drizzle-orm";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://lore:lore@localhost:5432/lore_test";

describe("M2 cross-tenant RLS isolation", () => {
  let db: Db;
  let orgId: string;
  let userAId: string;
  let userBId: string;
  let assertionId: string;

  beforeAll(async () => {
    db = createDb(DATABASE_URL);
    const suffix = crypto.randomUUID().slice(0, 8);
    const org = await db.insert((await import("@lore/db")).orgs).values({
      name: `RLS Test ${suffix}`, slug: `rls-${suffix}`,
    }).returning({ id: (await import("@lore/db")).orgs.id });
    orgId = org[0]!.id;

    const { users } = await import("@lore/db");
    const a = await db.insert(users).values({
      orgId, email: `rls-a-${suffix}@example.test`, displayName: "A",
      passwordHash: "x", role: "member",
    }).returning({ id: users.id });
    userAId = a[0]!.id;
    const b = await db.insert(users).values({
      orgId, email: `rls-b-${suffix}@example.test`, displayName: "B",
      passwordHash: "x", role: "member",
    }).returning({ id: users.id });
    userBId = b[0]!.id;

    const ins = await db.insert(assertions).values({
      orgId, scope: "personal", ownerUserId: userAId,
      subject: "secret-of-A", predicate: "has", object: "favorite-color",
      sources: [{ type: "event", id: crypto.randomUUID() }],
      trust: 2, status: "confirmed",
    }).returning({ id: assertions.id });
    assertionId = ins[0]!.id;
  });

  afterAll(async () => {
    await db.delete(assertions).where(eq(assertions.orgId, orgId));
    const { users, orgs } = await import("@lore/db");
    await db.delete(users).where(eq(users.orgId, orgId));
    await db.delete(orgs).where(eq(orgs.id, orgId));
    await db.$client.end({ timeout: 5 });
  });

  test("user A sees own personal assertion", async () => {
    const rows = await withRls(db, orgId, userAId, (tx) =>
      tx.select({ id: assertions.id }).from(assertions)
        .where(and(eq(assertions.orgId, orgId), eq(assertions.scope, "personal")))
    );
    expect(rows.some((r) => r.id === assertionId)).toBe(true);
  });

  test("user B cannot read user A's personal assertion", async () => {
    const rows = await withRls(db, orgId, userBId, (tx) =>
      tx.select({ id: assertions.id }).from(assertions)
        .where(and(eq(assertions.orgId, orgId), eq(assertions.scope, "personal")))
    );
    expect(rows.some((r) => r.id === assertionId)).toBe(false);
  });
});
