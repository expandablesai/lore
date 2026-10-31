import { z } from "zod";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import {
  appendMessage,
  canEmbedKey,
  chunks,
  createChat,
  documents,
  dominantEmbeddingModel,
  embeddings,
  getChat,
  pickChatKey,
  pickEmbedKey,
  revealActiveLlmKeys,
  titleFrom,
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
 *
 * An image is indexed as a description, which is text the model can read but
 * not pictures it can show. The images an answer rests on are therefore
 * returned beside it, so the console can put them on screen.
 */
const chatBody = z.object({
  /** Continue this conversation; omit to start one (it is created and named). */
  chatId: z.string().uuid().optional(),
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

/** One image attached to a reply; the console fetches the bytes itself. */
export interface ChatImage {
  documentId: string;
  filename: string;
  mime: string;
}

/**
 * Questions that expect to be answered with a picture.
 *
 * Matching on the words people use to ask for an image keeps the behaviour
 * predictable: "show me the portfolio" brings it up, "who is Chen Lian" does
 * not, and no threshold on a distance score has to be invented for it.
 */
const WANTS_IMAGE =
  /\b(image|images|picture|pictures|photo|photos|screenshot|screenshots|scan|scans|visual|portfolio|design|drawing|diagram|look like|show)\b/i;

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

        // The conversation this turn belongs to: an existing chat, or a new one
        // named after the opening question so history stays recognisable.
        let chatId = request.body.chatId;
        if (chatId) {
          const existing = await getChat(db, user.orgId, user.id, chatId);
          if (!existing) return reply.code(404).send({ error: "chat not found" });
        } else {
          const created = await createChat(db, {
            orgId: user.orgId,
            userId: user.id,
            title: titleFrom(question),
          });
          chatId = created.id;
        }

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
        const queryText = vectorToPgText(zeroPad(queryVector, EMBEDDING_DIM));

        const rows = await withRls(db, user.orgId, user.id, async (tx) =>
          tx
            .select({ text: chunks.text, documentId: chunks.documentId })
            .from(embeddings)
            .innerJoin(chunks, eq(chunks.id, embeddings.entityId))
            .where(
              and(
                eq(embeddings.entityType, "chunk"),
                eq(embeddings.model, model),
                eq(chunks.orgId, user.orgId),
              ),
            )
            .orderBy(sql`${embeddings.vec} <=> ${queryText}::vector`)
            .limit(6),
        );

        // Images the retrieved passages came from: the answer is standing on
        // those descriptions, so the pictures belong with it.
        const retrievedDocIds = [...new Set(rows.map((r) => r.documentId))];
        const groundedImages: ChatImage[] =
          retrievedDocIds.length === 0
            ? []
            : await withRls(db, user.orgId, user.id, async (tx) =>
                tx
                  .select({ documentId: documents.id, filename: documents.filename, mime: documents.mime })
                  .from(documents)
                  .where(
                    and(
                      inArray(documents.id, retrievedDocIds),
                      eq(documents.orgId, user.orgId),
                      like(documents.mime, "image/%"),
                    ),
                  ),
              );

        // "Show me…" searches the images for themselves: the picture is the
        // answer, so it should not have to win a text ranking to surface.
        const askedForImage = WANTS_IMAGE.test(question);
        const imageMatches = askedForImage
          ? await withRls(db, user.orgId, user.id, async (tx) =>
              tx
                .select({
                  documentId: documents.id,
                  filename: documents.filename,
                  mime: documents.mime,
                  distance: sql<number>`min(${embeddings.vec} <=> ${queryText}::vector)`,
                })
                .from(embeddings)
                .innerJoin(chunks, eq(chunks.id, embeddings.entityId))
                .innerJoin(documents, eq(documents.id, chunks.documentId))
                .where(
                  and(
                    eq(embeddings.entityType, "chunk"),
                    eq(embeddings.model, model),
                    eq(chunks.orgId, user.orgId),
                    eq(documents.orgId, user.orgId),
                    like(documents.mime, "image/%"),
                  ),
                )
                .groupBy(documents.id, documents.filename, documents.mime)
                .orderBy(sql`min(${embeddings.vec} <=> ${queryText}::vector)`)
                .limit(3),
            )
          : [];

        const images: ChatImage[] = [];
        const seen = new Set<string>();
        for (const image of [...groundedImages, ...imageMatches]) {
          if (seen.has(image.documentId)) continue;
          seen.add(image.documentId);
          images.push({ documentId: image.documentId, filename: image.filename, mime: image.mime });
        }

        // Their descriptions have to travel with the prompt too, or the model
        // is told about an image it cannot say anything about.
        const imageDescriptions =
          imageMatches.length === 0
            ? []
            : await withRls(db, user.orgId, user.id, async (tx) =>
                tx
                  .select({ text: chunks.text })
                  .from(chunks)
                  .where(
                    and(
                      inArray(
                        chunks.documentId,
                        imageMatches.map((m) => m.documentId),
                      ),
                      eq(chunks.orgId, user.orgId),
                    ),
                  )
                  .limit(6),
              );

        const memory = [...rows.map((r) => r.text), ...imageDescriptions.map((d) => d.text)].join("\n\n");
        const shown =
          images.length > 0
            ? `\n\nThe user is being shown these images with your reply: ${images
                .map((i) => i.filename)
                .join(", ")}. Refer to them by name when it helps.`
            : "";

        const adapter =
          chatKey.apiType === "anthropic"
            ? createAnthropicAdapter({ apiKey: chatKey.apiKey, baseUrl: chatKey.baseUrl })
            : createOpenAIAdapter({ apiKey: chatKey.apiKey, baseUrl: chatKey.baseUrl });
        const res = await adapter.chatCompletions({
          model: chatKey.chatModel,
          messages: [
            {
              role: "system",
              content: `You are the EXPANDABLES LORE assistant. Ground your answer in the retrieved memories when relevant.\n\n${memory}${shown}`,
            },
            ...messages,
          ],
        });
        const message = res.choices[0]?.message ?? {
          role: "assistant",
          content: "",
        };

        // Record the turn only once it is complete: a question whose answer
        // never arrived is not history worth reloading.
        await appendMessage(db, { chatId, orgId: user.orgId, role: "user", content: question });
        await appendMessage(db, {
          chatId,
          orgId: user.orgId,
          role: "assistant",
          content: message.content,
          images,
        });

        return { chatId, message, images };
      },
    );
  };
