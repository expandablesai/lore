// Key selection: chat and embeddings may come from different providers, and
// the embedding key must match the vector space the stored chunks live in.
import { describe, expect, test } from "vitest";
import { pickChatKey, pickEmbedKey, type RevealedKey } from "./llm-keys.js";

function key(overrides: Partial<RevealedKey> & { label: string }): RevealedKey & { label: string } {
  return {
    apiKey: "k",
    apiType: "openai",
    baseUrl: "https://example.test/v1",
    chatModel: "chat-model",
    embedModel: "embed-model",
    embedDim: 768,
    ...overrides,
  };
}

const hosted = key({
  label: "hosted",
  baseUrl: "https://api.deepseek.com/v1",
  chatModel: "deepseek-chat",
  embedModel: "text-embedding-3-large",
  embedDim: 3072,
});
const local = key({
  label: "local",
  baseUrl: "http://10.20.10.52:11434/v1",
  chatModel: "llama3.1",
  embedModel: "nomic-embed-text",
  embedDim: 768,
});
const claude = key({
  label: "claude",
  apiType: "anthropic",
  chatModel: "claude-3-5-sonnet-latest",
  embedModel: "",
});

describe("pickChatKey", () => {
  test("takes the newest active key", () => {
    expect(pickChatKey([hosted, local])).toBe(hosted);
  });

  test("returns null when the org has no active key", () => {
    expect(pickChatKey([])).toBeNull();
  });
});

describe("pickEmbedKey", () => {
  test("reuses the model the existing chunks were indexed with", () => {
    // Newest key embeds with text-embedding-3-large, but the org's vectors came
    // from nomic-embed-text — mixing spaces would return noise, not memories.
    expect(pickEmbedKey([hosted, local], "nomic-embed-text")).toBe(local);
  });

  test("returns null when no active key can reproduce the stored space", () => {
    expect(pickEmbedKey([hosted], "nomic-embed-text")).toBeNull();
  });

  test("with no stored vectors, takes the newest key that can embed", () => {
    expect(pickEmbedKey([claude, local, hosted], null)).toBe(local);
  });

  test("skips chat-only keys", () => {
    expect(pickEmbedKey([claude], null)).toBeNull();
  });
});
