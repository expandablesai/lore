/**
 * The retrieval half of a chat turn, lifted out of the route.
 *
 * It lives here for one reason: the answer depends on *which* passages were
 * selected, and until this existed the only way to find out was to read the
 * SQL. Both `/chat` and the read-only `GET /recall/context` call this, so what
 * the benchmark measures is the code that actually answers, not a copy of it
 * that can drift.
 *
 * The pipeline, in order:
 *   1. embed the question in the space the org's chunks live in;
 *   2. rank up to 24 candidates by cosine distance (pictures excluded unless
 *      the question is about pictures);
 *   3. keep at most 2 passages per document until 6 are chosen, so one long
 *      document cannot fill every slot;
 *   4. add the durable facts the reader has stated in any conversation.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  assertions,
  canEmbedKey,
  chunks,
  documents,
  dominantEmbeddingModel,
  embeddings,
  pickEmbedKey,
  revealActiveLlmKeys,
  withRls,
  type Db,
  type RevealedKey,
} from "@lore/db";
import { createOpenAIEmbedder } from "@lore/proxy";
import {
  EMBEDDING_DIM,
  HASH_DIM,
  HASH_MODEL,
  deterministicEmbed,
  vectorToPgText,
  zeroPad,
} from "@lore/core";

/** How many chunks the ranking may consider before any cap is applied. */
export const CANDIDATE_LIMIT = 24;

/** How many passages travel to the model. */
export const PASSAGE_LIMIT = 6;

/** And how many of them may come from one document. */
export const PASSAGES_PER_DOCUMENT = 2;

/**
 * Whether the question is about a document as a whole rather than a point in it.
 *
 * "Tell me everything about X", "summarise the file", "what is this document" —
 * for these the diversity cap is actively wrong: two passages out of eighteen
 * cannot describe the eighteen, and the other four slots are then filled with
 * unrelated documents. Detected from the words people use to ask for the whole
 * thing, so the behaviour is explainable rather than a hidden heuristic.
 */
export const WANTS_WHOLE_DOCUMENT =
  /\b(everything|all about|full|entire|whole|complete|summar(?:y|ise|ize|ised|ized)|overview|the document|this document|the file|this file|the upload|the report)\b/i;

/**
 * How much of that one document may travel.
 *
 * The gateways in use serve 256K contexts (qwen on the Mac, strata on Windows),
 * so a document is no longer cut to fit a small window: the budget is generous
 * enough for a long report and the prompt around it. It is still a budget rather
 * than "everything": a 200-page PDF must not turn one question into a
 * million-token request. Keys with a genuinely small context (a local Ollama
 * model configured with 4096) will be truncated by their own server — that is the
 * provider's setting, not something this constant can guess per key.
 */
export const DOCUMENT_TOKEN_BUDGET = 24000;

/** The subject every self-stated fact is stored under. */
export const USER_SUBJECT = "the user";

/**
 * Whether the question is about pictures.
 *
 * Decided before retrieval because it changes what counts as relevant: an image
 * is indexed as a description, so "what is my name" must not be answered from a
 * character sheet.
 */
export const WANTS_IMAGE =
  /\b(image|images|picture|pictures|photo|photos|screenshot|screenshots|scan|scans|visual|portfolio|design|drawing|diagram|look like|show)\b/i;

export interface Candidate {
  text: string;
  documentId: string;
  filename: string;
  mime: string;
  distance: number;
}

export interface DroppedPassage {
  documentId: string;
  filename: string;
  reason: string;
}

export interface CompiledContext {
  /** The embedding model the query was embedded with. */
  model: string;
  /** The query vector as pgvector text, reusable for image lookups. */
  queryText: string;
  askedForImage: boolean;
  /** Everything the ranking offered, best first, before the per-document cap. */
  candidates: Candidate[];
  /** The passages the model is actually given. */
  selected: Candidate[];
  /** Candidates the per-document cap threw away, with why. */
  dropped: DroppedPassage[];
  /** Durable facts the reader has stated, newest first. */
  facts: Array<{ predicate: string; object: string }>;
}

