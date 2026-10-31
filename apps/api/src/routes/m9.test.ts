// M9 password change: the current password is required, the new one is held to
// the signup floor, and every other session is ejected on success.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createDb, type Db } from "@lore/db";
import type { FastifyInstance } from "fastify";
import { createApp } from "../app.ts";

process.env.LORE_ENCRYPTION_KEY ??= "0".repeat(64);

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://lore:lore@localhost:5432/lore_test";

describe("M9 password change", () => {
  let db: Db;
  let app: FastifyInstance;
  let token: string;

  const email = `m9-${crypto.randomUUID().slice(0, 8)}@example.test`;
  const oldPassword = "m9-original-password";
  const newPassword = "m9-replacement-password";

  beforeAll(async () => {
    db = createDb(DATABASE_URL);
    app = createApp(db);
    await app.ready();
    const r = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email, password: oldPassword, displayName: "M9", orgName: `M9 Org ${crypto.randomUUID().slice(0, 8)}` },
    });
    token = (r.json() as { token: string }).token;
  });

  afterAll(async () => {
    await app.close();
    await db.$client.end({ timeout: 5 });
  });

  const change = (body: Record<string, unknown>, bearer = token) =>
    app.inject({
      method: "POST",
      url: "/me/password",
      headers: { authorization: `Bearer ${bearer}` },
      payload: body,
    });

  test("a new password below the signup floor is refused", async () => {
    const r = await change({ currentPassword: oldPassword, newPassword: "short" });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: string }).error).toContain("at least 10");
  });

  test("reusing the current password is refused", async () => {
    const r = await change({ currentPassword: oldPassword, newPassword: oldPassword });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: string }).error).toContain("differ");
  });

  test("a wrong current password is refused", async () => {
    const r = await change({ currentPassword: "not-the-password", newPassword });
    expect(r.statusCode).toBe(403);
    expect((r.json() as { error: string }).error).toContain("incorrect");
  });

  test("a successful change rotates the password and ejects other sessions", async () => {
    // A second device signed in with the old password.
    const other = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password: oldPassword },
    });
    expect(other.statusCode).toBe(200);
    const otherToken = (other.json() as { token: string }).token;

    const r = await change({ currentPassword: oldPassword, newPassword });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { ok: boolean; revokedSessions: number };
    expect(body.ok).toBe(true);
    expect(body.revokedSessions).toBeGreaterThanOrEqual(1);

    // The session that changed it still works; the other one does not.
    const mine = await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${token}` } });
    expect(mine.statusCode).toBe(200);
    const theirs = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(theirs.statusCode).toBe(401);
  });

  test("the old password no longer signs in, the new one does", async () => {
    const stale = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password: oldPassword },
    });
    expect(stale.statusCode).toBe(401);

    const fresh = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password: newPassword },
    });
    expect(fresh.statusCode).toBe(200);
  });
});
