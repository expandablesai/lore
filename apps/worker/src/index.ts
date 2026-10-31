import { PgBoss } from "pg-boss";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { createDb, type Db, type RevealedKey } from "@lore/db";
import {
  dominantEmbeddingModel,
  getDocumentChunks,
  updateDocumentStatus,
  insertChunks,
  insertEmbeddings,
  deleteDocumentDerived,
  orderEmbedKeys,
  pickVisionKey,
  revealActiveLlmKeys,
  listExtractingDocuments,
  failStuckDocuments,
  JOB_DOCUMENT_INGEST,
  JOB_DOCUMENT_REPROCESS,
  type DocumentIngestPayload,
  type DocumentReprocessPayload,
} from "@lore/db";
import { deterministicEmbed, zeroPad, vectorToPgText, HASH_MODEL, HASH_DIM, EMBEDDING_DIM } from "@lore/core";
import { createOpenAIEmbedder, createOpenAIVisioner } from "@lore/proxy";
import { extractByMime, type ExtractionResult } from "./extract.ts";

const SHUTDOWN_SIGNALS = ["SIGTERM", "SIGINT"] as const;

/** MIME types that carry pictures rather than text. */
const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * How many chunk texts travel in one /v1/embeddings call.
 *
 * Providers cap a request (OpenAI: 2,048 inputs / ~300k tokens), so sending a
 * whole book in one call is rejected outright and the document failed for good.
 * 64 keeps a request small enough for every provider and still amortises the
 * round trip.
 */
const EMBED_BATCH = 64;

/** Resolve a storage key to a local file path. */
function resolveStoragePath(storageKey: string): string {
  // Storage keys are relative paths under the blobs directory
  const blobsDir = process.env.BLOBS_DIR ?? "/srv/lore/blobs";
  return `${blobsDir}/${storageKey}`;
}

/** Read an image into indexable text.
 *
 * Nothing else in the pipeline can see a picture: there is no OCR step and the
 * text extractor refuses binary content. A vision model turns it into a
 * description, and that description becomes the document's text, so an image
 * can be found later by searching for what is in it.
 */
async function describeImage(
  db: ReturnType<typeof createDb>,
  orgId: string,
  buffer: Buffer,
  mime: string,
): Promise<ExtractionResult> {
  const keys = await revealActiveLlmKeys(db, orgId);
  const target = pickVisionKey(keys);
  if (!target) {
    throw new Error("no active LLM key can read images — add a key with a vision model");
  }
  const visioner = createOpenAIVisioner({
    apiKey: target.key.apiKey,
    baseUrl: target.key.baseUrl,
  });
  const description = await visioner.describe({
    model: target.model,
    imageDataUrl: `data:${mime};base64,${buffer.toString("base64")}`,
  });
  if (description === "") {
    throw new Error(`vision model ${target.model} returned no description`);
  }
  const { chunkText } = await import("@lore/core");
  return { pages: null, text: description, pageCount: null, chunks: chunkText(description) };
}

/** Vectors for a document's chunk texts, plus the space they belong to. */
export interface EmbeddedChunks {
  model: string;
  dim: number;
  vecs: Float32Array[];
}

/**
 * Which keys may produce this document's vectors.
 *
 * Three distinct situations, and conflating them is what broke ingestion:
 * - the org is indexed with local hash vectors, which are reproducible here, so
 *   it keeps indexing in that space (a key can never match "hash", so treating
 *   hash like a real stored model refused the *second* keyless upload forever);
 * - a real stored model pins the org to the key that can reproduce it, because
 *   vectors from different models are not comparable;
 * - no vectors yet: any embed-capable key will do, newest first.
 */
export type EmbedPlan =
  | { space: "hash" }
  | { space: "pinned"; key: RevealedKey }
  | { space: "candidates"; keys: RevealedKey[] }
  | { space: "blocked"; error: string };

export function planEmbedding(keys: RevealedKey[], storedModel: string | null): EmbedPlan {
  if (storedModel === HASH_MODEL) return { space: "hash" };
  const { matched, candidates } = orderEmbedKeys(keys, storedModel);
  if (storedModel) {
    return matched
      ? { space: "pinned", key: matched }
      : {
          space: "blocked",
          error: `no active key can embed with "${storedModel}", the model this org's vectors were indexed with — add a key using that model`,
        };
  }
  return candidates.length > 0 ? { space: "candidates", keys: candidates } : { space: "hash" };
}

function hashEmbed(texts: string[]): EmbeddedChunks {
  return {
    model: HASH_MODEL,
    dim: HASH_DIM,
    vecs: texts.map((text) => deterministicEmbed(text, HASH_DIM)),
  };
}

