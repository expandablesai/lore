/**
 * @lore/api documents routes — upload, list, read, reprocess.
 *
 * Upload: multipart file → SHA-256 dedupe → store blob → queue ingestion.
 * All routes require authentication (session or bearer).
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import type { Db } from "@lore/db";
import {
  insertDocument,
  findDocumentByHash,
  getDocument,
  listDocuments,
  getDocumentChunks,
  requeueDocument,
  revealActiveLlmKeys,
  sendDocumentIngest,
  sendDocumentReprocess,
  createBoss,
  JOB_DOCUMENT_INGEST,
  JOB_DOCUMENT_REPROCESS,
} from "@lore/db";
import type { FastifyPluginAsync } from "fastify";
import type { AuthenticatedUser } from "../plugins/auth-guard.ts";

/** MIME type allowlist for ingestion. */
const ALLOWED_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
  "text/markdown",
  "text/html",
]);

/**
 * Images are indexed by describing them with the org's vision model, so they
 * are only accepted from an org that has a key to describe them with — nothing
 * else in the pipeline can read a picture.
 */
const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Resolve the blobs directory from environment. */
function blobsDir(): string {
  return process.env.BLOBS_DIR ?? "/srv/lore/blobs";
}

/** Map file extension to MIME type (fallback from multipart detection). */
function mimeFromExtension(ext: string): string | null {
  const map: Record<string, string> = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".csv": "text/csv",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".html": "text/html",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  };
  return map[ext.toLowerCase()] ?? null;
}
export const createDocumentRoutes: (db: Db) => FastifyPluginAsync = (db) => async (app) => {
  // Shared boss instance for job dispatch (lazy-initialized)
  let boss: ReturnType<typeof createBoss> | null = null;
  const getBoss = async () => {
    if (!boss) {
      boss = createBoss();
      await boss.start();
      // pg-boss v12 requires queues to exist before send()
      await boss.createQueue(JOB_DOCUMENT_INGEST);
      await boss.createQueue(JOB_DOCUMENT_REPROCESS);
    }
    return boss;
  };

  // POST /documents/upload — multipart file upload
  app.post<{
    Body: { scope?: string };
  }>("/upload", async (request, reply) => {
    const user = request.user as AuthenticatedUser;
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const scope = (request.body?.scope ?? "personal") as "personal" | "project" | "org";

    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: "multipart file required" });
    }

    // Determine MIME type
    const mime = file.mimetype || mimeFromExtension(extname(file.filename)) || "application/octet-stream";
    if (IMAGE_MIMES.has(mime)) {
      const keys = await revealActiveLlmKeys(db, user.orgId);
      if (keys.length === 0) {
        return reply.code(415).send({
          error:
            "an image is indexed by having a vision model describe it, and this org has no LLM key — add a key with a vision model, then upload again",
        });
      }
    } else if (!ALLOWED_MIMES.has(mime)) {
      return reply.code(415).send({ error: `unsupported MIME type: ${mime}` });
    }

    // Read file buffer and compute SHA-256
    const buffer = await file.toBuffer();
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const sizeBytes = buffer.length;

    // Dedupe: same bytes already uploaded to this org
    const existing = await findDocumentByHash(db, user.orgId, sha256);
    if (existing) {
      const blobPresent = existsSync(join(blobsDir(), existing.storageKey));
      if (existing.status !== "failed" && blobPresent) {
        return reply.code(200).send({
          id: existing.id,
          deduplicated: true,
          status: existing.status,
        });
      }
      // The stored copy never produced usable derived data (ingestion failed,
      // or the blob was lost). Returning it as "already here" would strand the
      // file permanently, so restore the blob and run the pipeline again.
      await mkdir(blobsDir(), { recursive: true });
      const retryPath = join(blobsDir(), existing.storageKey);
      await writeFile(retryPath, buffer);
      await requeueDocument(db, existing.id);
      const retryBoss = await getBoss();
      await sendDocumentIngest(retryBoss, {
        documentId: existing.id,
        orgId: user.orgId,
        storageKey: existing.storageKey,
        mime,
      });
      return reply.code(202).send({ id: existing.id, status: "queued", reprocessed: true });
    }

    // Store blob to disk
    const dir = blobsDir();
    await mkdir(dir, { recursive: true });
    const storageKey = `${sha256}${extname(file.filename)}`;
    const filePath = join(dir, storageKey);
    await writeFile(filePath, buffer);

    // Insert document row
    const doc = await insertDocument(db, {
      orgId: user.orgId,
      projectId: null,
      ownerUserId: user.id,
      uploadedBy: user.id,
      scope,
      filename: file.filename,
      mime,
      sizeBytes,
      sha256,
      storageKey,
    });

    // Enqueue ingestion job
    const bossInstance = await getBoss();
    await sendDocumentIngest(bossInstance, {
      documentId: doc.id,
      orgId: user.orgId,
      storageKey,
      mime,
    });

    return reply.code(202).send({ id: doc.id, status: "queued" });
  });

  // GET /documents — list org documents
  app.get<{
    Querystring: { limit?: string; offset?: string };
  }>("/", async (request, reply) => {
    const user = request.user as AuthenticatedUser;
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const limit = Math.min(Number(request.query.limit ?? 50) || 50, 200);
    const offset = Number(request.query.offset ?? 0) || 0;

    const docs = await listDocuments(db, user.orgId, limit, offset);
    return reply.send({ documents: docs });
  });

  // GET /documents/:id — read document metadata + chunks
  app.get<{
    Params: { id: string };
  }>("/:id", async (request, reply) => {
    const user = request.user as AuthenticatedUser;
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const doc = await getDocument(db, request.params.id);
    if (!doc) return reply.code(404).send({ error: "not found" });
    if (doc.orgId !== user.orgId) return reply.code(403).send({ error: "forbidden" });

    const chunks = await getDocumentChunks(db, doc.id);
    return reply.send({ document: doc, chunks });
  });

  // GET /documents/:id/blob — stream the stored file itself
  app.get<{
    Params: { id: string };
  }>("/:id/blob", async (request, reply) => {
    const user = request.user as AuthenticatedUser;
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const doc = await getDocument(db, request.params.id);
    if (!doc) return reply.code(404).send({ error: "not found" });
    if (doc.orgId !== user.orgId) return reply.code(403).send({ error: "forbidden" });

    const filePath = join(blobsDir(), doc.storageKey);
    if (!existsSync(filePath)) {
      return reply.code(410).send({ error: "the stored file is no longer available" });
    }

    const data = await readFile(filePath);
    return reply
      .header("content-type", doc.mime)
      .header("content-length", String(data.length))
      .header("content-disposition", `inline; filename="${doc.filename.replace(/["\\]/g, "")}"`)
      .header("cache-control", "private, max-age=300")
      .send(data);
  });

  // POST /documents/:id/reprocess — re-trigger ingestion
  app.post<{
    Params: { id: string };
  }>("/:id/reprocess", async (request, reply) => {
    const user = request.user as AuthenticatedUser;
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const doc = await getDocument(db, request.params.id);
    if (!doc) return reply.code(404).send({ error: "not found" });
    if (doc.orgId !== user.orgId) return reply.code(403).send({ error: "forbidden" });

    // Reprocess re-reads the stored blob, so a document whose source is gone
    // would fail again with an opaque ENOENT. Say what to do instead.
    if (!existsSync(join(blobsDir(), doc.storageKey))) {
      return reply.code(409).send({
        error: "source file is no longer stored — upload the document again to re-index it",
      });
    }

    const bossInstance = await getBoss();
    await sendDocumentReprocess(bossInstance, {
      documentId: doc.id,
      orgId: user.orgId,
      storageKey: doc.storageKey,
      mime: doc.mime,
    });

    return reply.code(202).send({ id: doc.id, status: "queued" });
  });
};
