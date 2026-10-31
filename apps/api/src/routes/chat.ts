import { z } from "zod";
import { and, desc, eq, inArray, like, ne, sql } from "drizzle-orm";
import {
  appendMessage,
  assertions,
  canEmbedKey,
  chatMessages,
  chats,
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
import { LOCALE_NAMES, isLocale, resolveLocale } from "@lore/core";

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
        // Assistant turns can legitimately be empty: a model asked for
        // something it cannot do sometimes returns no text at all. Rejecting
        // those here made the *next* question fail with a bare "Bad Request",
        // so emptiness is filtered below instead of forbidden.
        content: z.string().max(8000),
      }),
    )
    .min(1)
    .max(50),
});

/** What LORE can actually do. The model is told, or it invents capabilities. */
const CAPABILITIES = [
  "You are EXPANDABLES LORE, a private memory assistant.",
  "You CAN: search this workspace's indexed documents and images, answer from what you retrieve, and refer to images the user is shown with your reply.",
  "You CANNOT: generate or edit images, browse the web, run code or shell commands, read files that are not in this workspace, or send email.",
  "When asked for something you cannot do, say so plainly in one short sentence and name one thing you can do instead.",
  "Never list a capability you were not given here.",
].join("\n");

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

/**
 * Durable memory.
 *
 * A conversation is not where memory lives: what the reader tells LORE in one
 * chat has to be available in the next one, or the product is just a chat log.
 * Two mechanisms make that true:
 *
 * 1. Facts stated in the first person ("my name is DK") are captured as
 *    assertions on the reader's personal scope, and every turn loads them.
 * 2. Turns from the reader's *other* conversations are searched for the current
 *    question, so a discussion can be picked up again in a new thread.
 *
 * Both are deterministic — they do not depend on a document chunk winning a
 * cosine ranking against a screenplay or a pile of image descriptions.
 */

/** Subject under which self-stated facts are filed. */
const USER_SUBJECT = "the user";

/**
 * Patterns worth capturing, and the predicate each becomes.
 *
 * Deliberately conservative: a bad extraction becomes a durable false belief,
 * so only explicit first-person statements are recorded. "I am tired" is not a
 * fact about the reader; "my name is DK" is.
 */
const FACT_PATTERNS: ReadonlyArray<{ pattern: RegExp; predicate: string }> = [
  { pattern: /\bmy name is ([^.,;!?\n]{1,60})/i, predicate: "name" },
  { pattern: /\bcall me ([^.,;!?\n]{1,60})/i, predicate: "name" },
  { pattern: /\bmy email is ([^.,;!?\n]{1,80})/i, predicate: "email" },
  { pattern: /\bi live in ([^.,;!?\n]{1,60})/i, predicate: "lives in" },
  { pattern: /\bi work (?:at|for) ([^.,;!?\n]{1,60})/i, predicate: "works at" },
  { pattern: /\bi speak ([^.,;!?\n]{1,40})/i, predicate: "speaks" },
  { pattern: /\bi prefer ([^.,;!?\n]{1,80})/i, predicate: "prefers" },
  { pattern: /\bremember (?:that )?(.{3,200})/i, predicate: "note" },
];

/** Facts stated about the reader in this message. Exported for its test. */
export function extractSelfFacts(text: string): Array<{ predicate: string; object: string }> {
  const found: Array<{ predicate: string; object: string }> = [];
  for (const { pattern, predicate } of FACT_PATTERNS) {
    const raw = pattern.exec(text)?.[1]?.trim();
    if (!raw) continue;
    const object = raw.replace(/[.;,:!?]+$/, "").trim();
    if (object.length < 2 || object.length > 160) continue;
    if (found.some((fact) => fact.predicate === predicate && fact.object === object)) continue;
    found.push({ predicate, object });
  }
  return found;
}

/** Keep a pasted turn from filling the next prompt. */
function shorten(text: string, max = 300): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/** Store the self-facts in this message, skipping ones already known. */
async function rememberSelfFacts(
  db: Db,
  input: { orgId: string; userId: string; chatId: string; text: string },
): Promise<void> {
  for (const fact of extractSelfFacts(input.text)) {
    const known = await db
      .select({ id: assertions.id })
      .from(assertions)
      .where(
        and(
          eq(assertions.orgId, input.orgId),
          eq(assertions.ownerUserId, input.userId),
          eq(assertions.subject, USER_SUBJECT),
          eq(assertions.predicate, fact.predicate),
          eq(assertions.object, fact.object),
          ne(assertions.status, "deleted"),
        ),
      )
      .limit(1);
    if (known[0]) continue;
    await db.insert(assertions).values({
      orgId: input.orgId,
      scope: "personal",
      subject: USER_SUBJECT,
      predicate: fact.predicate,
      object: fact.object,
      ownerUserId: input.userId,
      // Provenance: the conversation turn this was told in.
      sources: [{ type: "chat", id: input.chatId }],
      trust: 2,
      status: "confirmed",
      confidence: 1,
    });
  }
}