/** Embed with one key, in batches, insisting on one vector per input. */
async function embedWithKey(key: RevealedKey, texts: string[]): Promise<EmbeddedChunks> {
  const embedder = createOpenAIEmbedder({ apiKey: key.apiKey, baseUrl: key.baseUrl });
  const vecs: Float32Array[] = [];
  for (let start = 0; start < texts.length; start += EMBED_BATCH) {
    const batch = texts.slice(start, start + EMBED_BATCH);
    const got = await embedder.embed(batch, key.embedModel);
    // A short reply used to be papered over with zero vectors: those chunks were
    // reported as indexed, can never rank (a zero vector has no direction), and
    // are never retried. Fail the document instead, so it shows up as failed.
    if (got.length !== batch.length) {
      throw new Error(
        `embedder returned ${got.length} vectors for ${batch.length} inputs — refusing to index a partial reply`,
      );
    }
    for (const vec of got) {
      if (vec.length === 0) {
        throw new Error("embedder returned an empty vector");
      }
      vecs.push(vec);
    }
  }
  return { model: key.embedModel, dim: key.embedDim, vecs };
}

/**
 * Turn a document's chunk texts into vectors in the org's existing space.
 *
 * When the space is pinned, only the matching key is tried: silently falling
 * back to another model wrote vectors nothing could compare against, so the
 * document claimed "indexed" while being unretrievable.
 */