/** Every durable fact this reader has stated, newest first. */
export async function loadSelfFacts(
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

/**
 * Embed the question in the stored chunks' vector space.
 *
 * A key that is down or misconfigured must not take the whole answer with it:
 * retrieval falls back to the local hash space, the reply is still produced, and
 * the images and provenance stay intact.
 */
export async function buildQueryVector(
  keys: RevealedKey[],
  storedModel: string | null,
  question: string,
): Promise<{ vec: Float32Array; model: string }> {
  const key = pickEmbedKey(keys, storedModel);
  if (key && canEmbedKey(key)) {
    try {
      const embedded = await createOpenAIEmbedder({ apiKey: key.apiKey, baseUrl: key.baseUrl }).embed(
        question,
        key.embedModel,
      );
      const first = embedded[0];
      if (first) return { vec: first, model: key.embedModel };
    } catch {
      // fall through to the local space
    }
  }
  return { vec: deterministicEmbed(question, HASH_DIM), model: HASH_MODEL };
}

/** Up to `limit` chunks, best cosine match first. */
export async function rankCandidates(
  db: Db,
  input: {
    orgId: string;
    userId: string;
    queryText: string;
    model: string;
    askedForImage: boolean;
    limit?: number;
  },
): Promise<Candidate[]> {
  return withRls(db, input.orgId, input.userId, async (tx) =>
    tx
      .select({
        text: chunks.text,
        documentId: chunks.documentId,
        filename: documents.filename,
        mime: documents.mime,
        distance: sql<number>`${embeddings.vec} <=> ${input.queryText}::vector`,
      })
      .from(embeddings)
      .innerJoin(chunks, eq(chunks.id, embeddings.entityId))
      .innerJoin(documents, eq(documents.id, chunks.documentId))
      .where(
        and(
          eq(embeddings.entityType, "chunk"),
          eq(embeddings.model, input.model),
          eq(chunks.orgId, input.orgId),
          // A picture's description is only prose worth reading when the
          // question is about pictures; otherwise it crowds out text.
          input.askedForImage ? undefined : sql`${documents.mime} NOT LIKE 'image/%'`,
        ),
      )
      .orderBy(sql`${embeddings.vec} <=> ${input.queryText}::vector`)
      .limit(input.limit ?? CANDIDATE_LIMIT),
  );
}

/**
 * At most two passages per document, until six are chosen.
 *
 * A single verbose document — a 32-chunk screenplay, or a pile of image
 * descriptions — otherwise fills every slot, so a one-line note that says who
 * the reader is never reaches the model even when it is the best match in the
 * database.
 */
export function applyPassageCap(
  candidates: Candidate[],
  limit = PASSAGE_LIMIT,
  perDocument = PASSAGES_PER_DOCUMENT,
): { selected: Candidate[]; dropped: DroppedPassage[] } {
  const taken = new Map<string, number>();
  const selected: Candidate[] = [];
  const dropped: DroppedPassage[] = [];
  for (const row of candidates) {
    if (selected.length >= limit) {
      dropped.push({
        documentId: row.documentId,
        filename: row.filename,
        reason: `beyond the ${limit} passage limit`,
      });
      continue;
    }
    const used = taken.get(row.documentId) ?? 0;
    if (used >= perDocument) {
      dropped.push({
        documentId: row.documentId,
        filename: row.filename,
        reason: `already ${perDocument} passages from this document`,
      });
      continue;
    }
    taken.set(row.documentId, used + 1);
    selected.push(row);
  }
  return { selected, dropped };
}

/**
 * Optional limits, for measuring rather than for answering.
 *
 * `/chat` never passes them: the product's numbers are the constants above. The
 * inspector does, so the golden set can be re-scored at a different cap without a
 * redeploy — which is the only way a tuning decision can be made on evidence.
 */
export interface ContextLimits {
  candidates?: number;
  limit?: number;
  perDocument?: number;
}

/**
 * The first rows that fit a token budget, in the order given.
 *
 * Always returns at least one row when there is one: a single passage larger than
 * the whole budget is still better than answering from nothing.
 */
export function fitToTokenBudget<T extends { tokens: number }>(
  rows: T[],
  budget = DOCUMENT_TOKEN_BUDGET,
): T[] {
  const fitted: T[] = [];
  let used = 0;
  for (const row of rows) {
    if (fitted.length > 0 && used + row.tokens > budget) break;
    fitted.push(row);
    used += row.tokens;
  }
  return fitted;
}

/**
 * The top-ranked document, in reading order, up to the budget.
 *
 * Only for whole-document questions; null otherwise, so the ordinary path keeps
 * its measured behaviour. Reading order (rather than relevance order) is what
 * makes a summary of that document possible: the model sees its beginning and its
 * structure, not six similar paragraphs.
 */
export async function expandWholeDocument(
  db: Db,
  input: {
    orgId: string;
    userId: string;
    question: string;
    candidates: Candidate[];
    model: string;
    queryText: string;
  },
): Promise<Candidate[] | null> {
  if (!WANTS_WHOLE_DOCUMENT.test(input.question)) return null;
  const top = input.candidates[0];
  if (!top) return null;

  const rows = await withRls(db, input.orgId, input.userId, async (tx) =>
    tx
      .select({
        text: chunks.text,
        documentId: chunks.documentId,
        filename: documents.filename,
        mime: documents.mime,
        tokens: chunks.tokens,
        distance: sql<number>`${embeddings.vec} <=> ${input.queryText}::vector`,
      })
      .from(chunks)
      .innerJoin(
        embeddings,
        and(eq(embeddings.entityId, chunks.id), eq(embeddings.entityType, "chunk")),
      )
      .innerJoin(documents, eq(documents.id, chunks.documentId))
      .where(
        and(
          eq(chunks.documentId, top.documentId),
          eq(chunks.orgId, input.orgId),
          eq(embeddings.model, input.model),
        ),
      )
      .orderBy(chunks.seq),
  );

  return fitToTokenBudget(rows).map(({ tokens: _tokens, ...rest }) => rest);
}

/** Everything `/chat` needs from retrieval, and everything the inspector shows. */
export async function selectContext(
  db: Db,
  input: {
    orgId: string;
    userId: string;
    question: string;
    keys?: RevealedKey[];
    limits?: ContextLimits;
  },
): Promise<CompiledContext> {
  const keys = input.keys ?? (await revealActiveLlmKeys(db, input.orgId));
  const storedModel = await dominantEmbeddingModel(db, input.orgId);
  const { vec, model } = await buildQueryVector(keys, storedModel, input.question);
  const queryText = vectorToPgText(zeroPad(vec, EMBEDDING_DIM));
  const askedForImage = WANTS_IMAGE.test(input.question);

  const candidates = await rankCandidates(db, {
    orgId: input.orgId,
    userId: input.userId,
    queryText,
    model,
    askedForImage,
    limit: input.limits?.candidates ?? CANDIDATE_LIMIT,
  });

  // A whole-document question is answered from that document's own chunks in
  // reading order, up to a token budget. The diversity cap is skipped on purpose:
  // two passages out of eighteen cannot describe the eighteen. Measuring callers
  // (the inspector's overrides) keep the plain path, so the benchmark is
  // unaffected.
  const expanded = input.limits
    ? null
    : await expandWholeDocument(db, {
        orgId: input.orgId,
        userId: input.userId,
        question: input.question,
        candidates,
        model,
        queryText,
      });

  let selected: Candidate[];
  let dropped: DroppedPassage[];
  if (expanded) {
    selected = expanded;
    const used = new Set(expanded.map((row) => `${row.documentId}:${row.text}`));
    dropped = candidates
      .filter((row) => !used.has(`${row.documentId}:${row.text}`))
      .map((row) => ({
        documentId: row.documentId,
        filename: row.filename,
        reason: "the whole-document question was answered from one document",
      }));
  } else {
    ({ selected, dropped } = applyPassageCap(
      candidates,
      input.limits?.limit ?? PASSAGE_LIMIT,
      input.limits?.perDocument ?? PASSAGES_PER_DOCUMENT,
    ));
  }

  const facts = await loadSelfFacts(db, input.orgId, input.userId);

  return { model, queryText, askedForImage, candidates, selected, dropped, facts };
}
