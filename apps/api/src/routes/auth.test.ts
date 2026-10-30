import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createDb, type Db } from "@lore/db";
import type { FastifyInstance } from "fastify";

import { createApp } from "../app.ts";

/**
 * Auth vertical tests.
 *
 * Runs against a real PostgreSQL with the migrations applied (CI runs
 * `db:migrate` before `pnpm test`), driving the Fastify instance through
 * `inject` so the whole request path — zod validation, argon2 hashing,
 * session insert, bearer lookup — is exercised without binding a port.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://lore:lore@localhost:5432/lore_test";

type SessionResponse = { token: string; user: { id: string; email: string; role: string; orgId: string } };

describe("auth vertical", () => {
  let db: Db;
  let app: FastifyInstance;
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `signup-${suffix}@example.test`;
  const password = "correct-horse-battery";
  let token: string;

  beforeAll(async () => {
    db = createDb(DATABASE_URL);
    app = createApp(db);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await db.$client.end({ timeout: 5 });
  });

  test("signup creates an org, an org_admin and a session", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email, password, displayName: "Ada", orgName: "Lovelace Labs" },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as SessionResponse;
    expect(body.token).toBeTruthy();
    expect(body.user.email).toBe(email);
    expect(body.user.role).toBe("org_admin");
    expect(body.user.orgId).toBeTruthy();
    token = body.token;
  });

  test("signup rejects a duplicate email", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email, password, displayName: "Ada", orgName: "Again" },
    });

    expect(response.statusCode).toBe(409);
  });

  test("signup rejects a too-short password", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: {
        email: `short-${suffix}@example.test`,
        password: "short",
        displayName: "Ada",
        orgName: "Short",
      },
    });

    expect(response.statusCode).toBe(400);
  });

  test("login rejects a wrong password", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password: "wrong-password-here" },
    });

    expect(response.statusCode).toBe(401);
  });

  test("login does not reveal whether an email exists", async () => {
    const unknown = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: `ghost-${suffix}@example.test`, password },
    });
    const wrong = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password: "wrong-password-here" },
    });

    expect(unknown.statusCode).toBe(wrong.statusCode);
    expect(unknown.payload).toBe(wrong.payload);
  });

  test("login issues a working session token", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as SessionResponse;
    expect(body.token).toBeTruthy();

    const session = await app.inject({
      method: "GET",
      url: "/auth/session",
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect(session.statusCode).toBe(200);
    expect((session.json() as { user: { email: string } }).user.email).toBe(email);
  });

  test("session rejects a forged token", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/auth/session",
      headers: { authorization: "Bearer not-a-real-token" },
    });

    expect(response.statusCode).toBe(401);
  });

  test("session rejects a missing authorization header", async () => {
    const response = await app.inject({ method: "GET", url: "/auth/session" });

    expect(response.statusCode).toBe(401);
  });

  test("the signup token works on its own", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/auth/session",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
  });
});
