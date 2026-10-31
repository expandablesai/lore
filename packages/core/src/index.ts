/**
 * @lore/core — pure domain logic for the LORE memory system.
 *
 * No HTTP and no database imports here: only domain types and constants.
 */

/** Trust tier for a memory item, from unverified (T0) to fully trusted (T3). */
export enum TrustTier {
  T0 = 0,
  T1 = 1,
  T2 = 2,
  T3 = 3,
}

/** Allocation of the compiler's context budget, as fractions summing to 1. */
export interface CompilerBudget {
  /** Hard rules and invariants. */
  readonly constraints: number;
  /** Prior architectural decisions. */
  readonly decisions: number;
  /** Grounded facts. */
  readonly facts: number;
  /** Supporting evidence. */
  readonly evidence: number;
  /** Reserved slack for open context. */
  readonly open: number;
}

/** Default compiler budget: 30 / 25 / 25 / 15 / 5. */
export const DEFAULT_COMPILER_BUDGET: CompilerBudget = {
  constraints: 0.3,
  decisions: 0.25,
  facts: 0.25,
  evidence: 0.15,
  open: 0.05,
};

/** Component weights for retrieval scoring, as fractions summing to 1. */
export interface RetrievalWeights {
  /** Vector cosine similarity. */
  readonly cos: number;
  /** Time-since / rank decay. */
  readonly ts_rank: number;
  /** Knowledge-graph linkage. */
  readonly graph: number;
  /** Recency of last update. */
  readonly recency: number;
  /** Trust tier contribution. */
  readonly trust: number;
}

/** Default retrieval weights: 0.45 / 0.25 / 0.15 / 0.10 / 0.05. */
export const DEFAULT_RETRIEVAL_WEIGHTS: RetrievalWeights = {
  cos: 0.45,
  ts_rank: 0.25,
  graph: 0.15,
  recency: 0.1,
  trust: 0.05,
};

/** Per-component normalized signals, each in [0, 1]. */
export interface RetrievalSignals {
  readonly cos: number;
  readonly ts_rank: number;
  readonly graph: number;
  readonly recency: number;
  readonly trust: number;
}

/** Weighted retrieval score in [0, 1] given normalized signals. */
export function scoreRetrieval(
  signals: RetrievalSignals,
  weights: RetrievalWeights = DEFAULT_RETRIEVAL_WEIGHTS,
): number {
  return (
    signals.cos * weights.cos +
    signals.ts_rank * weights.ts_rank +
    signals.graph * weights.graph +
    signals.recency * weights.recency +
    signals.trust * weights.trust
  );
}

export { type ChunkSpec, estimateTokens, DEFAULT_CHUNK_TOKENS, chunkText, chunkPages, chunkRows } from "./chunking.js";
export { EMBEDDING_DIM, HASH_MODEL, HASH_DIM, deterministicEmbed, zeroPad, vectorToPgText } from "./embedding.js";
export {
  LOCALES,
  DEFAULT_LOCALE,
  LOCALE_LABELS,
  LOCALE_NAMES,
  isLocale,
  resolveLocale,
  type Locale,
} from "./locales.js";
