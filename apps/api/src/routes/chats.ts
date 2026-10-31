import { z } from "zod";
import {
  appendMessage,
  createChat,
  deleteChat,
  getChat,
  listChats,
  listMessages,
  renameChat,
  type Db,
} from "@lore/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

/**
 * Chat history: list, open, rename and delete the caller's own conversations.
 *
 * Ownership is part of every statement in @lore/db/chats (org + user), so a
 * chat id belonging to someone else answers 404 rather than leaking its title.
 */
const chatParams = z.object({ id: z.string().uuid() });
const createBody = z.object({ title: z.string().max(200).optional() });
const renameBody = z.object({ title: z.string().min(1).max(200) });

export const createChatHistoryRoutes: (db: Db) => FastifyPluginAsyncZod = (db) => async (app) => {
  app.addHook("preHandler", async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: "unauthorized" });
  });

  app.get("/chats", async (request) => {
    const user = request.user;
    return listChats(db, user.orgId, user.id);
  });

  app.post("/chats", { schema: { body: createBody } }, async (request, reply) => {
    const user = request.user;
    const chat = await createChat(db, { orgId: user.orgId, userId: user.id, title: request.body.title });
    return reply.code(201).send(chat);
  });

  app.get("/chats/:id", { schema: { params: chatParams } }, async (request, reply) => {
    const user = request.user;
    const chat = await getChat(db, user.orgId, user.id, request.params.id);
    if (!chat) return reply.code(404).send({ error: "not found" });
    const messages = await listMessages(db, user.orgId, chat.id);
    return { chat, messages };
  });

  app.patch(
    "/chats/:id",
    { schema: { params: chatParams, body: renameBody } },
    async (request, reply) => {
      const user = request.user;
      const chat = await getChat(db, user.orgId, user.id, request.params.id);
      if (!chat) return reply.code(404).send({ error: "not found" });
      await renameChat(db, user.orgId, user.id, chat.id, request.body.title);
      return { ok: true };
    },
  );

  app.delete("/chats/:id", { schema: { params: chatParams } }, async (request, reply) => {
    const user = request.user;
    const removed = await deleteChat(db, user.orgId, user.id, request.params.id);
    if (!removed) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });
};

export { appendMessage };
