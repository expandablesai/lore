/**
 * @lore/core embedding — deterministic hash-based pseudo-embedding.
 *
 * Zero-config fallback so a fresh install works before any API key is entered.
 * SHA-256 of text → hex bytes → floats in [-1, 1] → zero-padded to 1536.
 *
 * This is NOT a semantic embedding — it provides lexical matching only.
 * Real providers (OpenAI, Ollama) replace it when configured.
 */

import { createHash } from "node:crypto";

/** Target dimension for all embeddings (matches pgvector column). */
export const EMBEDDING_DIM = 3072;

/** Deterministic fallback model identifier. */
export const HASH_MODEL = "hash";
export const HASH_DIM = 1024;

/**
 * Compute a deterministic pseudo-embedding from text.
 * Returns a Float32Array of length `dim` with values in [-1, 1].
 *
 * Algorithm: SHA-256(text) → 32 bytes → interpret pairs as uint16 →
 * map to [-1, 1] → repeat/pad to target dim.
 */
export function deterministicEmbed(text: string, dim: number = HASH_DIM): Float32Array {
  const vec = new Float32Array(dim);
  // Generate enough hash bytes by chaining
  let offset = 0;
  let round = 0;
  while (offset < dim) {
    const input = round === 0 ? text : `${text}\x00${round}`;
    const digest = createHash("sha256").update(input).digest();
    for (let i = 0; i < digest.length && offset < dim; i += 2) {
      // Two bytes → uint16 → float in [-1, 1]
      const raw = ((digest[i] ?? 0) << 8) | (digest[i + 1] ?? 0);
      vec[offset++] = (raw / 65535) * 2 - 1;
    }
    round++;
  }
  // Normalize to unit length for cosine similarity
  let norm = 0;
  for (let i = 0; i < dim; i++) { const v = vec[i] ?? 0; norm += v * v; }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) vec[i] = (vec[i] ?? 0) / norm;
  return vec;
}

/**
 * Zero-pad a shorter vector to the full 1536 dimension.
 * Zero-padding preserves cosine similarity exactly (dot product and both
 * norms are unchanged) — so a 1024-dim model is indexed and queried
 * correctly alongside a 1536-dim one.
 */
export function zeroPad(vec: Float32Array, targetDim: number = EMBEDDING_DIM): Float32Array {
  if (vec.length >= targetDim) return vec;
  const padded = new Float32Array(targetDim);
  padded.set(vec);
  return padded;
}

/** Convert a Float32Array to the pgvector text format: "[0.1,0.2,...]" */
export function vectorToPgText(vec: Float32Array): string {
  const parts: string[] = new Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    parts[i] = (vec[i] ?? 0).toFixed(6);
  }
  return `[${parts.join(",")}]`;
}
