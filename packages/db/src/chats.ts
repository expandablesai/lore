/**
 * @lore/db chats — conversation history for the in-app chat.
 *
 * Every query is scoped by org *and* user: a chat belongs to the person who
 * started it, and another member of the same org must not be able to list or
 * read it. The filters are part of each statement rather than left to a caller,
 * so a missing guard cannot widen access.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { chatMessages, chats, users } from "./schema.js";

/** An image a message carries: the console fetches the bytes by document id. */
export interface ChatImageRef {
  documentId: string;
  filename: string;
  mime: string;
}

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: Date;
  messageCount: number;
}

export interface ChatMessageRow {
  id: string;
  role: string;
  content: string;
  images: ChatImageRef[];
  createdAt: Date;
}

/** Title derived from the opening question, the way chat apps name a thread. */
export function titleFrom(question: string): string {
  const clean = question.replace(/\s+/g, " ").trim();
  if (clean === "") return "New chat";
  return clean.length <= 60 ? clean : `${clean.slice(0, 57).trimEnd()}…`;
}

export async function createChat(
  db: Db,
  input: { orgId: string; userId: string; title?: string },
): Promise<{ id: string; title: string; updatedAt: Date }> {
  const rows = await db
    .insert(chats)
    .values({
      orgId: input.orgId,
      userId: input.userId,
      title: input.title?.trim() || "New chat",
    })
    .returning({ id: chats.id, title: chats.title, updatedAt: chats.updatedAt });
  const chat = rows[0];
  if (!chat) throw new Error("chat insert failed");
  return chat;
}

export async function listChats(db: Db, orgId: string, userId: string): Promise<ChatSummary[]> {
  const rows = await db
    .select({ id: chats.id, title: chats.title, updatedAt: chats.updatedAt })
    .from(chats)
    .where(and(eq(chats.orgId, orgId), eq(chats.userId, userId)))
    .orderBy(desc(chats.updatedAt))
    .limit(200);
  if (rows.length === 0) return [];

  // Counted in a second query rather than a correlated subquery: interpolating a
  // column there renders it unqualified (`"id"`), which then binds to the
  // joined table's own id and silently counts nothing.
  const counts = await db
    .select({ chatId: chatMessages.chatId, total: sql<number>`count(*)::int` })
    .from(chatMessages)
    .where(
      inArray(
        chatMessages.chatId,
        rows.map((row) => row.id),
      ),
    )
    .groupBy(chatMessages.chatId);
  const byChat = new Map(counts.map((c) => [c.chatId, c.total]));

  return rows.map((row) => ({ ...row, messageCount: byChat.get(row.id) ?? 0 }));
}

export async function getChat(
  db: Db,
  orgId: string,
  userId: string,
  chatId: string,
): Promise<{ id: string; title: string; updatedAt: Date } | null> {
  const rows = await db
    .select({ id: chats.id, title: chats.title, updatedAt: chats.updatedAt })
    .from(chats)
    .where(and(eq(chats.id, chatId), eq(chats.orgId, orgId), eq(chats.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function renameChat(
  db: Db,
  orgId: string,
  userId: string,
  chatId: string,
  title: string,
): Promise<void> {
  await db
    .update(chats)
    .set({ title: title.trim().slice(0, 200) || "New chat", updatedAt: new Date() })
    .where(and(eq(chats.id, chatId), eq(chats.orgId, orgId), eq(chats.userId, userId)));
}

export async function deleteChat(
  db: Db,
  orgId: string,
  userId: string,
  chatId: string,
): Promise<boolean> {
  const rows = await db
    .delete(chats)
    .where(and(eq(chats.id, chatId), eq(chats.orgId, orgId), eq(chats.userId, userId)))
    .returning({ id: chats.id });
  return rows.length > 0;
}

export async function listMessages(
  db: Db,
  orgId: string,
  chatId: string,
): Promise<ChatMessageRow[]> {
  const rows = await db
    .select({
      id: chatMessages.id,
      role: chatMessages.role,
      content: chatMessages.content,
      images: chatMessages.images,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(and(eq(chatMessages.chatId, chatId), eq(chatMessages.orgId, orgId)))
    .orderBy(chatMessages.createdAt);
  return rows.map((row) => ({
    ...row,
    images: Array.isArray(row.images) ? (row.images as ChatImageRef[]) : [],
  }));
}

export async function appendMessage(
  db: Db,
  input: {
    chatId: string;
    orgId: string;
    role: "user" | "assistant" | "system";
    content: string;
    images?: ChatImageRef[];
  },
): Promise<{ createdAt: Date } | null> {
  // The timestamp comes back so a live turn can be labelled exactly like a
  // reloaded one — the console never has to guess the server's clock.
  const inserted = await db
    .insert(chatMessages)
    .values({
      chatId: input.chatId,
      orgId: input.orgId,
      role: input.role,
      content: input.content,
      images: input.images ?? [],
    })
    .returning({ createdAt: chatMessages.createdAt });
  await db.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, input.chatId));
  return inserted[0] ?? null;
}

/** Persist the reader's theme choice so it follows them to another browser. */
export async function setUserTheme(
  db: Db,
  userId: string,
  theme: "light" | "dark" | "system",
): Promise<void> {
  await db.update(users).set({ theme }).where(eq(users.id, userId));
}

/** Persist whether the neon lighting layer is on. Independent of the theme. */
export async function setUserNeon(db: Db, userId: string, neon: boolean): Promise<void> {
  await db.update(users).set({ neon }).where(eq(users.id, userId));
}

/** Store the blob key of a freshly uploaded profile picture. */
export async function setUserAvatar(
  db: Db,
  userId: string,
  avatarKey: string,
  avatarMime: string,
): Promise<void> {
  await db.update(users).set({ avatarKey, avatarMime }).where(eq(users.id, userId));
}

/** Remove the profile picture reference (the blob stays until it is replaced). */
export async function clearUserAvatar(db: Db, userId: string): Promise<void> {
  await db.update(users).set({ avatarKey: null, avatarMime: null }).where(eq(users.id, userId));
}

/** The avatar descriptor for one user, for the authenticated image route. */
export async function getUserAvatar(
  db: Db,
  userId: string,
): Promise<{ orgId: string; avatarKey: string | null; avatarMime: string | null } | null> {
  const rows = await db
    .select({ orgId: users.orgId, avatarKey: users.avatarKey, avatarMime: users.avatarMime })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0] ?? null;
}