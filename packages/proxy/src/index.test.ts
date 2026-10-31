import { afterEach, describe, expect, it, vi } from "vitest";
import { createAnthropicAdapter, createOpenAIVisioner, createOpenAIAdapter, createOpenAIEmbedder, listModels } from "./index.js";

describe("openai adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to /chat/completions and maps the assistant reply", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(
        JSON.stringify({
          id: "c1",
          model: "gpt-4o-mini",
          choices: [{ message: { role: "assistant", content: "hi there" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = createOpenAIAdapter({ apiKey: "sk-test" });
    const res = await adapter.chatCompletions({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(res.id).toBe("c1");
    expect(res.choices[0]?.message.content).toBe("hi there");

    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    const init = call?.[1];
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer sk-test");
  });

  it("throws with the upstream status on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init: RequestInit) =>
        new Response("invalid api key", { status: 401 }),
      ),
    );
    const adapter = createOpenAIAdapter({ apiKey: "sk-bad" });
    await expect(
      adapter.chatCompletions({ model: "m", messages: [{ role: "user", content: "x" }] }),
    ).rejects.toThrow(/401/);
  });
});

describe("openai embedder", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to /embeddings and returns float vectors", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(
        JSON.stringify({ data: [{ embedding: [1, 2, 3] }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const embedder = createOpenAIEmbedder({ apiKey: "sk-test" });
    const vecs = await embedder.embed("hello", "text-embedding-3-large");
    expect(Array.from(vecs[0] ?? [])).toEqual([1, 2, 3]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/embeddings");
  });
});

describe("anthropic adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to /v1/messages with x-api-key and maps content text to a chat reply", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(
        JSON.stringify({
          id: "msg_1",
          model: "claude-3-5-sonnet-latest",
          content: [{ type: "text", text: "pong" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = createAnthropicAdapter({ apiKey: "sk-ant-test" });
    const res = await adapter.chatCompletions({
      model: "claude-3-5-sonnet-latest",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "ping" },
      ],
    });

    expect(res.id).toBe("msg_1");
    expect(res.choices[0]?.message.role).toBe("assistant");
    expect(res.choices[0]?.message.content).toBe("pong");

    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe("https://api.anthropic.com/v1/messages");
    const init = call?.[1];
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      system: string;
      messages: { role: string; content: string }[];
      max_tokens: number;
    };
    expect(body.model).toBe("claude-3-5-sonnet-latest");
    expect(body.system).toBe("You are helpful.");
    expect(body.messages).toEqual([{ role: "user", content: "ping" }]);
    expect(body.max_tokens).toBeGreaterThan(0);
  });

  it("normalizes a /v1-suffixed base URL without doubling", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(
        JSON.stringify({ id: "m", model: "c", content: [{ type: "text", text: "ok" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createAnthropicAdapter({
      apiKey: "sk-ant-test",
      baseUrl: "https://api.anthropic.com/v1",
    });
    await adapter.chatCompletions({
      model: "claude-3-5-sonnet-latest",
      messages: [{ role: "user", content: "x" }],
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/v1/messages");
  });

  it("messages() posts the native shape and returns content blocks", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(
        JSON.stringify({
          id: "msg_2",
          model: "claude-3-5-sonnet-latest",
          content: [{ type: "text", text: "hi" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createAnthropicAdapter({ apiKey: "sk-ant-test" });
    const res = await adapter.messages({
      model: "claude-3-5-sonnet-latest",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 64,
    });
    expect(res.content[0]?.text).toBe("hi");
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { max_tokens: number };
    expect(body.max_tokens).toBe(64);
  });

  it("throws with the upstream status on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init: RequestInit) =>
        new Response("invalid api key", { status: 401 }),
      ),
    );
    const adapter = createAnthropicAdapter({ apiKey: "sk-ant-bad" });
    await expect(
      adapter.chatCompletions({
        model: "claude-3-5-sonnet-latest",
        messages: [{ role: "user", content: "x" }],
      }),
    ).rejects.toThrow(/401/);
  });
});

describe("openai visioner", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the image as a data URL beside the prompt and returns the description", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(
        JSON.stringify({
          id: "v1",
          model: "strata-vision",
          choices: [{ message: { role: "assistant", content: "  A composite of six saree photographs.  " } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const visioner = createOpenAIVisioner({ apiKey: "sk-v", baseUrl: "http://strata.local:4000/v1" });
    const text = await visioner.describe({
      model: "strata-vision",
      imageDataUrl: "data:image/png;base64,AAAA",
    });

    expect(text).toBe("A composite of six saree photographs.");
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://strata.local:4000/v1/chat/completions");
    const body = JSON.parse(String((init as RequestInit).body)) as {
      model: string;
      messages: { content: { type: string; image_url?: { url: string } }[] }[];
    };
    expect(body.model).toBe("strata-vision");
    const parts = body.messages[0]?.content ?? [];
    expect(parts[0]?.type).toBe("text");
    expect(parts[1]?.type).toBe("image_url");
    expect(parts[1]?.image_url?.url).toBe("data:image/png;base64,AAAA");
  });

  it("accepts a provider that returns the content as parts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init: RequestInit) =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: [{ type: "text", text: "a red saree" }] } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const visioner = createOpenAIVisioner({ apiKey: "sk-v", baseUrl: "http://gw/v1" });
    expect(await visioner.describe({ model: "m", imageDataUrl: "data:image/png;base64,AA" })).toBe("a red saree");
  });

  it("lists the models a gateway advertises", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ data: [{ id: "strata-iq3-256" }, { id: "qwen2.5-vl-7b" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const ids = await listModels({ apiKey: "sk-v", baseUrl: "http://gw/v1" });
    expect(ids).toEqual(["strata-iq3-256", "qwen2.5-vl-7b"]);
  });
});