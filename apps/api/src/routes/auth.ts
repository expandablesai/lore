import { orgs, sessions, users, type Db } from "@lore/db";
import { and, eq, gt } from "drizzle-orm";
import { hash, verify } from "@node-rs/argon2";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { bearerFrom, hashToken, issueToken, sessionExpiry } from "../auth-tokens.ts";

/**
 * Auth vertical — signup, login, session.
 *
 * Signup creates the org and its first member as `org_admin`; there is no
 * separate bootstrap-admin step to get wrong. Login never distinguishes an
 * unknown email from a wrong password, so it cannot be used to enumerate
 * accounts. A user with TOTP enabled is refused rather than silently allowed
 * through on password alone — the factor is enforced before it is implemented.
 */

const emailField = z.string().email().max(320);
const passwordField = z.string().min(10).max(512);

const signupBody = z.object({
  email: emailField,
  password: passwordField,
  displayName: z.string().min(1).max(200),
  orgName: z.string().min(1).max(200),
});

const loginBody = z.object({
  email: emailField,
  password: z.string().min(1).max(512),
});

const userDto = z.object({
  id: z.string(),
  orgId: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: z.enum(["superadmin", "org_admin", "member", "viewer"]),
});

const sessionDto = z.object({ token: z.string(), user: userDto });
const errorDto = z.object({ error: z.string() });

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "org"}-${crypto.randomUUID().slice(0, 8)}`;
}

export const createAuthRoutes: (db: Db) => FastifyPluginAsyncZod = (db) => async (app) => {
  app.post(
    "/auth/signup",
    {
      schema: {
        body: signupBody,
        response: { 201: sessionDto, 409: errorDto },
      },
    },
    async (request, reply) => {
      const { email, password, displayName, orgName } = request.body;

      const taken = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (taken[0]) {
        return reply.code(409).send({ error: "email already registered" });
      }

      const passwordHash = await hash(password);

      const createdOrg = await db
        .insert(orgs)
        .values({ name: orgName, slug: slugify(orgName) })
        .returning({ id: orgs.id });
      const orgId = createdOrg[0]?.id;
      if (!orgId) {
        throw new Error("org insert returned no row");
      }

      const createdUser = await db
        .insert(users)
        .values({ orgId, email, displayName, passwordHash, role: "org_admin" })
        .returning();
      const user = createdUser[0];
      if (!user) {
        throw new Error("user insert returned no row");
      }

      const { token, tokenHash } = issueToken();
      await db.insert(sessions).values({
        userId: user.id,
        tokenHash,
        expiresAt: sessionExpiry(),
        ip: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      return reply
        .code(201)
        .send({ token, user: toUserDto(user) });
    },
  );

  app.post(
    "/auth/login",
    {
      schema: {
        body: loginBody,
        response: { 200: sessionDto, 401: errorDto, 403: errorDto },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;

      const found = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      const user = found[0];

      // Same response for unknown email and bad password — no enumeration.
      if (!user || !(await verify(user.passwordHash, password))) {
        return reply.code(401).send({ error: "invalid credentials" });
      }
      if (user.status !== "active") {
        return reply.code(403).send({ error: "account disabled" });
      }
      if (user.totpEnabled) {
        return reply.code(403).send({ error: "totp factor required" });
      }

      const { token, tokenHash } = issueToken();
      await db.insert(sessions).values({
        userId: user.id,
        tokenHash,
        expiresAt: sessionExpiry(),
        ip: request.ip,
        userAgent: request.headers["user-agent"] ?? null,
      });

      return reply.code(200).send({ token, user: toUserDto(user) });
    },
  );

  app.get(
    "/auth/session",
    {
      schema: {
        response: { 200: z.object({ user: userDto }), 401: errorDto },
      },
    },
    async (request, reply) => {
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

      return reply.code(200).send({ user: toUserDto(row.user) });
    },
  );
};

function toUserDto(row: typeof users.$inferSelect) {
  return {
    id: row.id,
    orgId: row.orgId,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
  };
}
