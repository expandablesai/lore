import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type { Db } from "@lore/db";
import * as schema from "./schema.js";

/**
 * Per-request RLS context.
 *
 * Wraps queries in a transaction that SET LOCALs the session variables the
 * RLS policies read (`lore.org_id`, `lore.user_id`), so PostgreSQL enforces
 * tenant isolation at the row level regardless of application logic.
 */
export function withRls<T>(db: Db, orgId: string, userId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    await tx.execute(sql`SET LOCAL ROLE lore_app`);
    await tx.execute(sql`SELECT set_config('lore.org_id', ${orgId}, true)`);
    await tx.execute(sql`SELECT set_config('lore.user_id', ${userId}, true)`);
    return fn(tx);
  });
}
