import { and, eq, inArray, sql } from "drizzle-orm";
import {
  assertions,
  audit,
  deleteDocumentDerived,
  documents,
  dominantEmbeddingModel,
  pickEmbedKey,
  revealActiveLlmKeys,
  type Db,
  withRls,
  writeEvent,
} from "@lore/db";
import type { FastifyPluginAsync } from "fastify";
import type { AuthenticatedUser } from "../plugins/auth-guard.ts";
import { createOpenAIEmbedder } from "@lore/proxy";
import { deterministicEmbed, zeroPad, vectorToPgText, HASH_DIM, EMBEDDING_DIM, HASH_MODEL } from "@lore/core";
import { PASSAGE_LIMIT, selectContext } from "../retrieval.js";

const ROLE_RANK: Record<string, number> = { viewer: 0, member: 1, org_admin: 2, superadmin: 3 };

/**
 * Embed a recall query in the space the org's chunks were indexed in.
 *
 * The key's embedding model decides the space and spaces are not comparable, so
 * the key is chosen by the *stored* model rather than by recency. Everything
 * that can go wrong on the way — no embed-capable key, a chat-only provider, a
 * gateway that answers 404 for a model it does not serve — degrades to the
 * local hash embedding: recall returning lexical matches is better than a 500,
 * which is what the newest-key shortcut produced here.
 */
async function recallVector(
  db: Db,
  orgId: string,
  query: string,
): Promise<{ text: string; model: string }> {
  const keys = await revealActiveLlmKeys(db, orgId);
  const key = pickEmbedKey(keys, await dominantEmbeddingModel(db, orgId));
  if (key) {
    try {
      const [vec] = await createOpenAIEmbedder({ apiKey: key.apiKey, baseUrl: key.baseUrl }).embed(
        query,
        key.embedModel,
      );
      if (vec) {
        return { text: vectorToPgText(zeroPad(vec, EMBEDDING_DIM)), model: key.embedModel };
      }
    } catch {
      // Unreachable or misconfigured embedder: fall back to the local space.
    }
  }
  return {
    text: vectorToPgText(zeroPad(deterministicEmbed(query, HASH_DIM), EMBEDDING_DIM)),
    model: HASH_MODEL,
  };
}

