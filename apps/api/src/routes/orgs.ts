import { eq, and, sql } from "drizzle-orm";
import { orgs, users, audit, type Db } from "@lore/db";
import type { FastifyPluginAsync } from "fastify";
import type { AuthenticatedUser } from "../plugins/auth-guard.ts";

declare module "fastify" {
  interface FastifyRequest { user: AuthenticatedUser; }
}

const ROLE_RANK: Record<string, number> = { viewer: 0, member: 1, org_admin: 2, superadmin: 3 };
/** Roles an org admin may hand out; superadmin crosses orgs and is excluded. */
const ASSIGNABLE_ROLES = new Set(["viewer", "member", "org_admin"]);
function hasRole(user: AuthenticatedUser, min: string): boolean {
  return (ROLE_RANK[user.role] ?? 0) >= (ROLE_RANK[min] ?? 99);
}

async function writeAudit(db: Db, actor: AuthenticatedUser, action: string, targetType: string, targetIds: string[], ip?: string) {
  await db.insert(audit).values({
    orgId: actor.orgId,
    actorId: actor.id,
    action,
    targetType,
    targetIds,
    ip,
  });
}

export const createOrgRoutes: (db: Db) => FastifyPluginAsync = (db) => async (app) => {
  app.addHook("preHandler", async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.get("/orgs", async (request) => {
    const rows = await db.select().from(orgs)
      .innerJoin(users, eq(users.orgId, orgs.id))
      .where(eq(users.id, request.user.id));
    return rows.map((r) => r.orgs);
  });

  app.post<{ Body: { name: string; slug: string } }>(
    "/orgs",
    { preHandler: async (request, reply) => { if (!hasRole(request.user, "superadmin")) return reply.code(403).send({ error: "forbidden" }); } },
    async (request, reply) => {
      const { name, slug } = request.body;
      const inserted = await db.insert(orgs).values({ name, slug }).returning({ id: orgs.id });
      const org = inserted[0];
      if (!org) throw new Error("org insert failed");
      await writeAudit(db, request.user, "org.create", "org", [org.id], request.ip);
      return reply.code(201).send(org);
    },
  );

  app.get<{ Params: { id: string } }>("/orgs/:id", async (request, reply) => {
    const rows = await db.select().from(orgs).where(eq(orgs.id, request.params.id)).limit(1);
    const org = rows[0];
    if (!org) return reply.code(404).send({ error: "not found" });
    if (org.id !== request.user.orgId && !hasRole(request.user, "superadmin")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    return org;
  });

  app.get<{ Params: { id: string } }>("/orgs/:id/users", async (request, reply) => {
    if (request.params.id !== request.user.orgId && !hasRole(request.user, "superadmin")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const members = await db.select({
      id: users.id, email: users.email, displayName: users.displayName,
      role: users.role, status: users.status,
    }).from(users).where(eq(users.orgId, request.params.id));
    return members;
  });

  app.post<{ Params: { id: string }; Body: { email: string; displayName: string; password: string; role: string } }>(
    "/orgs/:id/users",
    { preHandler: async (request, reply) => {
      if (request.params.id !== request.user.orgId || !hasRole(request.user, "org_admin")) {
        return reply.code(403).send({ error: "forbidden" });
      }
    }},
    async (request, reply) => {
      const { email, displayName, password, role } = request.body;
      // Creating a user is the other way to hand out a rank: the body used to be
      // cast straight into the enum, so an org admin could mint a superadmin and
      // log in as it. Only roles at or below the caller's own are creatable.
      const wanted = role ?? "member";
      if (!ASSIGNABLE_ROLES.has(wanted)) {
        return reply.code(400).send({ error: "role must be viewer, member or org_admin" });
      }
      if ((ROLE_RANK[wanted] ?? 0) > (ROLE_RANK[request.user.role] ?? 0)) {
        return reply.code(403).send({ error: "cannot create a user with a role above your own" });
      }
      const { hash } = await import("@node-rs/argon2");
      const passwordHash = await hash(password);
      const inserted = await db.insert(users).values({
        orgId: request.params.id, email, displayName, passwordHash,
        role: wanted as "member" | "viewer" | "org_admin",
      }).returning();
      const user = inserted[0];
      if (!user) throw new Error("user insert failed");
      await writeAudit(db, request.user, "user.create", "user", [user.id], request.ip);
      return reply.code(201).send({ id: user.id, email: user.email, role: user.role });
    },
  );
};
