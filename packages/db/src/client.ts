import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";

/**
 * Shared drizzle client factory.
 *
 * The API, the one-off RLS applier and the tests all need a connection; before
 * this each hand-rolled its own `postgres()` + `drizzle()` pair, so pool sizing
 * and schema wiring drifted between entrypoints.
 */

export const fallbackUrl = "postgresql://lore:lore@localhost:5432/lore";

export function resolveUrl(url?: string): string {
  return url ?? process.env.DATABASE_URL ?? fallbackUrl;
}

export function createDb(url?: string, max = 10) {
  const client = postgres(resolveUrl(url), { max });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
