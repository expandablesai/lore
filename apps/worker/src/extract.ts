/**
 * @lore/worker extract — format-specific text extraction for ingestion.
 *
 * Each extractor returns pages (for page-cited formats) or flat text.
 * Runs inside the worker thread with memory limits.
 */

import { readFile } from "node:fs/promises";
import type { ChunkSpec } from "@lore/core";
import { chunkPages, chunkRows, chunkText } from "@lore/core";

/** Extraction result: either page-based or flat text. */
export interface ExtractionResult {
  pages: Array<{ page: number; text: string }> | null;
  text: string;
  pageCount: number | null;
  chunks: ChunkSpec[];
}

/**
 * Extract text from a PDF buffer using pdfjs-dist.
 * Returns per-page text for citation provenance.
 */
export async function extractPdf(buffer: Buffer): Promise<ExtractionResult> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages: Array<{ page: number; text: string }> = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .filter((item: unknown) => "str" in (item as Record<string, unknown>))
      .map((item: unknown) => (item as { str: string }).str)
      .join(" ");
    pages.push({ page: i, text });
  }

  const fullText = pages.map((p) => p.text).join("\n\n");
  const chunks = chunkPages(pages);
  return { pages, text: fullText, pageCount: doc.numPages, chunks };
}

/**
 * Extract text from a DOCX buffer using mammoth.
 * Converts to HTML then strips to text with heading markers.
 */
export async function extractDocx(buffer: Buffer): Promise<ExtractionResult> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value;
  const chunks = chunkText(text);
  return { pages: null, text, pageCount: null, chunks };
}

/**
 * Extract text from an XLSX buffer using exceljs.
 * Each sheet becomes a section; rows are chunked with header-aware text.
 */
export async function extractXlsx(buffer: Buffer): Promise<ExtractionResult> {
  const ExcelJS = (await import("exceljs")).default ?? (await import("exceljs"));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);

  const sections: string[] = [];
  const allChunks: ChunkSpec[] = [];
  let seq = 0;

  workbook.eachSheet((sheet) => {
    const rows: string[][] = [];
    sheet.eachRow((row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        cells.push(cell.text ?? "");
      });
      rows.push(cells);
    });

    if (rows.length > 0) {
      sections.push(`[Sheet: ${sheet.name}]\n${rows.map((r) => r.join("\t")).join("\n")}`);
      const sheetChunks = chunkRows(rows);
      for (const c of sheetChunks) {
        allChunks.push({ ...c, seq: seq++ });
      }
    }
  });

  const text = sections.join("\n\n");
  return { pages: null, text, pageCount: null, chunks: allChunks };
}

/**
 * Extract text from a CSV buffer.
 * Treated as a single sheet with header-aware chunking.
 */
export function extractCsv(buffer: Buffer): ExtractionResult {
  const text = buffer.toString("utf-8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const rows = lines.map((line) => parseCsvLine(line));
  const chunks = rows.length > 0 ? chunkRows(rows) : chunkText(text);
  return { pages: null, text, pageCount: null, chunks };
}

/** Simple CSV line parser (handles quoted fields). */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Extract text from plain text formats (MD, TXT, HTML).
 * Front-matter is preserved as part of the text.
 */
export function extractPlainText(buffer: Buffer): ExtractionResult {
  const text = buffer.toString("utf-8");
  const chunks = chunkText(text);
  return { pages: null, text, pageCount: null, chunks };
}

/**
 * Extract HTML text (strip tags, preserve structure).
 */
export function extractHtml(buffer: Buffer): ExtractionResult {
  const html = buffer.toString("utf-8");
  // Strip script/style blocks, then tags
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  const chunks = chunkText(text);
  return { pages: null, text, pageCount: null, chunks };
}

/** MIME type to extractor dispatch. */
export async function extractByMime(buffer: Buffer, mime: string): Promise<ExtractionResult> {
  if (mime === "application/pdf") return extractPdf(buffer);
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    return extractDocx(buffer);
  if (mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    return extractXlsx(buffer);
  if (mime === "text/csv") return extractCsv(buffer);
  if (mime === "text/html") return extractHtml(buffer);
  // text/plain, text/markdown, application/json, etc.
  return extractPlainText(buffer);
}
