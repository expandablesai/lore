// M10 persistent memory: what the reader says in one conversation is available
// in the next one — as durable facts, and as related earlier turns.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { createDb, type Db } from "@lore/db";
import type { FastifyInstance } from "fastify";
import { createApp } from "../app.ts";
import { extractSelfFacts } from "./chat.ts";

process.env.LORE_ENCRYPTION_KEY ??= "0".repeat(64);

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://lore:lore@localhost:5432/lore_test";

/** OpenAI-shaped reply that records the system prompt it was sent. */
function captureReply(text = "understood") {
  const system: string[] = [];
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { messages: Array<{ role: string; content: string }> };
    system.push(body.messages.find((m) => m.role === "system")?.content ?? "");
    return new Response(
      JSON.stringify({ id: "c1", model: "test-model", choices: [{ message: { role: "assistant", content: text } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  return { fetchMock, system };
}

describe("extractSelfFacts", () => {
  test("captures an explicit first-person statement", () => {
    expect(extractSelfFacts("my name is DK")).toEqual([{ predicate: "name", object: "DK" }]);
  });

  test("trims the punctuation around what was said", () => {
    expect(extractSelfFacts("identity lock it and my name is DK.")).toEqual([
      { predicate: "name", object: "DK" },
    ]);
  });

  test("captures a note the reader asks to keep", () => {
    expect(extractSelfFacts("remember that the codename is ORCHID")).toEqual([
      { predicate: "note", object: "the codename is ORCHID" },
    ]);
  });

  test("ignores first-person states that are not facts about the reader", () => {
    expect(extractSelfFacts("I am tired and I am not sure")).toEqual([]);
    expect(extractSelfFacts("what is my name?")).toEqual([]);
  });
});

describe("M10 persistent memory across chats", () => {
  let db: Db;
  let app: FastifyInstance;
  let token: string;
  let orgId: string;

  const ask = (content: string, chatId?: string) =>
    app.inject({
      method: "POST",
      url: "/chat",
      headers: { authorization: `Bearer ${token}` },
      payload: { chatId, messages: [{ role: "user", content }] },
    });

  beforeAll(async () => {
    db = createDb(DATABASE_URL);
    app = createApp(db);
    await app.ready();
    const suffix = crypto.randomUUID().slice(0, 8);
    const r = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: {
        email: `m10-${suffix}@example.test`,
        password: "m10-password-1",
        displayName: "M10",
        orgName: `M10 Org ${suffix}`,
      },
    });
    const body = r.json() as { token: string; user: { orgId: string } };
    token = body.token;
    orgId = body.user.orgId;

    const key = await app.inject({
      method: "POST",
      url: `/orgs/${orgId}/llm-keys`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        label: "m10-chat",
        apiKey: "sk-m10-test-key",
        provider: "custom",
        baseUrl: "http://127.0.0.1:9/v1",
        chatModel: "test-model",
      },
    });
    if (key.statusCode !== 201) throw new Error(`key setup failed: ${key.statusCode} ${key.body}`);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("a fact stated in one chat answers a question in the next", async () => {
    const first = captureReply("Nice to meet you, DK.");
    vi.stubGlobal("fetch", first.fetchMock);
    expect((await ask("my name is DK")).statusCode).toBe(200);

    const second = captureReply("Your name is DK.");
    vi.stubGlobal("fetch", second.fetchMock);
    const r = await ask("what is my name?");
    expect(r.statusCode).toBe(200);

    // The new conversation starts empty, yet the prompt carries the fact.
    expect(second.system[0]).toContain("name: DK");
    expect(second.system[0]).toContain("What you already know about this reader");
  });

  test("the same fact told twice is stored once", async () => {
    vi.stubGlobal("fetch", captureReply().fetchMock);
    await ask("my name is DK");
    await ask("my name is DK");

    const recalled = await app.inject({
      method: "POST",
      url: "/recall",
      headers: { authorization: `Bearer ${token}` },
      payload: { scope: "personal" },
    });
    const rows = recalled.json() as Array<{ subject: string; predicate: string; object: string }>;
    const names = rows.filter((row) => row.predicate === "name" && row.object === "DK");
    expect(names).toHaveLength(1);
    expect(names[0]?.subject).toBe("the user");
  });

  test("a related earlier turn is carried into a new conversation", async () => {
    const question = "which gate sits in front of the console";
    const first = captureReply("The Authelia gate.");
    vi.stubGlobal("fetch", first.fetchMock);
    expect((await ask(question)).statusCode).toBe(200);

    const second = captureReply("Authelia, as discussed.");
    vi.stubGlobal("fetch", second.fetchMock);
    expect((await ask(question)).statusCode).toBe(200);

    expect(second.system[0]).toContain("Related turns from the reader's other conversations");
    expect(second.system[0]).toContain(question);
  });
});
