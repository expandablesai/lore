// @lore/worker index: blank-embedModel fallback trigger — the embed path gate
// (canEmbedKey) decides real vectors vs deterministic hash.
import { describe, expect, it } from "vitest";
import { canEmbedKey, type RevealedKey } from "@lore/db";

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
