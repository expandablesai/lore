import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import {
  canEmbedKey,
  chunks,
  dominantEmbeddingModel,
  embeddings,
  pickChatKey,
  pickEmbedKey,
  revealActiveLlmKeys,
  type Db,
  type RevealedKey,
  withRls,
} from "@lore/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { createAnthropicAdapter, createOpenAIAdapter, createOpenAIEmbedder } from "@lore/proxy";
import { deterministicEmbed, EMBEDDING_DIM, HASH_DIM, HASH_MODEL, vectorToPgText, zeroPad } from "@lore/core";

/**
 * In-app chat — retrieves the caller's org memories by cosine similarity over
 * chunk embeddings, grounds a system prompt with them, and calls the org's
 * chat key.
 *
 * Chat and embedding may be served by different keys (a hosted chat model plus
 * a local embedder is the common split), so the two are picked separately. The
 * query is embedded with the model the stored chunks were indexed with —
 * vectors from different models are not comparable, and mixing them turns the
 * recall into noise while still "working".
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

/** Embed the question in the stored chunks' vector space. */
async function queryVectorFor(
  key: RevealedKey | null,
  question: string,
): Promise<{ vec: Float32Array; model: string }> {
  if (key && canEmbedKey(key)) {
    const embedded = await createOpenAIEmbedder({ apiKey: key.apiKey, baseUrl: key.baseUrl }).embed(
      question,
      key.embedModel,
    );
    const first = embedded[0];
    if (first) return { vec: first, model: key.embedModel };
  }
  return { vec: deterministicEmbed(question, HASH_DIM), model: HASH_MODEL };
}

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

        const keys = await revealActiveLlmKeys(db, user.orgId);
        const chatKey = pickChatKey(keys);
        if (!chatKey) {
          return reply
            .code(502)
            .send({ error: "no active LLM key for this org" });
        }

        const storedModel = await dominantEmbeddingModel(db, user.orgId);
        const { vec: queryVector, model } = await queryVectorFor(
          pickEmbedKey(keys, storedModel),
          question,
        );
        const rows = await withRls(db, user.orgId, user.id, async (tx) =>
          tx
            .select({ text: chunks.text })
            .from(embeddings)
            .innerJoin(chunks, eq(chunks.id, embeddings.entityId))
            .where(
              and(
                eq(embeddings.entityType, "chunk"),
                eq(embeddings.model, model),
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
          chatKey.apiType === "anthropic"
            ? createAnthropicAdapter({ apiKey: chatKey.apiKey, baseUrl: chatKey.baseUrl })
            : createOpenAIAdapter({ apiKey: chatKey.apiKey, baseUrl: chatKey.baseUrl });
        const res = await adapter.chatCompletions({
          model: chatKey.chatModel,
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
