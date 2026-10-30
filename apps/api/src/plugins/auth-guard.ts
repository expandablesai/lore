import { eq, and, gt } from "drizzle-orm";
import { sessions, users, type Db } from "@lore/db";
import type { FastifyRequest, FastifyReply } from "fastify";
import { bearerFrom, hashToken } from "../auth-tokens.ts";

export type AuthenticatedUser = typeof users.$inferSelect;

export function requireAuth(db: Db) {
  return async function authPreHandler(request: FastifyRequest, reply: FastifyReply) {
    const token = bearerFrom(request.headers.authorization);
    if (!token) {
      return reply.code(401).send({ error: "missing bearer token" });
    }
    const rows = await db
      .select({ user: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(
        and(
          eq(sessions.tokenHash, hashToken(token)),
          gt(sessions.expiresAt, new Date()),
          eq(users.status, "active"),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) {
      return reply.code(401).send({ error: "invalid session" });
    }
    request.user = row.user;
  };
}