async function embedChunks(
  keys: RevealedKey[],
  storedModel: string | null,
  texts: string[],
): Promise<EmbeddedChunks> {
  const plan = planEmbedding(keys, storedModel);
  if (plan.space === "hash") return hashEmbed(texts);
  if (plan.space === "blocked") throw new Error(plan.error);

  const attempts = plan.space === "pinned" ? [plan.key] : plan.keys;
  let lastError: unknown = null;
  for (const key of attempts) {
    try {
      return await embedWithKey(key, texts);
    } catch (error) {
      // Configured-for-embedding but refuses the call (no /v1/embeddings, wrong
      // model name, unreachable host). Only worth another key when the org is
      // not already pinned to this one.
      lastError = error;
      console.warn(
        `embedding via ${key.baseUrl} (${key.embedModel}) failed:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  throw lastError instanceof Error ? lastError : new Error("every embedding key failed");
}

/** Core ingestion logic: extract → embed → write, atomically. */
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

    // Extract text by MIME type (images go through the org's vision model)
    const result = IMAGE_MIMES.has(mime)
      ? await describeImage(db, orgId, buffer, mime)
      : await extractByMime(buffer, mime);

    // A scan has no text layer; "indexed with 0 chunks" is a lie that also makes
    // the dedupe path treat the file as already handled.
    if (result.chunks.length === 0) {
      throw new Error(
        "no extractable text in this file — a scan or an image-only document has to be uploaded as an image",
      );
    }

    // Embed *before* touching the database. Everything that can fail (no key,
    // upstream refusal, short reply) fails here, while the previous index — for
    // a reprocess — is still intact.
    const keys = await revealActiveLlmKeys(db, orgId);
    const storedModel = await dominantEmbeddingModel(db, orgId);
    const embedded = await embedChunks(
      keys,
      storedModel,
      result.chunks.map((c) => c.text),
    );
    const vecBySeq = new Map(result.chunks.map((chunk, index) => [chunk.seq, embedded.vecs[index]]));

    const chunkRows = result.chunks.map((c) => ({
      documentId,
      orgId,
      seq: c.seq,
      text: c.text,
      tokens: c.tokens,
      pageFrom: c.pageFrom,
      pageTo: c.pageTo,
    }));

    // One transaction for the destructive part: delete, chunks, vectors and the
    // final status land together or not at all. Before this, a failure halfway
    // left committed chunks with missing vectors that retrieval would cite.
    await db.transaction(async (tx) => {
      // The transaction handle has the same query surface as Db; the helpers are
      // typed against Db so they can be used inside and outside a transaction.
      const scoped = tx as unknown as Db;
      await deleteDocumentDerived(scoped, documentId);
      await insertChunks(scoped, chunkRows);
      const stored = await getDocumentChunks(scoped, documentId);
      const embeddingRows = stored.map((chunk) => {
        const vec = vecBySeq.get(chunk.seq);
        if (!vec) throw new Error(`no vector for chunk ${chunk.seq}`);
        return {
          entityType: "chunk",
          entityId: chunk.id,
          model: embedded.model,
          dim: embedded.dim,
          vec: vectorToPgText(zeroPad(vec, EMBEDDING_DIM)),
        };
      });
      await insertEmbeddings(scoped, embeddingRows);
      await updateDocumentStatus(scoped, documentId, "indexed", {
        pageCount: result.pageCount ?? undefined,
      });
    });

    console.log(
      `document ${documentId} indexed: ${result.chunks.length} chunks, model ${embedded.model}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateDocumentStatus(db, documentId, "failed", { error: message });
    console.error(`document ${documentId} ingestion failed:`, message);
    throw err;
  }
}

/**
 * One document per job: a failure is recorded on the document row and the
 * worker moves on.
 *
 * Letting the error escape kills the process — pg-boss treats an unhandled job
 * error as fatal — and a single unindexable upload then stops ingestion for
 * every org until someone notices.
 */
async function runJob(
  db: ReturnType<typeof createDb>,
  job: { id: string; data: DocumentIngestPayload | DocumentReprocessPayload },
): Promise<void> {
  try {
    await ingestDocument(db, job.data);
  } catch (error) {
    console.error(
      `job ${job.id} (document ${job.data.documentId}) failed:`,
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * How long an extraction may sit untouched before it counts as abandoned.
 *
 * The window only has to cover the instant between writing `extracting` and the
 * job being visible as active in the queue, which is milliseconds; a minute is
 * all margin. Longer would leave a genuinely stuck document reading
 * "extracting" for no reason.
 */
export const STUCK_GRACE_MS = 60_000;

/** What a reader is told when their file was abandoned mid-extraction. */
export const STUCK_REASON =
  "the worker stopped while this file was being read — choose Reprocess to index it again";

/** How often the reaper looks for abandoned extractions. */
export const REAP_INTERVAL_MS = 60_000;

/**
 * Which `extracting` documents have nothing working on them.
 *
 * The queue is the source of truth: a document is only abandoned when no job
 * for it is queued, waiting to retry, or running. Anything else would fail a
 * document that another worker is merely busy with.
 */
export function orphanedExtractions(
  candidates: readonly { id: string }[],
  liveDocumentIds: ReadonlySet<string>,
): string[] {
  return candidates.filter((doc) => !liveDocumentIds.has(doc.id)).map((doc) => doc.id);
}

/**
 * Document ids that still have a job in the queue.
 *
 * pg-boss keeps completed and failed jobs for a week (`deletion_seconds`), so
 * only `created`, `retry` and `active` count as someone still working. A missing
 * queue schema is not an error here — it means no job has ever been enqueued, so
 * nothing is live.
 */
async function liveDocumentJobs(db: ReturnType<typeof createDb>): Promise<Set<string>> {
  const schema = process.env["BOSS_SCHEMA"] ?? "boss";
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) {
    throw new Error(`BOSS_SCHEMA "${schema}" is not a plain identifier`);
  }
  try {
    const rows = (await db.execute(
      sql.raw(
        `select distinct data->>'documentId' as id from ${schema}.job where state in ('created','retry','active')`,
      ),
    )) as unknown as { id: string | null }[];
    return new Set(rows.map((row) => row.id).filter((id): id is string => id !== null));
  } catch (error) {
    // 42P01: the queue has never been created in this database.
    if ((error as { code?: string }).code === "42P01") return new Set();
    throw error;
  }
}

/**
 * Close out documents a dead worker left in `extracting`.
 *
 * Run once at startup and then on a timer, because a document that is abandoned
 * while the worker is healthy is just as stuck as one abandoned by a crash.
 * Failures here must never take the worker down: the reaper is a safety net.
 */
export async function reconcileStuckExtractions(db: ReturnType<typeof createDb>): Promise<number> {
  const candidates = await listExtractingDocuments(db, STUCK_GRACE_MS);
  if (candidates.length === 0) return 0;
  const live = await liveDocumentJobs(db);
  const abandoned = orphanedExtractions(candidates, live);
  if (abandoned.length === 0) return 0;
  const failed = await failStuckDocuments(db, abandoned, STUCK_REASON);
  if (failed.length > 0) {
    console.warn(`reconciled ${failed.length} abandoned extraction(s): ${failed.join(", ")}`);
  }
  return failed.length;
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
      await runJob(db, job);
    }
  });

  await boss.work<DocumentReprocessPayload>(JOB_DOCUMENT_REPROCESS, async (jobs) => {
    for (const job of jobs) {
      await runJob(db, job);
    }
  });

  console.log("worker registered job handlers: document.ingest, document.reprocess");

  // Safety net for the row a crash leaves behind. The queue retries its own
  // jobs, but nothing revisits the document, which would read "extracting"
  // forever and make a re-upload look like a duplicate.
  const reap = () => {
    void reconcileStuckExtractions(db)
      .then((count) => {
        if (count > 0) console.log(`reaper: closed ${count} abandoned extraction(s)`);
      })
      .catch((error: unknown) => {
        console.error("reaper failed:", error instanceof Error ? error.message : error);
      });
  };
  reap();
  const reaper = setInterval(reap, REAP_INTERVAL_MS);
  // Never hold the process open just for the timer.
  reaper.unref();

  return boss;
}

// main guard: run the worker when this module is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startWorker().catch((error: unknown) => {
    console.error("worker failed to start", error);
    process.exit(1);
  });
}
