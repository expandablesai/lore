import { and, eq } from "drizzle-orm";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  users,
  audit,
  clearUserAvatar,
  getUserAvatar,
  setUserAvatar,
  type Db,
} from "@lore/db";
import type { FastifyPluginAsync } from "fastify";
import { LOCALES, isLocale } from "@lore/core";
import type { AuthenticatedUser } from "../plugins/auth-guard.ts";

const ROLE_RANK: Record<string, number> = { viewer: 0, member: 1, org_admin: 2, superadmin: 3 };

/**
 * Roles an org admin may hand out. `superadmin` is deliberately absent: it is
 * the one role that crosses orgs, and it must not be reachable from a body field
 * an admin controls.
 */
const ASSIGNABLE_ROLES = new Set(["viewer", "member", "org_admin"]);
/** Mirrors the `user_status` enum. */
const USER_STATUSES = new Set(["active", "disabled"]);

/** Where uploaded files live (shared with the document store). */
function blobsDir(): string {
  return process.env.BLOBS_DIR ?? "/srv/lore/blobs";
}

/** Profile pictures are small and only these formats are displayed. */
const AVATAR_MIMES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

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
    const avatar = await getUserAvatar(db, user.id);
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      orgId: user.orgId,
      status: user.status,
      theme: await themeOf(db, user.id),
      neon: await neonOf(db, user.id),
      // Null means "follow the browser", which is the default for a new account.
      locale: user.locale,
      hasAvatar: Boolean(avatar?.avatarKey),
    };
  });

  /**
   * Upload a profile picture.
   *
   * The bytes go to the same blob store as documents; the user row keeps only
   * the key and mime, so the session payload never carries image data.
   */
  app.post("/me/avatar", async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: "multipart file required" });
    const ext = AVATAR_MIMES[file.mimetype];
    if (!ext) {
      return reply.code(415).send({ error: "avatar must be a PNG, JPEG or WebP image" });
    }

    const buffer = await file.toBuffer();
    if (buffer.length > AVATAR_MAX_BYTES) {
      return reply.code(413).send({ error: "avatar must be smaller than 5 MB" });
    }

    const key = join("avatars", `${randomUUID()}${ext}`);
    await mkdir(join(blobsDir(), "avatars"), { recursive: true });
    await writeFile(join(blobsDir(), key), buffer);
    await setUserAvatar(db, request.user.id, key, file.mimetype);
    await db.insert(audit).values({
      orgId: request.user.orgId,
      actorId: request.user.id,
      action: "user.avatar",
      targetType: "user",
      targetIds: [request.user.id],
      ip: request.ip,
    });
    return reply.code(201).send({ hasAvatar: true });
  });

  app.delete("/me/avatar", async (request) => {
    await clearUserAvatar(db, request.user.id);
    return { hasAvatar: false };
  });

  /** Serve a colleague's picture: same org only, never anonymous. */
  app.get<{ Params: { id: string } }>("/users/:id/avatar", async (request, reply) => {
    const avatar = await getUserAvatar(db, request.params.id);
    if (!avatar || !avatar.avatarKey || !avatar.avatarMime) {
      return reply.code(404).send({ error: "no avatar" });
    }
    if (avatar.orgId !== request.user.orgId) {
      return reply.code(404).send({ error: "no avatar" });
    }
    const path = join(blobsDir(), avatar.avatarKey);
    if (!existsSync(path)) return reply.code(410).send({ error: "avatar file is gone" });
    const data = await readFile(path);
    return reply
      .header("content-type", avatar.avatarMime)
      .header("content-length", String(data.length))
      .header("cache-control", "private, max-age=60")
      .send(data);
  });

  app.patch<{ Body: { displayName?: string; theme?: string; neon?: boolean; locale?: string | null } }>("/me", async (request, reply) => {
    const { displayName, theme, neon, locale } = request.body;
    if (theme !== undefined && !["light", "dark", "system"].includes(theme)) {
      return reply.code(400).send({ error: "theme must be light, dark or system" });
    }
    if (neon !== undefined && typeof neon !== "boolean") {
      return reply.code(400).send({ error: "neon must be a boolean" });
    }
    // null is meaningful: it hands the choice back to the browser.
    if (locale !== undefined && locale !== null && !isLocale(locale)) {
      return reply
        .code(400)
        .send({ error: `language must be one of ${LOCALES.join(", ")} or null` });
    }
    if (displayName || theme || neon !== undefined || locale !== undefined) {
      const set: Record<string, unknown> = {};
      if (displayName) set.displayName = displayName;
      if (theme) set.theme = theme;
      if (neon !== undefined) set.neon = neon;
      if (locale !== undefined) set.locale = locale;
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
      locale: updated.locale,
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
      // Both fields land in enum columns, so an unchecked value is either a
      // database error or a privilege escalation: every signup is an
      // org_admin, and {"role":"superadmin"} used to be accepted verbatim.
      if (role !== undefined && !ASSIGNABLE_ROLES.has(role)) {
        return reply.code(400).send({ error: "role must be viewer, member or org_admin" });
      }
      if (status !== undefined && !USER_STATUSES.has(status)) {
        return reply.code(400).send({ error: "status must be active or disabled" });
      }
      if (role && (ROLE_RANK[role] ?? 0) > (ROLE_RANK[request.user.role] ?? 0)) {
        return reply.code(403).send({ error: "cannot grant a role above your own" });
      }
      const set: Record<string, unknown> = {};
      if (role) set.role = role;
      if (status) set.status = status;
      if (Object.keys(set).length === 0) return reply.code(400).send({ error: "no fields" });
      // Scoped by org as well as id: matching on users.id alone let org A's
      // admin disable or demote an account in org B.
      const updated = await db
        .update(users)
        .set(set)
        .where(and(eq(users.orgId, request.params.orgId), eq(users.id, request.params.userId)))
        .returning({ id: users.id, email: users.email, role: users.role, status: users.status });
      const u = updated[0];
      if (!u) return reply.code(404).send({ error: "not found" });
      await db.insert(audit).values({ orgId: request.params.orgId, actorId: request.user.id, action: "user.patch", targetType: "user", targetIds: [request.params.userId], detail: set, ip: request.ip });
      return u;
    },
  );
};
