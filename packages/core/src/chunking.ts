/**
 * @lore/core chunking — pure text segmentation for document ingestion.
 *
 * No HTTP, no DB. Operates on plain text with optional page boundaries.
 */

/** A chunk of normalized text with provenance coordinates. */
export interface ChunkSpec {
  seq: number;
  text: string;
  tokens: number;
  pageFrom: number | null;
  pageTo: number | null;
}

/** Approximate token count: 4 characters per token (GPT tokenizer heuristic). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Default chunk target in tokens. */
export const DEFAULT_CHUNK_TOKENS = 500;

/**
 * Split text into chunks targeting `targetTokens` each.
 * Splits on paragraph boundaries (double newline) when possible,
 * falls back to sentence boundaries, then hard character cuts.
 */
export function chunkText(
  text: string,
  targetTokens: number = DEFAULT_CHUNK_TOKENS,
): ChunkSpec[] {
  const targetChars = targetTokens * 4;
  const paragraphs = text.split(/\n{2,}/);
  const chunks: ChunkSpec[] = [];
  let buffer = "";
  let seq = 0;

  const flush = () => {
    const trimmed = buffer.trim();
    if (!trimmed) return;
    chunks.push({
      seq: seq++,
      text: trimmed,
      tokens: estimateTokens(trimmed),
      pageFrom: null,
      pageTo: null,
    });
    buffer = "";
  };

  for (const para of paragraphs) {
    if (buffer.length + para.length + 2 > targetChars && buffer.length > 0) {
      flush();
    }
    if (para.length > targetChars) {
      // Hard-split oversized paragraphs on sentence boundaries
      const sentences = para.split(/(?<=[.!?])\s+/);
      for (const sentence of sentences) {
        if (buffer.length + sentence.length + 1 > targetChars && buffer.length > 0) {
          flush();
        }
        buffer += (buffer ? " " : "") + sentence;
      }
    } else {
      buffer += (buffer ? "\n\n" : "") + para;
    }
  }
  flush();
  return chunks;
}

/**
 * Chunk per-page text (PDF extraction output).
 * Each page's text is chunked independently; page numbers are preserved
 * for citation provenance.
 */
export function chunkPages(
  pages: Array<{ page: number; text: string }>,
  targetTokens: number = DEFAULT_CHUNK_TOKENS,
): ChunkSpec[] {
  const chunks: ChunkSpec[] = [];
  let seq = 0;

  for (const { page, text } of pages) {
    const pageChunks = chunkText(text, targetTokens);
    for (const c of pageChunks) {
      chunks.push({
        seq: seq++,
        text: c.text,
        tokens: c.tokens,
        pageFrom: page,
        pageTo: page,
      });
    }
  }
  return chunks;
}

/**
 * Chunk spreadsheet rows into blocks of `rowsPerChunk` with header-aware text.
 * The first row is treated as the header.
 */
export function chunkRows(
  rows: string[][],
  rowsPerChunk: number = 500,
): ChunkSpec[] {
  if (rows.length === 0) return [];
  const header = rows[0];
  const dataRows = rows.slice(1);
  const chunks: ChunkSpec[] = [];
  let seq = 0;

  for (let i = 0; i < dataRows.length; i += rowsPerChunk) {
    const block = dataRows.slice(i, i + rowsPerChunk);
    const lines = block.map((row) =>
      row.map((cell, ci) => `${header[ci] ?? `col${ci}`}: ${cell}`).join(" | "),
    );
    const text = lines.join("\n");
    chunks.push({
      seq: seq++,
      text,
      tokens: estimateTokens(text),
      pageFrom: null,
      pageTo: null,
    });
  }
  return chunks;
}
