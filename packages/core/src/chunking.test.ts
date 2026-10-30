import { describe, it, expect } from "vitest";
import { chunkText, chunkPages, chunkRows, estimateTokens } from "./chunking.js";

describe("estimateTokens", () => {
  it("returns at least 1 for empty string", () => {
    expect(estimateTokens("")).toBe(1);
  });

  it("estimates ~4 chars per token", () => {
    expect(estimateTokens("a".repeat(100))).toBe(25);
  });
});

describe("chunkText", () => {
  it("returns empty array for empty input", () => {
    expect(chunkText("")).toEqual([]);
  });

  it("single paragraph fits in one chunk", () => {
    const chunks = chunkText("Hello world, this is a short text.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toBe("Hello world, this is a short text.");
    expect(chunks[0]!.seq).toBe(0);
  });

  it("splits long text into multiple chunks", () => {
    const para = "word ".repeat(600); // ~3000 chars = ~750 tokens
    const chunks = chunkText(`${para}\n\n${para}`);
    expect(chunks.length).toBeGreaterThan(1);
    // Seq is monotonically increasing
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i]!.seq).toBe(i);
    }
  });

  it("respects target token budget", () => {
    const text = Array.from({ length: 20 }, (_, i) => `Paragraph ${i}: ${"lorem ipsum ".repeat(50)}`).join("\n\n");
    const chunks = chunkText(text, 100);
    for (const c of chunks) {
      // Allow some overshoot for single paragraphs that exceed target
      expect(c.tokens).toBeLessThanOrEqual(200);
    }
  });
});

describe("chunkPages", () => {
  it("preserves page numbers for citations", () => {
    const pages = [
      { page: 1, text: "First page content here." },
      { page: 2, text: "Second page content here." },
      { page: 3, text: "Third page content here." },
    ];
    const chunks = chunkPages(pages);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]!.pageFrom).toBe(1);
    expect(chunks[0]!.pageTo).toBe(1);
    expect(chunks[2]!.pageFrom).toBe(3);
    expect(chunks[2]!.pageTo).toBe(3);
  });

  it("handles multi-chunk pages", () => {
    const longText = "sentence. ".repeat(500);
    const pages = [{ page: 5, text: longText }];
    const chunks = chunkPages(pages, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.pageFrom).toBe(5);
      expect(c.pageTo).toBe(5);
    }
  });
});

describe("chunkRows", () => {
  it("returns empty for no rows", () => {
    expect(chunkRows([])).toEqual([]);
  });

  it("header-aware text in chunks", () => {
    const rows = [
      ["Name", "Age", "City"],
      ["Alice", "30", "NYC"],
      ["Bob", "25", "LA"],
    ];
    const chunks = chunkRows(rows, 500);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toContain("Name: Alice");
    expect(chunks[0]!.text).toContain("Age: 30");
    expect(chunks[0]!.text).toContain("City: NYC");
    expect(chunks[0]!.text).toContain("Name: Bob");
    expect(chunks[0]!.text).toContain("City: LA");
  });

  it("splits large sheets by rowsPerChunk", () => {
    const header = ["col1", "col2"];
    const dataRows = Array.from({ length: 1200 }, (_, i) => [`r${i}`, `v${i}`]);
    const chunks = chunkRows([header, ...dataRows], 500);
    expect(chunks).toHaveLength(3); // 1200 / 500 = 2.4 → 3 chunks
  });
});