/** Every durable fact this reader has stated, newest first. */
async function loadSelfFacts(
  db: Db,
  orgId: string,
  userId: string,
): Promise<Array<{ predicate: string; object: string }>> {
  return db
    .select({ predicate: assertions.predicate, object: assertions.object })
    .from(assertions)
    .where(
      and(
        eq(assertions.orgId, orgId),
        eq(assertions.ownerUserId, userId),
        eq(assertions.subject, USER_SUBJECT),
        inArray(assertions.status, ["proposed", "confirmed"]),
      ),
    )
    .orderBy(desc(assertions.createdAt))
    .limit(24);
}

/** Turns from this reader's other conversations that look related. */
async function loadEarlierTurns(
  db: Db,
  input: { orgId: string; userId: string; chatId: string; question: string },
): Promise<Array<{ title: string; content: string }>> {
  return db
    .select({ title: chats.title, content: chatMessages.content })
    .from(chatMessages)
    .innerJoin(chats, eq(chats.id, chatMessages.chatId))
    .where(
      and(
        eq(chatMessages.orgId, input.orgId),
        eq(chats.userId, input.userId),
        eq(chatMessages.role, "user"),
        ne(chatMessages.chatId, input.chatId),
        sql`similarity(${chatMessages.content}, ${input.question}) > 0.1`,
      ),
    )
    .orderBy(sql`similarity(${chatMessages.content}, ${input.question}) DESC`)
    .limit(4);
}

