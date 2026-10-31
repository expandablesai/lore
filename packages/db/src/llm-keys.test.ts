// Key selection: chat and embeddings may come from different providers, and
// the embedding key must match the vector space the stored chunks live in.
import { describe, expect, test } from "vitest";
import { orderEmbedKeys, pickChatKey, pickEmbedKey, pickVisionKey, type RevealedKey } from "./llm-keys.js";

function key(overrides: Partial<RevealedKey> & { label: string }): RevealedKey & { label: string } {
  return {
    apiKey: "k",
    apiType: "openai",
    baseUrl: "https://example.test/v1",
    chatModel: "chat-model",
    embedModel: "embed-model",
    embedDim: 768,
    visionModel: null,
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

describe("orderEmbedKeys", () => {
  test("tries the stored-space key first, then the rest", () => {
    const ordered = orderEmbedKeys([hosted, local, claude], "nomic-embed-text");
    expect(ordered.matched).toBe(local);
    expect(ordered.candidates).toEqual([local, hosted]);
  });

  test("with no stored vectors, every embeddable key stays available", () => {
    // A key can be configured to embed and still refuse the call, so the worker
    // keeps the others as fallbacks instead of giving up on the first failure.
    expect(orderEmbedKeys([hosted, local], null).candidates).toEqual([hosted, local]);
  });

  test("reports no match when the stored space is unreachable", () => {
    const ordered = orderEmbedKeys([hosted, claude], "nomic-embed-text");
    expect(ordered.matched).toBeNull();
    expect(ordered.candidates).toEqual([hosted]);
  });
});

describe("pickVisionKey", () => {
  test("prefers the key that names a vision model over the chat key", () => {
    const gateway = key({ label: "strata", chatModel: "strata-iq3-256", visionModel: "qwen2.5-vl-7b" });
    const picked = pickVisionKey([hosted, gateway, local]);
    expect(picked?.key).toBe(gateway);
    expect(picked?.model).toBe("qwen2.5-vl-7b");
  });

  test("falls back to the newest key's chat model when none names one", () => {
    const picked = pickVisionKey([hosted, local]);
    expect(picked?.key).toBe(hosted);
    expect(picked?.model).toBe("deepseek-chat");
  });

  test("treats a blank vision model as absent", () => {
    const blank = key({ label: "blank", chatModel: "gpt-4o", visionModel: "   " });
    expect(pickVisionKey([blank])?.model).toBe("gpt-4o");
  });

  test("returns null when the org has no active key", () => {
    expect(pickVisionKey([])).toBeNull();
  });
});