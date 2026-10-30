import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAIAdapter } from "./index.js";

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
