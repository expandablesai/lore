import { and, desc, eq, isNull } from "drizzle-orm";
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
  apiType?: string;
  baseUrl?: string;
  chatModel?: string;
  embedModel?: string;
  embedDim?: number;
  apiKey: string;
}

/** A decrypted key plus its live provider config for the request path. */
export interface RevealedKey {
  apiKey: string;
  apiType: string;
  baseUrl: string;
  chatModel: string;
  embedModel: string;
  embedDim: number;
}

export function insertLlmKey(db: Db, input: NewLlmKey) {
  return db
    .insert(orgLlmKeys)
    .values({
      orgId: input.orgId,
      label: input.label,
      provider: input.provider ?? "openai",
      apiType: input.apiType ?? "openai",
      baseUrl: input.baseUrl ?? "https://api.openai.com/v1",
      chatModel: input.chatModel ?? "gpt-4o",
      embedModel: input.embedModel ?? "text-embedding-3-large",
      embedDim: input.embedDim ?? 3072,
      cipher: encryptSecret(input.apiKey),
    })
    .returning({
      id: orgLlmKeys.id,
      orgId: orgLlmKeys.orgId,
      label: orgLlmKeys.label,
      provider: orgLlmKeys.provider,
      apiType: orgLlmKeys.apiType,
      baseUrl: orgLlmKeys.baseUrl,
      chatModel: orgLlmKeys.chatModel,
      embedModel: orgLlmKeys.embedModel,
      embedDim: orgLlmKeys.embedDim,
      createdAt: orgLlmKeys.createdAt,
    });
}

export function listLlmKeys(db: Db, orgId: string) {
  return db
    .select({
      id: orgLlmKeys.id,
      label: orgLlmKeys.label,
      provider: orgLlmKeys.provider,
      apiType: orgLlmKeys.apiType,
      baseUrl: orgLlmKeys.baseUrl,
      chatModel: orgLlmKeys.chatModel,
      embedModel: orgLlmKeys.embedModel,
      embedDim: orgLlmKeys.embedDim,
      createdAt: orgLlmKeys.createdAt,
    })
    .from(orgLlmKeys)
    .where(and(eq(orgLlmKeys.orgId, orgId), isNull(orgLlmKeys.revokedAt)))
    .orderBy(desc(orgLlmKeys.createdAt), desc(orgLlmKeys.id));
}

export function revokeLlmKey(db: Db, orgId: string, id: string) {
  return db
    .update(orgLlmKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(orgLlmKeys.id, id), eq(orgLlmKeys.orgId, orgId)))
    .returning({ id: orgLlmKeys.id });
}

/** Decrypt a stored key for the live request path. Never expose to a client. */
export async function revealLlmKey(db: Db, id: string): Promise<RevealedKey | null> {
  const rows = await db
    .select({
      cipher: orgLlmKeys.cipher,
      apiType: orgLlmKeys.apiType,
      baseUrl: orgLlmKeys.baseUrl,
      chatModel: orgLlmKeys.chatModel,
      embedModel: orgLlmKeys.embedModel,
      embedDim: orgLlmKeys.embedDim,
    })
    .from(orgLlmKeys)
    .where(and(eq(orgLlmKeys.id, id), isNull(orgLlmKeys.revokedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    apiKey: decryptSecret(row.cipher),
    apiType: row.apiType,
    baseUrl: row.baseUrl,
    chatModel: row.chatModel,
    embedModel: row.embedModel,
    embedDim: row.embedDim,
  };
}

/**
 * Decrypt every active key for an org, newest first.
 *
 * Order matters: adding a key is how an admin rotates providers, so "the key
 * I just added" is the expected default. Callers that need a *specific* model
 * (retrieval must reuse the embedding model the chunks were indexed with) look
 * it up through pickEmbedKey instead of taking the head of the list.
 */
export async function revealActiveLlmKeys(db: Db, orgId: string): Promise<RevealedKey[]> {
  const rows = await db
    .select({
      cipher: orgLlmKeys.cipher,
      apiType: orgLlmKeys.apiType,
      baseUrl: orgLlmKeys.baseUrl,
      chatModel: orgLlmKeys.chatModel,
      embedModel: orgLlmKeys.embedModel,
      embedDim: orgLlmKeys.embedDim,
    })
    .from(orgLlmKeys)
    .where(and(eq(orgLlmKeys.orgId, orgId), isNull(orgLlmKeys.revokedAt)))
    .orderBy(desc(orgLlmKeys.createdAt), desc(orgLlmKeys.id));
  return rows.map((row) => ({
    apiKey: decryptSecret(row.cipher),
    apiType: row.apiType,
    baseUrl: row.baseUrl,
    chatModel: row.chatModel,
    embedModel: row.embedModel,
    embedDim: row.embedDim,
  }));
}

/** Decrypt an org's newest active key; null when the org has none. */
export async function revealActiveLlmKey(db: Db, orgId: string): Promise<RevealedKey | null> {
  const keys = await revealActiveLlmKeys(db, orgId);
  return keys[0] ?? null;
}

/** The key that answers chat: the newest active key, whatever its models. */
export function pickChatKey(keys: RevealedKey[]): RevealedKey | null {
  return keys[0] ?? null;
}

/**
 * The key that turns text into vectors.
 *
 * Vectors from different embedding models are not comparable, so when an org
 * already holds vectors produced by `storedModel`, that model wins: retrieval
 * re-embeds the query in the same space instead of drifting into another one.
 * With no stored vectors yet, fall back to the newest key that can embed.
 */
export function pickEmbedKey(keys: RevealedKey[], storedModel: string | null): RevealedKey | null {
  if (storedModel) {
    const match = keys.find((key) => canEmbedKey(key) && key.embedModel === storedModel);
    return match ?? null;
  }
  return keys.find((key) => canEmbedKey(key)) ?? null;
}

/**
 * The order in which to try keys when *writing* vectors.
 *
 * `canEmbedKey` reads configuration, not capability: DeepSeek serves chat but
 * no `/v1/embeddings`, and a key configured with an embedding model it cannot
 * serve looks embeddable. Ingestion therefore tries the key that matches the
 * stored space first and the remaining ones after it, so one misconfigured key
 * cannot block indexing that another key could have done.
 *
 * `matched` is reported separately: when the org already has vectors, indexing
 * into any other space would make them incomparable, and the caller must refuse
 * rather than silently re-space the org.
 */
export function orderEmbedKeys(
  keys: RevealedKey[],
  storedModel: string | null,
): { matched: RevealedKey | null; candidates: RevealedKey[] } {
  const embeddable = keys.filter((key) => canEmbedKey(key));
  const matched = storedModel
    ? (embeddable.find((key) => key.embedModel === storedModel) ?? null)
    : null;
  const rest = embeddable.filter((key) => key !== matched);
  return { matched, candidates: matched ? [matched, ...rest] : rest };
}

/** Whether a revealed key can produce real embeddings (chat-only providers cannot). */
export function canEmbedKey(key: RevealedKey | null): boolean {
  return key !== null && key.apiType !== "anthropic" && key.embedModel !== "";
}
