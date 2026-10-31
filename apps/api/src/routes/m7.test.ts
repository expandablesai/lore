// M7 tenant isolation: an id in a request body or path never widens what the
// caller may touch. These are the regression tests for the holes that let one
// org read, mutate or spend another org's rows.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createDb, type Db } from "@lore/db";
import type { FastifyInstance } from "fastify";
import { createApp } from "../app.ts";

process.env.LORE_ENCRYPTION_KEY ??= "0".repeat(64);

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://lore:lore@localhost:5432/lore_test";

async function signup(app: FastifyInstance, tag: string) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const r = await app.inject({
    method: "POST",
    url: "/auth/signup",
    payload: {
      email: `${tag}-${suffix}@example.test`,
      password: `${tag}-password-1`,
      displayName: tag.toUpperCase(),
      orgName: `${tag} Org ${suffix}`,
    },
  });
  const body = r.json() as { token: string; user: { id: string; orgId: string; role: string } };
  return body;
}

describe("M7 tenant isolation", () => {
  let db: Db;
  let app: FastifyInstance;
  let a: Awaited<ReturnType<typeof signup>>;
  let b: Awaited<ReturnType<typeof signup>>;

  beforeAll(async () => {
    db = createDb(DATABASE_URL);
    app = createApp(db);
    await app.ready();
    a = await signup(app, "m7a");
    b = await signup(app, "m7b");
  });

  afterAll(async () => {
    await app.close();
    await db.$client.end({ timeout: 5 });
  });

  test("an org admin cannot promote themselves to superadmin", async () => {
    const r = await app.inject({
      method: "PATCH",
      url: `/orgs/${a.user.orgId}/users/${a.user.id}`,
      headers: { authorization: `Bearer ${a.token}` },
      payload: { role: "superadmin" },
    });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: string }).error).toContain("role");
  });

  test("a role within the caller's own rank is still assignable", async () => {
    const r = await app.inject({
      method: "PATCH",
      url: `/orgs/${a.user.orgId}/users/${a.user.id}`,
      headers: { authorization: `Bearer ${a.token}` },
      payload: { role: "org_admin" },
    });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { role: string }).role).toBe("org_admin");
  });

  test("patching a user in another org is a 404, not a cross-tenant write", async () => {
    const r = await app.inject({
      method: "PATCH",
      url: `/orgs/${a.user.orgId}/users/${b.user.id}`,
      headers: { authorization: `Bearer ${a.token}` },
      payload: { status: "disabled" },
    });
    expect(r.statusCode).toBe(404);

    const check = await app.inject({
      method: "GET",
      url: `/orgs/${b.user.orgId}/users`,
      headers: { authorization: `Bearer ${b.token}` },
    });
    const rows = check.json() as Array<{ id: string; status: string }>;
    expect(rows.find((row) => row.id === b.user.id)?.status).toBe("active");
  });

  test("creating a user cannot mint a superadmin", async () => {
    const r = await app.inject({
      method: "POST",
      url: `/orgs/${a.user.orgId}/users`,
      headers: { authorization: `Bearer ${a.token}` },
      payload: {
        email: `m7-created-${crypto.randomUUID().slice(0, 8)}@example.test`,
        displayName: "Created",
        password: "created-password-1",
        role: "superadmin",
      },
    });
    expect(r.statusCode).toBe(400);
  });

  test("forgetting another org's assertion is a 404", async () => {
    const remembered = await app.inject({
      method: "POST",
      url: "/remember",
      headers: { authorization: `Bearer ${b.token}` },
      payload: {
        scope: "org",
        subject: `m7-${crypto.randomUUID().slice(0, 8)}`,
        predicate: "belongs-to",
        object: "org-b",
        sources: [{ type: "event", id: crypto.randomUUID() }],
      },
    });
    expect(remembered.statusCode).toBe(201);
    const assertionId = (remembered.json() as { id: string }).id;

    const forgotten = await app.inject({
      method: "POST",
      url: "/forget",
      headers: { authorization: `Bearer ${a.token}` },
      payload: { id: assertionId },
    });
    expect(forgotten.statusCode).toBe(404);

    const still = await app.inject({
      method: "POST",
      url: "/recall",
      headers: { authorization: `Bearer ${b.token}` },
      payload: { scope: "org" },
    });
    const rows = still.json() as Array<{ id: string }>;
    expect(rows.some((row) => row.id === assertionId)).toBe(true);
  });

  test("trust outside 1-3 is refused before anything is written", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/remember",
      headers: { authorization: `Bearer ${a.token}` },
      payload: {
        scope: "org",
        subject: "trust-range",
        predicate: "is",
        object: "4",
        sources: [{ type: "event", id: crypto.randomUUID() }],
        trust: 4,
      },
    });
    expect(r.statusCode).toBe(400);
  });

  test("another org's LLM key cannot be tested or listed", async () => {
    const created = await app.inject({
      method: "POST",
      url: `/orgs/${b.user.orgId}/llm-keys`,
      headers: { authorization: `Bearer ${b.token}` },
      payload: {
        label: "m7-key",
        apiKey: "sk-m7-not-a-real-key",
        provider: "custom",
        baseUrl: "http://127.0.0.1:9/v1",
        chatModel: "ghost",
      },
    });
    expect(created.statusCode).toBe(201);
    const keyId = (created.json() as { id: string }).id;

    for (const path of ["test", "models"]) {
      const r = await app.inject({
        method: "POST",
        url: `/orgs/${a.user.orgId}/llm-keys/${keyId}/${path}`,
        headers: { authorization: `Bearer ${a.token}` },
      });
      expect(r.statusCode, path).toBe(404);
    }
  });

  test("project membership cannot be joined across orgs", async () => {
    const project = await app.inject({
      method: "POST",
      url: "/projects",
      headers: { authorization: `Bearer ${b.token}` },
      payload: { orgId: b.user.orgId, name: "B project", slug: `b-${crypto.randomUUID().slice(0, 8)}` },
    });
    expect(project.statusCode).toBe(201);
    const projectId = (project.json() as { id: string }).id;

    const joined = await app.inject({
      method: "POST",
      url: `/projects/${projectId}/members`,
      headers: { authorization: `Bearer ${a.token}` },
      payload: { userId: a.user.id, role: "member" },
    });
    expect(joined.statusCode).toBe(404);

    const roster = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/members`,
      headers: { authorization: `Bearer ${a.token}` },
    });
    expect(roster.statusCode).toBe(404);
  });
});
