/**
 * @lore/db jobs — pg-boss queue setup and job dispatch helpers.
 *
 * pg-boss owns its own tables inside the same PostgreSQL instance.
 * The API sends jobs; the worker handles them.
 */

import { PgBoss } from "pg-boss";
import { resolveUrl } from "./client.js";

/** Job name constants — single source of truth. */
export const JOB_DOCUMENT_INGEST = "document.ingest";
export const JOB_DOCUMENT_REPROCESS = "document.reprocess";

/** Payload for document.ingest jobs. */
export interface DocumentIngestPayload {
  documentId: string;
  orgId: string;
  storageKey: string;
  mime: string;
}

/** Payload for document.reprocess jobs. */
export interface DocumentReprocessPayload {
  documentId: string;
  orgId: string;
  storageKey: string;
  mime: string;
}

/**
 * Create a pg-boss instance connected to the same database.
 * Uses the `boss` schema to keep its tables namespaced.
 */
export function createBoss(databaseUrl?: string): PgBoss {
  const connectionString = resolveUrl(databaseUrl);
  return new PgBoss({ connectionString, schema: "boss" });
}

/**
 * Send a document ingestion job.
 * Called by the API after a successful upload.
 */
export async function sendDocumentIngest(
  boss: PgBoss,
  payload: DocumentIngestPayload,
): Promise<string | null> {
  return boss.send(JOB_DOCUMENT_INGEST, payload);
}

/**
 * Send a document reprocess job.
 * Called when a failed or stale document needs re-extraction.
 */
export async function sendDocumentReprocess(
  boss: PgBoss,
  payload: DocumentReprocessPayload,
): Promise<string | null> {
  return boss.send(JOB_DOCUMENT_REPROCESS, payload);
}
