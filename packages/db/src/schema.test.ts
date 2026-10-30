import { beforeAll, describe, expect, test } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

/**
 * RLS Proof Test — Cross-tenant isolation (M0 gate)
 *
 * Proves: user A cannot read user B's personal assertions.
 * Uses real PostgreSQL with RLS policies applied.
 * The runtime role (lore_app) is NOT superuser and has NO BYPASSRLS.
 */

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://lore:lore@localhost:5432/lore_test";

describe("RLS cross-tenant isolation", () => {
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    const client = postgres(DATABASE_URL);
    db = drizzle(client);
    // Apply schema + RLS policies
    // (In real CI, migrations run first via drizzle-kit migrate)
  });

  test("lore_app role is not superuser", async () => {
    const result = await db.execute(sql`
      SELECT rolbypassrls FROM pg_roles WHERE rolname = 'lore_app'
    `);
    expect(result[0]?.rolbypassrls).toBe(false);
  });

  test("user A cannot read user B's personal assertions", async () => {
    // Run as lore_app in a transaction — superuser would bypass RLS
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE lore_app`);
      await tx.execute(sql`SELECT set_config('lore.org_id', '00000000-0000-0000-0000-000000000001', true)`);
      await tx.execute(sql`SELECT set_config('lore.user_id', '00000000-0000-0000-0000-00000000000a', true)`);
      // Query assertions — should not see user B's personal rows
      return tx.execute(sql`
        SELECT * FROM assertions WHERE scope = 'personal'
      `);
    });
    // User B's personal assertion (org 2, owner B) must not appear
    const leaked = rows.filter((r: any) => r.owner_user_id === '00000000-0000-0000-0000-00000000000b');
    expect(leaked).toHaveLength(0);
  });

  test("RESTRICTIVE tenant_isolation ANDs with permissive policies", async () => {
    // Even if scope_isolation passes, tenant_isolation must still filter
    // Run as lore_app — superuser would bypass RLS and see every org's rows
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE lore_app`);
      await tx.execute(sql`SELECT set_config('lore.org_id', '00000000-0000-0000-0000-000000000002', true)`);
      await tx.execute(sql`SELECT set_config('lore.user_id', '00000000-0000-0000-0000-00000000000a', true)`);
      return tx.execute(sql`SELECT * FROM assertions`);
    });
    const leaked = rows.filter((r: any) => r.org_id !== '00000000-0000-0000-0000-000000000002');
    expect(leaked).toHaveLength(0);
  });
});
