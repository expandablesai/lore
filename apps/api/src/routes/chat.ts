import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import {
  canEmbedKey,
  chunks,
  embeddings,
  revealActiveLlmKey,
  type Db,
  withRls,
} from "@lore/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { createAnthropicAdapter, createOpenAIAdapter, createOpenAIEmbedder } from "@lore/proxy";
import { deterministicEmbed, EMBEDDING_DIM, HASH_DIM, vectorToPgText, zeroPad } from "@lore/core";

/**
 * In-app chat — retrieves the caller's org memories by cosine similarity over
 * chunk embeddings, grounds a system prompt with them, and calls the org's
 * OpenAI key. Requires an active per-org LLM key.
 */
const chatBody = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string().min(1).max(8000),
      }),
    )
    .min(1)
    .max(50),
});

export const createChatRoutes: (db: Db) => FastifyPluginAsyncZod =
  (db) => async (app) => {
    app.addHook("preHandler", async (request, reply) => {
      if (!request.user) {
        return reply.code(401).send({ error: "unauthorized" });
      }
    });

    app.post(
      "/chat",
      { schema: { body: chatBody } },
      async (request, reply) => {
        const user = request.user;
        const { messages } = request.body;
        const question = messages[messages.length - 1]?.content ?? "";

        const key = await revealActiveLlmKey(db, user.orgId);
        if (!key) {
          return reply
            .code(502)
            .send({ error: "no active LLM key for this org" });
        }

        const canEmbed = canEmbedKey(key);
        const queryVector = canEmbed
          ? ((await createOpenAIEmbedder({ apiKey: key.apiKey, baseUrl: key.baseUrl }).embed(
              question,
              key.embedModel,
            ))[0] ?? new Float32Array(EMBEDDING_DIM))
          : deterministicEmbed(question, HASH_DIM);
        const rows = await withRls(db, user.orgId, user.id, async (tx) =>
          tx
            .select({ text: chunks.text })
            .from(embeddings)
            .innerJoin(chunks, eq(chunks.id, embeddings.entityId))
            .where(
              and(
                eq(embeddings.entityType, "chunk"),
                eq(chunks.orgId, user.orgId),
              ),
            )
            .orderBy(
              sql`${embeddings.vec} <=> ${vectorToPgText(zeroPad(queryVector, EMBEDDING_DIM))}::vector`,
            )
            .limit(6),
        );
        const memory = rows.map((r) => r.text).join("\n\n");

        const adapter =
          key.apiType === "anthropic"
            ? createAnthropicAdapter({ apiKey: key.apiKey, baseUrl: key.baseUrl })
            : createOpenAIAdapter({ apiKey: key.apiKey, baseUrl: key.baseUrl });
        const res = await adapter.chatCompletions({
          model: key.chatModel,
          messages: [
            {
              role: "system",
              content: `You are the EXPANDABLES LORE assistant. Ground your answer in the retrieved memories when relevant.\n\n${memory}`,
            },
            ...messages,
          ],
        });
        const message = res.choices[0]?.message ?? {
          role: "assistant",
          content: "",
        };
        return { message };
      },
    );
  };
