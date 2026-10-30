import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import {
  chunks,
  embeddings,
  revealActiveLlmKey,
  type Db,
  withRls,
} from "@lore/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { createOpenAIAdapter, createOpenAIEmbedder } from "@lore/proxy";
import { EMBEDDING_DIM, vectorToPgText } from "@lore/core";

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

        const apiKey = await revealActiveLlmKey(db, user.orgId);
        if (!apiKey) {
          return reply
            .code(502)
            .send({ error: "no active LLM key for this org" });
        }

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
              sql`${embeddings.vec} <=> ${
                vectorToPgText(
                  (await createOpenAIEmbedder({ apiKey }).embed(
                    question,
                    "text-embedding-3-large",
                  ))[0] ?? new Float32Array(EMBEDDING_DIM),
                )
              }::vector`,
            )
            .limit(6),
        );
        const memory = rows.map((r) => r.text).join("\n\n");

        const adapter = createOpenAIAdapter({ apiKey });
        const res = await adapter.chatCompletions({
          model: "gpt-4o",
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