/** Embed the question in the stored chunks' vector space. */
async function queryVectorFor(
  key: RevealedKey | null,
  question: string,
): Promise<{ vec: Float32Array; model: string }> {
  if (key && canEmbedKey(key)) {
    try {
      const embedded = await createOpenAIEmbedder({ apiKey: key.apiKey, baseUrl: key.baseUrl }).embed(
        question,
        key.embedModel,
      );
      const first = embedded[0];
      if (first) return { vec: first, model: key.embedModel };
    } catch {
      // An embedder that is down or misconfigured must not take the whole
      // answer with it: retrieval falls back to the local space, the reply is
      // still produced, and the images/provenance paths stay intact.
    }
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
        // Blank turns are dropped rather than sent upstream: an empty assistant
        // message carries no meaning and some providers reject the request.
        const messages = request.body.messages.filter((m) => m.content.trim() !== "");
        const question = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
        if (question === "") {
          return reply.code(400).send({ error: "a question is required" });
        }

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

        // Memory is not a property of one thread: capture what this message
        // states about the reader, then load every fact they have ever stated
        // plus the earlier turns that look related to this question.
        await rememberSelfFacts(db, { orgId: user.orgId, userId: user.id, chatId, text: question });
        const facts = await loadSelfFacts(db, user.orgId, user.id);
        const earlier = await loadEarlierTurns(db, {
          orgId: user.orgId,
          userId: user.id,
          chatId,
          question,
        });

        const storedModel = await dominantEmbeddingModel(db, user.orgId);
        const { vec: queryVector, model } = await queryVectorFor(
          pickEmbedKey(keys, storedModel),
          question,
        );
        const queryText = vectorToPgText(zeroPad(queryVector, EMBEDDING_DIM));

        // Whether the question is about pictures. Decided before retrieval
        // because it changes what counts as relevant: "what is my name" must not
        // be answered with a character sheet.
        const askedForImage = WANTS_IMAGE.test(question);

        const candidates = await withRls(db, user.orgId, user.id, async (tx) =>
          tx
            .select({ text: chunks.text, documentId: chunks.documentId })
            .from(embeddings)
            .innerJoin(chunks, eq(chunks.id, embeddings.entityId))
            .innerJoin(documents, eq(documents.id, chunks.documentId))
            .where(
              and(
                eq(embeddings.entityType, "chunk"),
                eq(embeddings.model, model),
                eq(chunks.orgId, user.orgId),
                // A picture's description is only prose worth reading when the
                // question is about pictures; otherwise it crowds out text.
                askedForImage ? undefined : sql`${documents.mime} NOT LIKE 'image/%'`,
              ),
            )
            .orderBy(sql`${embeddings.vec} <=> ${queryText}::vector`)
            .limit(24),
        );

        /*
         * At most two passages per document.
         *
         * A single verbose document — a 32-chunk screenplay, or a pile of image
         * descriptions — otherwise fills every slot, so a one-line note that
         * says who the reader is never reaches the model even when it is the
         * best match in the database.
         */
        const perDocument = new Map<string, number>();
        const rows: typeof candidates = [];
        for (const row of candidates) {
          const taken = perDocument.get(row.documentId) ?? 0;
          if (taken >= 2) continue;
          perDocument.set(row.documentId, taken + 1);
          rows.push(row);
          if (rows.length >= 6) break;
        }

        // Images the retrieved passages came from, but only when the question
        // was about pictures: an answer to "what is my name" that arrives with
        // three character sheets reads as if nothing was understood.
        const retrievedDocIds = [...new Set(rows.map((r) => r.documentId))];
        const groundedImages: ChatImage[] =
          retrievedDocIds.length === 0 || !askedForImage
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

        // The blocks that make memory survive a new chat.
        const profileBlock =
          facts.length === 0
            ? ""
            : [
                "What you already know about this reader, from earlier conversations:",
                ...facts.map((fact) => `- ${fact.predicate}: ${fact.object}`),
                "Use these without being asked when they are relevant, and never contradict them.",
              ].join("\n");
        const earlierBlock =
          earlier.length === 0
            ? ""
            : [
                "Related turns from the reader's other conversations:",
                ...earlier.map((turn) => `- (${shorten(turn.title, 40)}) ${shorten(turn.content)}`),
              ].join("\n");
        const documentsBlock =
          memory === ""
            ? "No documents were retrieved for this question."
            : `Passages retrieved from the workspace's documents:\n${memory}`;

        const shown =
          images.length > 0
            ? `\n\nThe user is being shown these images with your reply: ${images
                .map((i) => i.filename)
                .join(", ")}. Refer to them by name when it helps.`
            : "";

        // Answer in the reader's language: their explicit choice if they made
        // one, otherwise whatever the browser asked for. The language names are
        // spelled out because a locale tag means nothing to a model.
        const answerLocale =
          (request.user.locale && isLocale(request.user.locale)
            ? request.user.locale
            : null) ?? resolveLocale(request.headers["accept-language"]);
        const answerLanguage = LOCALE_NAMES[answerLocale];

        const adapter =
          chatKey.apiType === "anthropic"
            ? createAnthropicAdapter({ apiKey: chatKey.apiKey, baseUrl: chatKey.baseUrl })
            : createOpenAIAdapter({ apiKey: chatKey.apiKey, baseUrl: chatKey.baseUrl });
        const res = await adapter.chatCompletions({
          model: chatKey.chatModel,
          messages: [
            {
              role: "system",
              content: [
                CAPABILITIES,
                "",
                `Answer in ${answerLanguage}. Keep names, code, quotations and filenames as they are.`,
                profileBlock,
                earlierBlock,
                documentsBlock,
                shown,
                // A retry drops this whole prompt, so the same answer has to be
                // reachable from the question alone when the reader asks about
                // themselves.
                "If the answer is in the material above, answer from it directly — do not ask the reader for information they have already given you.",
              ]
                .filter((line) => line !== "")
                .join("\n"),
            },
            ...messages,
          ],
        });
        let upstream = res.choices[0]?.message;
        if ((upstream?.content ?? "").trim() === "") {
          // An empty answer is otherwise indistinguishable from "nothing to say",
          // and the difference decides the fix (a token budget, a reasoning
          // model, or a gateway that answered with an error object). Log the
          // shape, never the text.
          request.log.warn(
            {
              model: res.model,
              choices: res.choices.length,
              fields: Object.keys(upstream ?? {}),
              contentLength: (upstream?.content ?? "").length,
            },
            "chat provider returned an empty answer",
          );
          // One retry with a much shorter prompt: this model returns empty text
          // on some long, multi-part prompts, and the question alone is usually
          // answerable. The durable profile stays in — dropping it would make a
          // question about the reader unanswerable on the retry alone.
          try {
            const retry = await adapter.chatCompletions({
              model: chatKey.chatModel,
              max_tokens: 512,
              messages: [
                {
                  role: "system",
                  content: [
                    `Answer in ${answerLanguage}.`,
                    profileBlock,
                    "Answer the user's question directly, in a few sentences.",
                  ]
                    .filter((line) => line !== "")
                    .join("\n"),
                },
                ...messages,
              ],
            });
            if ((retry.choices[0]?.message?.content ?? "").trim() !== "") {
              upstream = retry.choices[0]?.message;
            }
          } catch {
            // The retry is best-effort; fall through to the honest message.
          }
        }
        // A provider can return no text at all, and a blank bubble with no
        // explanation reads as a broken app. Say which model went quiet, so the
        // next step (retry, or switch the chat key) is clear.
        const content =
          upstream?.content?.trim() ||
          (images.length > 0
            ? "No text came back with these images."
            : `"${chatKey.chatModel}" returned no answer for that question. Try again, or switch the chat key in LLM Keys.`);
        const message = { role: "assistant" as const, content };

        // Record the turn only once it is complete: a question whose answer
        // never arrived is not history worth reloading.
        const asked = await appendMessage(db, {
          chatId,
          orgId: user.orgId,
          role: "user",
          content: question,
        });
        const replied = await appendMessage(db, {
          chatId,
          orgId: user.orgId,
          role: "assistant",
          content: message.content,
          images,
        });

        return {
          chatId,
          message: { ...message, at: (replied?.createdAt ?? new Date()).toISOString() },
          userAt: (asked?.createdAt ?? new Date()).toISOString(),
          images,
        };
      },
    );
  };
