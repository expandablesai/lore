import { describe, it, expect } from "vitest";
import { deterministicEmbed, zeroPad, vectorToPgText, HASH_DIM, EMBEDDING_DIM } from "./embedding.js";

describe("deterministicEmbed", () => {
  it("produces a unit-length vector", () => {
    const vec = deterministicEmbed("hello world");
    expect(vec.length).toBe(HASH_DIM);
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i]! * vec[i]!;
    expect(Math.sqrt(norm)).toBeCloseTo(1, 4);
  });

  it("is deterministic (same input → same output)", () => {
    const a = deterministicEmbed("test text");
    const b = deterministicEmbed("test text");
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("different inputs produce different vectors", () => {
    const a = deterministicEmbed("alpha");
    const b = deterministicEmbed("beta");
    const same = Array.from(a).every((v, i) => v === b[i]);
    expect(same).toBe(false);
  });

  it("values are in [-1, 1]", () => {
    const vec = deterministicEmbed("range check");
    for (let i = 0; i < vec.length; i++) {
      expect(vec[i]).toBeGreaterThanOrEqual(-1);
      expect(vec[i]).toBeLessThanOrEqual(1);
    }
  });

  it("supports custom dimensions", () => {
    const vec = deterministicEmbed("custom", 256);
    expect(vec.length).toBe(256);
  });
});

describe("zeroPad", () => {
  it("pads to target dimension", () => {
    const short = deterministicEmbed("short", 1024);
    const padded = zeroPad(short, EMBEDDING_DIM);
    expect(padded.length).toBe(EMBEDDING_DIM);
    // Original values preserved
    for (let i = 0; i < 1024; i++) {
      expect(padded[i]).toBe(short[i]);
    }
    // Padding is zeros
    for (let i = 1024; i < EMBEDDING_DIM; i++) {
      expect(padded[i]).toBe(0);
    }
  });

  it("no-op when already at target", () => {
    const vec = deterministicEmbed("full", EMBEDDING_DIM);
    const padded = zeroPad(vec, EMBEDDING_DIM);
    expect(padded).toBe(vec);
  });

  it("zero-padding preserves cosine similarity", () => {
    const a = deterministicEmbed("alpha", 1024);
    const b = deterministicEmbed("beta", 1024);
    // Cosine before padding
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < 1024; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
    const cosBefore = dot / (Math.sqrt(na) * Math.sqrt(nb));
    // Cosine after padding
    const pa = zeroPad(a, 1536);
    const pb = zeroPad(b, 1536);
    let dot2 = 0, na2 = 0, nb2 = 0;
    for (let i = 0; i < 1536; i++) { dot2 += pa[i]! * pb[i]!; na2 += pa[i]! * pa[i]!; nb2 += pb[i]! * pb[i]!; }
    const cosAfter = dot2 / (Math.sqrt(na2) * Math.sqrt(nb2));
    expect(cosAfter).toBeCloseTo(cosBefore, 6);
  });
});

describe("vectorToPgText", () => {
  it("produces valid pgvector format", () => {
    const vec = new Float32Array([0.1, -0.2, 0.3]);
    const text = vectorToPgText(vec);
    expect(text).toMatch(/^\[[-\d.,]+\]$/);
    expect(text).toContain("0.100000");
  });

  it("round-trips through JSON parse", () => {
    const vec = deterministicEmbed("roundtrip", 8);
    const text = vectorToPgText(vec);
    const parsed = JSON.parse(text) as number[];
    expect(parsed).toHaveLength(8);
    for (let i = 0; i < 8; i++) {
      expect(parsed[i]).toBeCloseTo(vec[i]!, 5);
    }
  });
});

describe("zeroPad — fitting the pgvector column", () => {
  it("pads a shorter vector with zeros", () => {
    const fitted = zeroPad(new Float32Array([0.5, -0.5]), 8);
    expect(fitted).toHaveLength(8);
    expect(Array.from(fitted.slice(0, 2))).toEqual([0.5, -0.5]);
    expect(fitted[7]).toBe(0);
  });

  it("truncates a longer vector instead of overflowing the column", () => {
    const vec = new Float32Array(4096).fill(0.25);
    const fitted = zeroPad(vec, EMBEDDING_DIM);
    expect(fitted).toHaveLength(EMBEDDING_DIM);
    expect(fitted[EMBEDDING_DIM - 1]).toBeCloseTo(0.25, 5);
  });

  it("leaves a vector already at the target length alone", () => {
    expect(zeroPad(new Float32Array(EMBEDDING_DIM).fill(0.1), EMBEDDING_DIM)).toHaveLength(EMBEDDING_DIM);
  });
});