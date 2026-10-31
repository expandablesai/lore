import { PgBoss } from "pg-boss";
import { readFile } from "node:fs/promises";
import { createDb } from "@lore/db";
import {
  canEmbedKey,
  dominantEmbeddingModel,
  updateDocumentStatus,
  insertChunks,
  insertEmbeddings,
  deleteDocumentDerived,
  pickEmbedKey,
  revealActiveLlmKeys,
  JOB_DOCUMENT_INGEST,
  JOB_DOCUMENT_REPROCESS,
  type DocumentIngestPayload,
  type DocumentReprocessPayload,
} from "@lore/db";
import { deterministicEmbed, zeroPad, vectorToPgText, HASH_MODEL, HASH_DIM, EMBEDDING_DIM } from "@lore/core";
import { createOpenAIEmbedder } from "@lore/proxy";
import { extractByMime } from "./extract.ts";

const SHUTDOWN_SIGNALS = ["SIGTERM", "SIGINT"] as const;

/** Resolve a storage key to a local file path. */
function resolveStoragePath(storageKey: string): string {
  // Storage keys are relative paths under the blobs directory
  const blobsDir = process.env.BLOBS_DIR ?? "/srv/lore/blobs";
  return `${blobsDir}/${storageKey}`;
}

/** Core ingestion logic: extract → chunk → embed → persist. */
async function ingestDocument(
  db: ReturnType<typeof createDb>,
  payload: DocumentIngestPayload | DocumentReprocessPayload,
): Promise<void> {
  const { documentId, orgId, storageKey, mime } = payload;

  await updateDocumentStatus(db, documentId, "extracting");

  try {
    // Read blob from disk
    const filePath = resolveStoragePath(storageKey);
    const buffer = await readFile(filePath);

    // Extract text by MIME type
    const result = await extractByMime(buffer, mime);

    // Clear previous derived data (for reprocess)
    await deleteDocumentDerived(db, documentId);

    // Insert chunks
    const chunkRows = result.chunks.map((c) => ({
      documentId,
      orgId,
      seq: c.seq,
      text: c.text,
      tokens: c.tokens,
      pageFrom: c.pageFrom,
      pageTo: c.pageTo,
    }));
    await insertChunks(db, chunkRows);

    // Embed chunks: real vectors when the key can embed, else deterministic hash.
    // The key is chosen to match the model the org's existing vectors came from,
    // so a new document lands in the same space as the ones already indexed.
    const embeddingRows: Array<{
      entityType: string;
      entityId: string;
      model: string;
      dim: number;
      vec: string;
    }> = [];

    // We need chunk IDs — re-query them
    const { getDocumentChunks } = await import("@lore/db");
    const storedChunks = await getDocumentChunks(db, documentId);

    const keys = await revealActiveLlmKeys(db, orgId);
    const storedModel = await dominantEmbeddingModel(db, orgId);
    const key = pickEmbedKey(keys, storedModel);
    if (key && canEmbedKey(key)) {
      const embedder = createOpenAIEmbedder({ apiKey: key.apiKey, baseUrl: key.baseUrl });
      const vecs = await embedder.embed(storedChunks.map((c) => c.text), key.embedModel);
      for (let i = 0; i < storedChunks.length; i++) {
        const chunk = storedChunks[i];
        if (!chunk) continue;
        embeddingRows.push({
          entityType: "chunk",
          entityId: chunk.id,
          model: key.embedModel,
          dim: key.embedDim,
          vec: vectorToPgText(zeroPad(vecs[i] ?? new Float32Array(key.embedDim), EMBEDDING_DIM)),
        });
      }
    } else {
      for (const chunk of storedChunks) {
        const vec = deterministicEmbed(chunk.text, HASH_DIM);
        const padded = zeroPad(vec, EMBEDDING_DIM);
        embeddingRows.push({
          entityType: "chunk",
          entityId: chunk.id,
          model: HASH_MODEL,
          dim: HASH_DIM,
          vec: vectorToPgText(padded),
        });
      }
    }
    await insertEmbeddings(db, embeddingRows);

    // Mark indexed
    await updateDocumentStatus(db, documentId, "indexed", {
      pageCount: result.pageCount ?? undefined,
    });

    console.log(`document ${documentId} indexed: ${result.chunks.length} chunks, ${embeddingRows.length} embeddings`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateDocumentStatus(db, documentId, "failed", { error: message });
    console.error(`document ${documentId} ingestion failed:`, message);
    throw err;
  }
}

export async function startWorker(): Promise<PgBoss> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const db = createDb(databaseUrl);
  const boss = new PgBoss({ connectionString: databaseUrl, schema: "boss" });

  for (const signal of SHUTDOWN_SIGNALS) {
    process.on(signal, () => {
      console.log(`worker received ${signal} — draining in-flight jobs`);
      void boss
        .stop()
        .then(() => process.exit(0))
        .catch((error: unknown) => {
          console.error("worker shutdown failed", error);
          process.exit(1);
        });
    });
  }

  await boss.start();
  console.log("worker ready");

  // Register ingestion job handlers
  await boss.createQueue(JOB_DOCUMENT_INGEST);
  await boss.createQueue(JOB_DOCUMENT_REPROCESS);

  await boss.work<DocumentIngestPayload>(JOB_DOCUMENT_INGEST, async (jobs) => {
    for (const job of jobs) {
      await ingestDocument(db, job.data);
    }
  });

  await boss.work<DocumentReprocessPayload>(JOB_DOCUMENT_REPROCESS, async (jobs) => {
    for (const job of jobs) {
      await ingestDocument(db, job.data);
    }
  });

  console.log("worker registered job handlers: document.ingest, document.reprocess");
  return boss;
}

// main guard: run the worker when this module is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startWorker().catch((error: unknown) => {
    console.error("worker failed to start", error);
    process.exit(1);
  });
}