export const createMemoryRoutes: (db: Db) => FastifyPluginAsync = (db) => async (app) => {
  app.addHook("preHandler", async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: "unauthorized" });
  });

  /**
   * What the answer will be built from, before any answer is written.
   *
   * Read-only, and deliberately the same code path `/chat` uses (both call
   * `selectContext`), so it cannot describe a selection the product does not
   * make. Three lists come back: `selected` is what the model receives, `naive`
   * is the plain top-6 by cosine with no per-document cap, and `candidates` is
   * everything the ranking offered — the comparison the M4 benchmark measures,
   * available without reimplementing the ranking in the benchmark.
   *
   * It writes nothing, including no message and no fact.
   */
  app.get<{ Querystring: { q?: string } }>("/recall/context", async (request, reply) => {
    const user = request.user;
    const question = (request.query.q ?? "").trim();
    if (question === "") return reply.code(400).send({ error: "q is required" });
    if (question.length > 500) {
      return reply.code(400).send({ error: "q must be 500 characters or fewer" });
    }

    const context = await selectContext(db, {
      orgId: user.orgId,
      userId: user.id,
      question,
    });

    const describe = (row: (typeof context.candidates)[number], rank: number) => ({
      rank,
      documentId: row.documentId,
      filename: row.filename,
      mime: row.mime,
      distance: Number(row.distance.toFixed(6)),
      excerpt: row.text.replace(/\s+/g, " ").slice(0, 160),
    });

    return {
      question,
      model: context.model,
      askedForImage: context.askedForImage,
      candidateCount: context.candidates.length,
      facts: context.facts,
      selected: context.selected.map(describe),
      naive: context.candidates.slice(0, PASSAGE_LIMIT).map(describe),
      dropped: context.dropped,
    };
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
      // T0-never-confirmed: trust 0 items are quarantined and cannot be confirmed.
      // The upper bound matters too — assertions.trust has no CHECK, but the event
      // chain does (0..3), so an unchecked 4 inserted an assertion and then 500'd
      // on the event, leaving an orphan row behind.
      if (!Number.isInteger(trustLevel) || trustLevel < 1 || trustLevel > 3) {
        return reply
          .code(400)
          .send({ error: "trust must be an integer 1-3; T0 quarantined items cannot be asserted" });
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
          // Hybrid recall: lexical subject match OR semantic nearest source
          // documents (cosine over the caller's org chunk embeddings), scoped to
          // the caller's org and to one vector space. `coalesce(..., false)`
          // matters: with no embeddings in that space the array comparison is
          // NULL, which would swallow even the lexical half of the OR.
          const { text: qtext, model } = await recallVector(db, user.orgId, query);
          conditions.push(
            sql`(${assertions.subject} % ${query} OR coalesce(${assertions.sourceDocIds} && (
              SELECT array_agg(x.document_id) FROM (
                SELECT c.document_id FROM embeddings e
                JOIN chunks c ON c.id = e.entity_id
                WHERE e.entity_type = 'chunk' AND e.model = ${model} AND c.org_id = ${user.orgId}
                ORDER BY e.vec <=> ${qtext}::vector
                LIMIT 50
              ) x
            ), false))`,
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
      // Scoped by org: an id alone let org A's admin forget — and cascade-delete
      // the documents and vectors behind — an assertion belonging to org B.
      const rows = await db
        .select({
          id: assertions.id,
          ownerUserId: assertions.ownerUserId,
          orgId: assertions.orgId,
          sourceDocIds: assertions.sourceDocIds,
        })
        .from(assertions)
        .where(and(eq(assertions.id, id), eq(assertions.orgId, user.orgId)))
        .limit(1);
      const assertion = rows[0];
      if (!assertion) return reply.code(404).send({ error: "not found" });
      const rank = ROLE_RANK[user.role] ?? 0;
      if (assertion.ownerUserId !== user.id && rank < 2) {
        return reply.code(403).send({ error: "forbidden" });
      }
      // Forget cascade: delete assertion, then cascade to source documents and their chunks/embeddings
      await db.delete(assertions).where(and(eq(assertions.id, id), eq(assertions.orgId, user.orgId)));
      // Cascade across source_doc_ids: delete referenced documents, their chunks, and embeddings
      const docIds = assertion.sourceDocIds ?? [];
      const ownedDocs =
        docIds.length === 0
          ? []
          : await db
              .select({ id: documents.id })
              .from(documents)
              .where(and(inArray(documents.id, docIds), eq(documents.orgId, user.orgId)));
      for (const doc of ownedDocs) {
        // Embeddings are keyed by *chunk* id, so deleting them by document id
        // matched nothing and left the vectors searchable after a forget.
        await deleteDocumentDerived(db, doc.id);
        await db.delete(documents).where(and(eq(documents.id, doc.id), eq(documents.orgId, user.orgId)));
      }
      const cascaded = ownedDocs.map((doc) => doc.id);
      // Write hash-chained event
      await writeEvent(db, user.orgId, {
        actorType: "user",
        actorId: user.id,
        surface: "memory",
        kind: "correction",
        payload: { action: "forget", assertionId: id, reason: reason ?? null, cascadedDocIds: cascaded },
        trust: 2,
      });
      await db.insert(audit).values({ orgId: user.orgId, actorId: user.id, action: "memory.forget", targetType: "assertion", targetIds: [id], detail: { reason }, ip: request.ip });
      return { forgotten: id, receipt: { by: user.id, reason: reason ?? null, at: new Date().toISOString(), cascadedDocIds: cascaded } };
    },
  );
};
