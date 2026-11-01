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

/** Up to CANDIDATE_LIMIT chunks, best cosine match first. */
export async function rankCandidates(
  db: Db,
  input: { orgId: string; userId: string; queryText: string; model: string; askedForImage: boolean },
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
      .limit(CANDIDATE_LIMIT),
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

/** Everything `/chat` needs from retrieval, and everything the inspector shows. */
export async function selectContext(
  db: Db,
  input: { orgId: string; userId: string; question: string; keys?: RevealedKey[] },
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
  });
  const { selected, dropped } = applyPassageCap(candidates);
  const facts = await loadSelfFacts(db, input.orgId, input.userId);

  return { model, queryText, askedForImage, candidates, selected, dropped, facts };
}
