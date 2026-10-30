import { eq, and, sql, inArray } from "drizzle-orm";
import { assertions, events, audit, type Db, withRls } from "@lore/db";
import type { FastifyPluginAsync } from "fastify";
import type { AuthenticatedUser } from "../plugins/auth-guard.ts";

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
      const inserted = await db.insert(assertions).values({
        orgId: user.orgId,
        scope: scope as "personal" | "project" | "org",
        subject, predicate, object,
        ownerUserId: user.id,
        sources,
        trust: trust ?? 1,
        status: "proposed",
      }).returning();
      const assertion = inserted[0];
      if (!assertion) throw new Error("assertion insert failed");
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
          conditions.push(sql`${assertions.subject} % ${query}`);
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
      const rows = await db.select({ id: assertions.id, ownerUserId: assertions.ownerUserId, orgId: assertions.orgId })
        .from(assertions).where(eq(assertions.id, id)).limit(1);
      const assertion = rows[0];
      if (!assertion) return reply.code(404).send({ error: "not found" });
      const rank = ROLE_RANK[user.role] ?? 0;
      if (assertion.ownerUserId !== user.id && rank < 2) {
        return reply.code(403).send({ error: "forbidden" });
      }
      await db.delete(assertions).where(eq(assertions.id, id));
      await db.insert(audit).values({ orgId: user.orgId, actorId: user.id, action: "memory.forget", targetType: "assertion", targetIds: [id], detail: { reason }, ip: request.ip });
      return { forgotten: id, receipt: { by: user.id, reason: reason ?? null, at: new Date().toISOString() } };
    },
  );
};
