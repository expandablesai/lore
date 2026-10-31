/**
 * @lore/db documents — document, chunk, and embedding persistence.
 *
 * All operations use the drizzle Db instance. Tenant isolation is enforced
 * by RLS at the row level; callers wrap in withRls() where needed.
 */

import { eq, and, inArray, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { documents, chunks, embeddings } from "./schema.js";

/** Insert a new document row (status defaults to 'queued'). */
export async function insertDocument(
  db: Db,
  values: {
    orgId: string;
    projectId: string | null;
    ownerUserId: string | null;
    scope: "personal" | "project" | "org";
    filename: string;
    mime: string;
    sizeBytes: number;
    sha256: string;
    storageKey: string;
  },
): Promise<{ id: string }> {
  const rows = await db
    .insert(documents)
    .values(values)
    .returning({ id: documents.id });
  const doc = rows[0];
  if (!doc) throw new Error("document insert failed");
  return doc;
}

/** Check if a document with the same (orgId, sha256) already exists (dedupe). */
export async function findDocumentByHash(
  db: Db,
  orgId: string,
  sha256: string,
): Promise<{ id: string; status: string; storageKey: string } | null> {
  const rows = await db
    .select({ id: documents.id, status: documents.status, storageKey: documents.storageKey })
    .from(documents)
    .where(and(eq(documents.orgId, orgId), eq(documents.sha256, sha256)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Reset a document to 'queued' so an upload of the same bytes re-runs ingestion.
 *
 * Dedupe normally short-circuits a re-upload, but a document that failed has no
 * usable derived data — returning it as "already here" would strand the file in
 * a permanently failed state with nothing to click.
 */
export async function requeueDocument(db: Db, id: string): Promise<void> {
  await db
    .update(documents)
    .set({ status: "queued", error: null, extractedAt: null })
    .where(eq(documents.id, id));
}

/**
 * The embedding model most of this org's chunks were indexed with.
 *
 * Retrieval has to embed the query in the same vector space as the stored
 * chunks; mixing models inside one cosine scan silently returns noise.
 */
export async function dominantEmbeddingModel(db: Db, orgId: string): Promise<string | null> {
  const rows = await db
    .select({ model: embeddings.model, count: sql<number>`count(*)::int` })
    .from(embeddings)
    .innerJoin(chunks, eq(chunks.id, embeddings.entityId))
    .where(and(eq(embeddings.entityType, "chunk"), eq(chunks.orgId, orgId)))
    .groupBy(embeddings.model)
    .orderBy(sql`count(*) DESC`)
    .limit(1);
  return rows[0]?.model ?? null;
}

/** Get a document by id. */
export async function getDocument(
  db: Db,
  id: string,
): Promise<{
  id: string;
  orgId: string;
  scope: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
  status: string;
  pageCount: number | null;
  error: string | null;
} | null> {
  const rows = await db
    .select({
      id: documents.id,
      orgId: documents.orgId,
      scope: documents.scope,
      filename: documents.filename,
      mime: documents.mime,
      sizeBytes: documents.sizeBytes,
      sha256: documents.sha256,
      storageKey: documents.storageKey,
      status: documents.status,
      pageCount: documents.pageCount,
      error: documents.error,
    })
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** Update document status (and optionally pageCount, error, extractedAt). */
export async function updateDocumentStatus(
  db: Db,
  id: string,
  status: "queued" | "extracting" | "indexed" | "failed",
  extra?: { pageCount?: number; error?: string },
): Promise<void> {
  const values: Record<string, unknown> = { status };
  if (extra?.pageCount !== undefined) values.pageCount = extra.pageCount;
  if (extra?.error !== undefined) values.error = extra.error;
  if (status === "indexed" || status === "failed") {
    values.extractedAt = new Date();
  }
  await db.update(documents).set(values).where(eq(documents.id, id));
}

/** List documents for an org (paginated). */
export async function listDocuments(
  db: Db,
  orgId: string,
  limit: number = 50,
  offset: number = 0,
): Promise<Array<{
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  status: string;
  pageCount: number | null;
  error: string | null;
  createdAt: Date;
}>> {
  return db
    .select({
      id: documents.id,
      filename: documents.filename,
      mime: documents.mime,
      sizeBytes: documents.sizeBytes,
      status: documents.status,
      pageCount: documents.pageCount,
      error: documents.error,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(eq(documents.orgId, orgId))
    .orderBy(sql`${documents.createdAt} DESC`)
    .limit(limit)
    .offset(offset);
}

/** Insert chunks for a document. */
export async function insertChunks(
  db: Db,
  rows: Array<{
    documentId: string;
    orgId: string;
    seq: number;
    text: string;
    tokens: number;
    pageFrom: number | null;
    pageTo: number | null;
  }>,
): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(chunks).values(rows);
}

/** Insert embeddings for chunks (pgvector text format). */
export async function insertEmbeddings(
  db: Db,
  rows: Array<{
    entityType: string;
    entityId: string;
    model: string;
    dim: number;
    vec: string; // pgvector text format "[0.1,0.2,...]"
  }>,
): Promise<void> {
  if (rows.length === 0) return;
  // Use raw SQL for pgvector insertion (drizzle doesn't natively support vector literals)
  for (const row of rows) {
    await db.execute(sql`
      INSERT INTO embeddings (entity_type, entity_id, model, dim, vec)
      VALUES (${row.entityType}, ${row.entityId}::uuid, ${row.model}, ${row.dim}, ${row.vec}::vector)
      ON CONFLICT (entity_type, entity_id, model) DO UPDATE SET vec = ${row.vec}::vector, dim = ${row.dim}
    `);
  }
}

/** Get chunks for a document (ordered by seq). */
export async function getDocumentChunks(
  db: Db,
  documentId: string,
): Promise<Array<{
  id: string;
  seq: number;
  text: string;
  tokens: number;
  pageFrom: number | null;
  pageTo: number | null;
}>> {
  return db
    .select({
      id: chunks.id,
      seq: chunks.seq,
      text: chunks.text,
      tokens: chunks.tokens,
      pageFrom: chunks.pageFrom,
      pageTo: chunks.pageTo,
    })
    .from(chunks)
    .where(eq(chunks.documentId, documentId))
    .orderBy(chunks.seq);
}

/** Delete all chunks and embeddings for a document (used in reprocess). */
export async function deleteDocumentDerived(db: Db, documentId: string): Promise<void> {
  // Delete embeddings referencing this document's chunks as entities
  await db.execute(sql`
    DELETE FROM embeddings
    WHERE entity_type = 'chunk'
      AND entity_id IN (SELECT id FROM chunks WHERE document_id = ${documentId}::uuid)
  `);
  // Delete chunks
  await db.delete(chunks).where(eq(chunks.documentId, documentId));
}
