import { eq } from "drizzle-orm";
import { users, audit, type Db } from "@lore/db";
import type { FastifyPluginAsync } from "fastify";
import type { AuthenticatedUser } from "../plugins/auth-guard.ts";

const ROLE_RANK: Record<string, number> = { viewer: 0, member: 1, org_admin: 2, superadmin: 3 };

/** The stored theme choice; "system" until the reader picks one. */
async function themeOf(db: Db, userId: string): Promise<string> {
  const rows = await db.select({ theme: users.theme }).from(users).where(eq(users.id, userId)).limit(1);
  return rows[0]?.theme ?? "system";
}

/** Whether the neon lighting layer is on for this reader. */
async function neonOf(db: Db, userId: string): Promise<boolean> {
  const rows = await db.select({ neon: users.neon }).from(users).where(eq(users.id, userId)).limit(1);
  return rows[0]?.neon ?? false;
}

export const createUserRoutes: (db: Db) => FastifyPluginAsync = (db) => async (app) => {
  app.get("/me", async (request) => {
    const user = request.user;
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      orgId: user.orgId,
      status: user.status,
      theme: await themeOf(db, user.id),
      neon: await neonOf(db, user.id),
    };
  });

  app.patch<{ Body: { displayName?: string; theme?: string; neon?: boolean } }>("/me", async (request, reply) => {
    const { displayName, theme, neon } = request.body;
    if (theme !== undefined && !["light", "dark", "system"].includes(theme)) {
      return reply.code(400).send({ error: "theme must be light, dark or system" });
    }
    if (neon !== undefined && typeof neon !== "boolean") {
      return reply.code(400).send({ error: "neon must be a boolean" });
    }
    if (displayName || theme || neon !== undefined) {
      const set: Record<string, unknown> = {};
      if (displayName) set.displayName = displayName;
      if (theme) set.theme = theme;
      if (neon !== undefined) set.neon = neon;
      await db.update(users).set(set).where(eq(users.id, request.user.id));
      await db.insert(audit).values({ orgId: request.user.orgId, actorId: request.user.id, action: "user.update", targetType: "user", targetIds: [request.user.id], ip: request.ip });
    }
    const rows = await db.select().from(users).where(eq(users.id, request.user.id)).limit(1);
    const updated = rows[0]!;
    return {
      id: updated.id,
      email: updated.email,
      displayName: updated.displayName,
      role: updated.role,
      orgId: updated.orgId,
      theme: updated.theme,
      neon: updated.neon,
    };
  });

  app.patch<{ Params: { orgId: string; userId: string }; Body: { role?: string; status?: string } }>(
    "/orgs/:orgId/users/:userId",
    { preHandler: async (request, reply) => {
      const rank = ROLE_RANK[request.user.role] ?? 0;
      if (request.params.orgId !== request.user.orgId || rank < 2) {
        return reply.code(403).send({ error: "forbidden" });
      }
    }},
    async (request, reply) => {
      const { role, status } = request.body;
      const set: Record<string, unknown> = {};
      if (role) set.role = role;
      if (status) set.status = status;
      if (Object.keys(set).length === 0) return reply.code(400).send({ error: "no fields" });
      await db.update(users).set(set).where(eq(users.id, request.params.userId));
      await db.insert(audit).values({ orgId: request.params.orgId, actorId: request.user.id, action: "user.patch", targetType: "user", targetIds: [request.params.userId], detail: set, ip: request.ip });
      const rows = await db.select().from(users).where(eq(users.id, request.params.userId)).limit(1);
      const u = rows[0];
      if (!u) return reply.code(404).send({ error: "not found" });
      return { id: u.id, email: u.email, role: u.role, status: u.status };
    },
  );
};
