import { and, eq, inArray, sql } from "drizzle-orm";
import { assertions, audit, chunks, documents, embeddings, revealActiveLlmKey, type Db, withRls, writeEvent } from "@lore/db";
import type { FastifyPluginAsync } from "fastify";
import type { AuthenticatedUser } from "../plugins/auth-guard.ts";
import { createOpenAIEmbedder } from "@lore/proxy";
import { deterministicEmbed, zeroPad, vectorToPgText, HASH_DIM, EMBEDDING_DIM } from "@lore/core";

const ROLE_RANK: Record<string, number> = { viewer: 0, member: 1, org_admin: 2, superadmin: 3 };

export const createMemoryRoutes: (db: Db) => FastifyPluginAsync = (db) => async (app) => {
  app.addHook("preHandler", async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: "unauthorized" });
  });

  app.post<{ Body: { scope: string; subject: string; predicate: string; object: string; sources: unknown[]; trust?: number } }>(
    "/remember",
    async (request, reply) => {
      const user = request.user;
      const { scope, subject, predicate, object, sources, trust } = request.body;
      if (!sources || sources.length === 0) {
        return reply.code(400).send({ error: "sources must be non-empty (provenance invariant)" });
      }
      if (scope === "personal" && !user) {
        return reply.code(400).send({ error: "personal scope requires owner" });
      }
      const trustLevel = trust ?? 1;
      // T0-never-confirmed: trust 0 items are quarantined and cannot be confirmed
      if (trustLevel === 0) {
        return reply.code(400).send({ error: "T0 quarantined items cannot be asserted (trust enforcement)" });
      }
      const inserted = await db.insert(assertions).values({
        orgId: user.orgId,
        scope: scope as "personal" | "project" | "org",
        subject, predicate, object,
        ownerUserId: user.id,
        sources,
        trust: trustLevel,
        status: "proposed",
      }).returning();
      const assertion = inserted[0];
      if (!assertion) throw new Error("assertion insert failed");
      // Write hash-chained event
      await writeEvent(db, user.orgId, {
        actorType: "user",
        actorId: user.id,
        surface: "memory",
        kind: "decision",
        payload: { action: "remember", assertionId: assertion.id, subject, predicate, object },
        trust: trustLevel,
      });
      await db.insert(audit).values({ orgId: user.orgId, actorId: user.id, action: "memory.remember", targetType: "assertion", targetIds: [assertion.id], ip: request.ip });
      return reply.code(201).send({ id: assertion.id, scope: assertion.scope, subject: assertion.subject, status: assertion.status });
    },
  );

  app.post<{ Body: { query?: string; scope?: string } }>(
    "/recall",
    async (request) => {
      const user = request.user;
      const { query, scope } = request.body;
      return withRls(db, user.orgId, user.id, async (tx) => {
        const conditions = [eq(assertions.orgId, user.orgId)];
        if (scope) conditions.push(eq(assertions.scope, scope as "personal" | "project" | "org"));
        if (query) {
          // Hybrid recall: lexical subject match OR semantic nearest source documents
          // (cosine over the caller's org chunk embeddings). Scoped to the caller's org.
          const key = await revealActiveLlmKey(db, user.orgId);
          const qvec = key
            ? zeroPad((await createOpenAIEmbedder({ apiKey: key.apiKey, baseUrl: key.baseUrl }).embed(query, key.embedModel))[0] ?? new Float32Array(EMBEDDING_DIM), EMBEDDING_DIM)
            : zeroPad(deterministicEmbed(query, HASH_DIM), EMBEDDING_DIM);
          const qtext = vectorToPgText(qvec ?? new Float32Array(EMBEDDING_DIM));
          conditions.push(
            sql`(${assertions.subject} % ${query} OR ${assertions.sourceDocIds} && (
              SELECT array_agg(x.document_id) FROM (
                SELECT c.document_id FROM embeddings e
                JOIN chunks c ON c.id = e.entity_id
                WHERE e.entity_type = 'chunk' AND c.org_id = ${user.orgId}
                ORDER BY e.vec <=> ${qtext}::vector
                LIMIT 50
              ) x
            ))`,
          );
        }
        return tx.select({
          id: assertions.id, scope: assertions.scope,
          subject: assertions.subject, predicate: assertions.predicate, object: assertions.object,
          status: assertions.status, trust: assertions.trust, confidence: assertions.confidence,
        }).from(assertions).where(and(...conditions)).limit(50);
      });
    },
  );

  app.post<{ Body: { id: string; reason?: string } }>(
    "/forget",
    async (request, reply) => {
      const user = request.user;
      const { id, reason } = request.body;
      const rows = await db.select({ id: assertions.id, ownerUserId: assertions.ownerUserId, orgId: assertions.orgId, sourceDocIds: assertions.sourceDocIds })
        .from(assertions).where(eq(assertions.id, id)).limit(1);
      const assertion = rows[0];
      if (!assertion) return reply.code(404).send({ error: "not found" });
      const rank = ROLE_RANK[user.role] ?? 0;
      if (assertion.ownerUserId !== user.id && rank < 2) {
        return reply.code(403).send({ error: "forbidden" });
      }
      // Forget cascade: delete assertion, then cascade to source documents and their chunks/embeddings
      await db.delete(assertions).where(eq(assertions.id, id));
      // Cascade across source_doc_ids: delete referenced documents, their chunks, and embeddings
      const docIds = assertion.sourceDocIds ?? [];
      if (docIds.length > 0) {
        // Delete chunks belonging to these documents
        await db.delete(chunks).where(inArray(chunks.documentId, docIds));
        // Delete embeddings referencing these documents as entities
        await db.delete(embeddings).where(inArray(embeddings.entityId, docIds));
        // Delete the documents themselves
        await db.delete(documents).where(inArray(documents.id, docIds));
      }
      // Write hash-chained event
      await writeEvent(db, user.orgId, {
        actorType: "user",
        actorId: user.id,
        surface: "memory",
        kind: "correction",
        payload: { action: "forget", assertionId: id, reason: reason ?? null, cascadedDocIds: docIds },
        trust: 2,
      });
      await db.insert(audit).values({ orgId: user.orgId, actorId: user.id, action: "memory.forget", targetType: "assertion", targetIds: [id], detail: { reason }, ip: request.ip });
      return { forgotten: id, receipt: { by: user.id, reason: reason ?? null, at: new Date().toISOString(), cascadedDocIds: docIds } };
    },
  );
};
