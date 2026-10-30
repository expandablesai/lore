import { eq, and } from "drizzle-orm";
import { projects, projectMembers, audit, type Db } from "@lore/db";
import type { FastifyPluginAsync } from "fastify";
import type { AuthenticatedUser } from "../plugins/auth-guard.ts";

const ROLE_RANK: Record<string, number> = { viewer: 0, member: 1, org_admin: 2, superadmin: 3 };

export const createProjectRoutes: (db: Db) => FastifyPluginAsync = (db) => async (app) => {
  app.addHook("preHandler", async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: "unauthorized" });
  });

  app.get("/projects", async (request) => {
    const rows = await db.select().from(projects)
      .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
      .where(eq(projectMembers.userId, request.user.id));
    return rows.map((r) => r.projects);
  });

  app.post<{ Body: { orgId: string; name: string; slug: string } }>(
    "/projects",
    async (request, reply) => {
      const { orgId, name, slug } = request.body;
      if (orgId !== request.user.orgId && (ROLE_RANK[request.user.role] ?? 0) < 3) {
        return reply.code(403).send({ error: "forbidden" });
      }
      const inserted = await db.insert(projects).values({ orgId, name, slug }).returning();
      const project = inserted[0];
      if (!project) throw new Error("project insert failed");
      await db.insert(projectMembers).values({ projectId: project.id, userId: request.user.id, role: "member" });
      await db.insert(audit).values({ orgId, actorId: request.user.id, action: "project.create", targetType: "project", targetIds: [project.id], ip: request.ip });
      return reply.code(201).send(project);
    },
  );

  app.get<{ Params: { id: string } }>("/projects/:id", async (request, reply) => {
    const rows = await db.select().from(projects).where(eq(projects.id, request.params.id)).limit(1);
    const project = rows[0];
    if (!project) return reply.code(404).send({ error: "not found" });
    const member = await db.select().from(projectMembers)
      .where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, request.user.id))).limit(1);
    if (!member[0] && project.orgId !== request.user.orgId) {
      return reply.code(403).send({ error: "forbidden" });
    }
    return project;
  });

  app.post<{ Params: { id: string }; Body: { userId: string; role: string } }>(
    "/projects/:id/members",
    async (request, reply) => {
      const { userId, role } = request.body;
      const inserted = await db.insert(projectMembers).values({
        projectId: request.params.id, userId, role: role as "member" | "viewer",
      }).onConflictDoNothing().returning();
      if (!inserted[0]) return reply.code(409).send({ error: "already a member" });
      await db.insert(audit).values({ orgId: request.user.orgId, actorId: request.user.id, action: "project.add-member", targetType: "project_member", targetIds: [request.params.id, userId], ip: request.ip });
      return reply.code(201).send({ projectId: request.params.id, userId, role });
    },
  );

  app.get<{ Params: { id: string } }>("/projects/:id/members", async (request) => {
    return db.select().from(projectMembers).where(eq(projectMembers.projectId, request.params.id));
  });
};
