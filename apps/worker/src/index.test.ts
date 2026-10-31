// @lore/worker index: blank-embedModel fallback trigger — the embed path gate
// (canEmbedKey) decides real vectors vs deterministic hash.
import { describe, expect, it } from "vitest";
import { canEmbedKey, type RevealedKey } from "@lore/db";
import { orphanedExtractions, planEmbedding } from "./index.ts";

function key(over: Partial<RevealedKey>): RevealedKey {
  return {
    apiKey: "sk-test",
    apiType: "openai",
    baseUrl: "https://api.openai.com/v1",
    chatModel: "gpt-4o",
    embedModel: "text-embedding-3-large",
    embedDim: 3072,
    visionModel: null,
    ...over,
  };
}

describe("embed path gate (canEmbedKey)", () => {
  it("no key at all falls back to deterministic", () => {
    expect(canEmbedKey(null)).toBe(false);
  });
  it("openai key with an embedding model uses real embeddings", () => {
    expect(canEmbedKey(key({}))).toBe(true);
  });
  it("openai key with blank embedding model falls back", () => {
    expect(canEmbedKey(key({ embedModel: "" }))).toBe(false);
  });
  it("anthropic key cannot embed even with a model set", () => {
    expect(canEmbedKey(key({ apiType: "anthropic", embedModel: "claude-embed" }))).toBe(false);
  });
  it("anthropic key with blank embedding model cannot embed", () => {
    expect(canEmbedKey(key({ apiType: "anthropic", embedModel: "" }))).toBe(false);
  });
});

describe("embedding plan (which vector space a document lands in)", () => {
  it("keeps indexing in the deterministic space instead of blocking on 'hash'", () => {
    // A key can never be named "hash", so treating hash like a real stored model
    // refused the second upload on a keyless install forever.
    expect(planEmbedding([key({})], "hash")).toEqual({ space: "hash" });
    expect(planEmbedding([], "hash")).toEqual({ space: "hash" });
  });

  it("pins to the key that reproduces a stored model", () => {
    const nomic = key({ embedModel: "nomic-embed-text", embedDim: 768 });
    const plan = planEmbedding(
      [key({ embedModel: "text-embedding-3-large" }), nomic],
      "nomic-embed-text",
    );
    expect(plan).toEqual({ space: "pinned", key: nomic });
  });

  it("refuses rather than mixing models when no key matches the stored space", () => {
    const plan = planEmbedding([key({ embedModel: "text-embedding-3-large" })], "nomic-embed-text");
    expect(plan.space).toBe("blocked");
    if (plan.space === "blocked") expect(plan.error).toContain("nomic-embed-text");
  });

  it("uses any embed-capable key when the org has no vectors yet", () => {
    expect(planEmbedding([key({}), key({ embedModel: "nomic-embed-text" })], null).space).toBe("candidates");
  });

  it("falls back to hash when the only keys cannot embed", () => {
    expect(planEmbedding([key({ apiType: "anthropic", embedModel: "claude-embed" })], null)).toEqual({
      space: "hash",
    });
  });
});

describe("abandoned extractions (which stuck documents nothing is working on)", () => {
  const stuck = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("treats every candidate as abandoned when the queue is empty", () => {
    expect(orphanedExtractions(stuck, new Set())).toEqual(["a", "b", "c"]);
  });

  it("never fails a document another worker still holds", () => {
    // `b` has a queued or running job: touching it would fail a healthy upload.
    expect(orphanedExtractions(stuck, new Set(["b"]))).toEqual(["a", "c"]);
  });

  it("says nothing when nothing is stuck", () => {
    expect(orphanedExtractions([], new Set(["a"]))).toEqual([]);
  });
});