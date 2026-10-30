import { and, eq, isNull } from "drizzle-orm";
import { orgLlmKeys } from "./schema.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import type { Db } from "./client.js";

/**
 * Per-org LLM provider keys. The API key is encrypted before it is stored and
 * is never returned by list queries — only revealLlmKey decrypts it, for the
 * request path that calls the upstream provider.
 */
export interface NewLlmKey {
  orgId: string;
  label: string;
  provider?: string;
  apiKey: string;
}

export function insertLlmKey(db: Db, input: NewLlmKey) {
  return db
    .insert(orgLlmKeys)
    .values({
      orgId: input.orgId,
      label: input.label,
      provider: input.provider ?? "openai",
      cipher: encryptSecret(input.apiKey),
    })
    .returning({
      id: orgLlmKeys.id,
      orgId: orgLlmKeys.orgId,
      label: orgLlmKeys.label,
      provider: orgLlmKeys.provider,
      createdAt: orgLlmKeys.createdAt,
    });
}

export function listLlmKeys(db: Db, orgId: string) {
  return db
    .select({
      id: orgLlmKeys.id,
      label: orgLlmKeys.label,
      provider: orgLlmKeys.provider,
      createdAt: orgLlmKeys.createdAt,
    })
    .from(orgLlmKeys)
    .where(and(eq(orgLlmKeys.orgId, orgId), isNull(orgLlmKeys.revokedAt)));
}

export function revokeLlmKey(db: Db, orgId: string, id: string) {
  return db
    .update(orgLlmKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(orgLlmKeys.id, id), eq(orgLlmKeys.orgId, orgId)))
    .returning({ id: orgLlmKeys.id });
}

/** Decrypt a stored key for the live request path. Never expose to a client. */
export async function revealLlmKey(db: Db, id: string): Promise<string | null> {
  const rows = await db
    .select({ cipher: orgLlmKeys.cipher })
    .from(orgLlmKeys)
    .where(and(eq(orgLlmKeys.id, id), isNull(orgLlmKeys.revokedAt)))
    .limit(1);
  const row = rows[0];
  return row ? decryptSecret(row.cipher) : null;
}
