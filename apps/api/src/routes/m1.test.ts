import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createDb, type Db } from "@lore/db";
import type { FastifyInstance } from "fastify";
import { createApp } from "../app.ts";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://lore:lore@localhost:5432/lore_test";

describe("M1 orgs/users/projects", () => {
  let db: Db;
  let app: FastifyInstance;
  let token: string;
  let orgId: string;
  let projectId: string;

  beforeAll(async () => {
    db = createDb(DATABASE_URL);
    app = createApp(db);
    await app.ready();
    const suffix = crypto.randomUUID().slice(0, 8);
    const r = await app.inject({
      method: "POST", url: "/auth/signup",
      payload: { email: `m1-${suffix}@example.test`, password: "m1-password-1", displayName: "M1", orgName: `M1 Org ${suffix}` },
    });
    const body = r.json() as { token: string; user: { orgId: string } };
    token = body.token;
    orgId = body.user.orgId;
  });

  afterAll(async () => {
    await app.close();
    await db.$client.end({ timeout: 5 });
  });

  test("GET /me returns the authenticated user", async () => {
    const r = await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${token}` } });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { email: string; role: string };
    expect(body.email).toContain("@example.test");
    expect(body.role).toBe("org_admin");
  });

  test("GET /me rejects missing token", async () => {
    const r = await app.inject({ method: "GET", url: "/me" });
    expect(r.statusCode).toBe(401);
  });

  test("GET /orgs lists the user's org", async () => {
    const r = await app.inject({ method: "GET", url: "/orgs", headers: { authorization: `Bearer ${token}` } });
    expect(r.statusCode).toBe(200);
    const orgs = r.json() as Array<{ id: string }>;
    expect(orgs.some((o) => o.id === orgId)).toBe(true);
  });

  test("GET /orgs/:id/users lists members", async () => {
    const r = await app.inject({ method: "GET", url: `/orgs/${orgId}/users`, headers: { authorization: `Bearer ${token}` } });
    expect(r.statusCode).toBe(200);
    const members = r.json() as Array<{ role: string }>;
    expect(members.length).toBeGreaterThanOrEqual(1);
    expect(members[0]!.role).toBe("org_admin");
  });

  test("POST /projects creates a project with creator as member", async () => {
    const r = await app.inject({
      method: "POST", url: "/projects",
      headers: { authorization: `Bearer ${token}` },
      payload: { orgId, name: "Test Project", slug: `tp-${crypto.randomUUID().slice(0, 6)}` },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { id: string; name: string };
    projectId = body.id;
    expect(body.name).toBe("Test Project");
  });

  test("GET /projects lists the user's projects", async () => {
    const r = await app.inject({ method: "GET", url: "/projects", headers: { authorization: `Bearer ${token}` } });
    expect(r.statusCode).toBe(200);
    const projects = r.json() as Array<{ id: string }>;
    expect(projects.some((p) => p.id === projectId)).toBe(true);
  });

  test("GET /projects/:id returns the project", async () => {
    const r = await app.inject({ method: "GET", url: `/projects/${projectId}`, headers: { authorization: `Bearer ${token}` } });
    expect(r.statusCode).toBe(200);
  });

  test("PATCH /me updates displayName", async () => {
    const r = await app.inject({
      method: "PATCH", url: "/me",
      headers: { authorization: `Bearer ${token}` },
      payload: { displayName: "Updated Name" },
    });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { displayName: string }).displayName).toBe("Updated Name");
  });
});
