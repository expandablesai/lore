import { eq, and } from "drizzle-orm";
import { projects, projectMembers, users, audit, type Db } from "@lore/db";
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

  /**
   * Add a member to a project.
   *
   * Every one of these checks was missing: any authenticated user of any org
   * could post their own id to any project id, and membership then satisfied
   * the read check, handing them the project and its member list.
   */
  app.post<{ Params: { id: string }; Body: { userId: string; role: string } }>(
    "/projects/:id/members",
    async (request, reply) => {
      const { userId, role } = request.body;
      if (role !== "member" && role !== "viewer") {
        return reply.code(400).send({ error: "role must be member or viewer" });
      }
      const project = (await db.select().from(projects).where(eq(projects.id, request.params.id)).limit(1))[0];
      if (!project || project.orgId !== request.user.orgId) {
        return reply.code(404).send({ error: "not found" });
      }
      const rank = ROLE_RANK[request.user.role] ?? 0;
      const member = (
        await db
          .select({ projectId: projectMembers.projectId })
          .from(projectMembers)
          .where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, request.user.id)))
          .limit(1)
      )[0];
      if (!member && rank < 2) {
        return reply.code(403).send({ error: "forbidden" });
      }
      // The target must belong to the same org, or the roster becomes a way to
      // pull a stranger into an org's project.
      const target = (
        await db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, userId), eq(users.orgId, request.user.orgId)))
          .limit(1)
      )[0];
      if (!target) return reply.code(404).send({ error: "user not found in this org" });

      const inserted = await db.insert(projectMembers).values({
        projectId: project.id, userId, role,
      }).onConflictDoNothing().returning();
      if (!inserted[0]) return reply.code(409).send({ error: "already a member" });
      await db.insert(audit).values({ orgId: request.user.orgId, actorId: request.user.id, action: "project.add-member", targetType: "project_member", targetIds: [project.id, userId], ip: request.ip });
      return reply.code(201).send({ projectId: project.id, userId, role });
    },
  );

  app.get<{ Params: { id: string } }>("/projects/:id/members", async (request, reply) => {
    const project = (await db.select().from(projects).where(eq(projects.id, request.params.id)).limit(1))[0];
    if (!project || project.orgId !== request.user.orgId) {
      return reply.code(404).send({ error: "not found" });
    }
    return db.select().from(projectMembers).where(eq(projectMembers.projectId, project.id));
  });
};
