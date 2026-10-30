// Applies the RLS provisioning batch (rlsUp) from ./src/rls.ts to DATABASE_URL.
// Run once against a freshly migrated database (CI's lore_test, or a local test DB).
// Not idempotent: CREATE ROLE/FUNCTION/POLICY statements fail if already applied.
import postgres from 'postgres';
import { rlsUp } from './src/rls.ts';

const url = process.env.DATABASE_URL ?? 'postgresql://lore:lore@localhost:5432/lore_test';
const db = postgres(url, { max: 1 });
try {
  await db.unsafe(rlsUp);
  console.log('rlsUp applied');
} finally {
  await db.end();
}
