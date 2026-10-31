// M5 chat history: a conversation is created by the first question, named after
// it, appended to on later turns, scoped to its owner, and deletable. The theme
// preference rides the same profile route.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { createDb, type Db } from "@lore/db";
import type { FastifyInstance } from "fastify";
import { createApp } from "../app.ts";

process.env.LORE_ENCRYPTION_KEY ??= "0".repeat(64);

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://lore:lore@localhost:5432/lore_test";

function anthropicReply(text: string) {
  return vi.fn(async (_url: string, _init: RequestInit) =>
    new Response(
      JSON.stringify({ id: "msg_x", model: "claude-3-5-sonnet-latest", content: [{ type: "text", text }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
}

describe("M5 chat history", () => {
  let db: Db;
  let app: FastifyInstance;
  let token: string;
  let orgId: string;
  let chatId: string;

  beforeAll(async () => {
    db = createDb(DATABASE_URL);
    app = createApp(db);
    await app.ready();
    const suffix = crypto.randomUUID().slice(0, 8);
    const r = await app.inject({
      method: "POST", url: "/auth/signup",
      payload: { email: `m5-${suffix}@example.test`, password: "m5-password-1", displayName: "M5", orgName: `M5 Org ${suffix}` },
    });
    const body = r.json() as { token: string; user: { orgId: string } };
    token = body.token;
    orgId = body.user.orgId;

    // A chat-only key: no embeddings call, so the turn needs no vector service.
    await app.inject({
      method: "POST", url: `/orgs/${orgId}/llm-keys`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        label: "m5-claude", apiKey: "sk-ant-m5", provider: "claude", apiType: "anthropic",
        baseUrl: "https://api.anthropic.com/v1", chatModel: "claude-3-5-sonnet-latest",
        embedModel: "", embedDim: 3072,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("the first question creates, names and stores a conversation", async () => {
    vi.stubGlobal("fetch", anthropicReply("The launch code is 42-Alpha."));
    const r = await app.inject({
      method: "POST", url: "/chat",
      headers: { authorization: `Bearer ${token}` },
      payload: { messages: [{ role: "user", content: "what is the launch code" }] },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { chatId: string; message: { content: string } };
    expect(body.message.content).toContain("42-Alpha");
    expect(body.chatId).toBeTruthy();
    chatId = body.chatId;

    const list = await app.inject({ method: "GET", url: "/chats", headers: { authorization: `Bearer ${token}` } });
    const chats = list.json() as Array<{ id: string; title: string; messageCount: number }>;
    const stored = chats.find((c) => c.id === chatId);
    expect(stored?.title).toBe("what is the launch code");
    expect(stored?.messageCount).toBe(2);

    const opened = await app.inject({
      method: "GET", url: `/chats/${chatId}`, headers: { authorization: `Bearer ${token}` },
    });
    const messages = (opened.json() as { messages: Array<{ role: string; content: string }> }).messages;
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(messages[1]?.content).toContain("42-Alpha");
  });

  test("continuing a conversation appends instead of starting another", async () => {
    vi.stubGlobal("fetch", anthropicReply("It is guarded by Sparrow."));
    const r = await app.inject({
      method: "POST", url: "/chat",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        chatId,
        messages: [
          { role: "user", content: "what is the launch code" },
          { role: "assistant", content: "The launch code is 42-Alpha." },
          { role: "user", content: "who guards it" },
        ],
      },
    });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { chatId: string }).chatId).toBe(chatId);

    const opened = await app.inject({
      method: "GET", url: `/chats/${chatId}`, headers: { authorization: `Bearer ${token}` },
    });
    const messages = (opened.json() as { messages: unknown[] }).messages;
    expect(messages).toHaveLength(4);
  });

  test("a chat is private to the person who started it", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const other = await app.inject({
      method: "POST", url: "/auth/signup",
      payload: {
        email: `m5-other-${suffix}@example.test`, password: "m5-password-2",
        displayName: "Other", orgName: `M5 Other ${suffix}`,
      },
    });
    const otherToken = (other.json() as { token: string }).token;

    const list = await app.inject({ method: "GET", url: "/chats", headers: { authorization: `Bearer ${otherToken}` } });
    expect(list.json()).toEqual([]);

    const read = await app.inject({
      method: "GET", url: `/chats/${chatId}`, headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(read.statusCode).toBe(404);
  });

  test("renaming and deleting a chat", async () => {
    const rename = await app.inject({
      method: "PATCH", url: `/chats/${chatId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "Launch code thread" },
    });
    expect(rename.statusCode).toBe(200);

    const list = await app.inject({ method: "GET", url: "/chats", headers: { authorization: `Bearer ${token}` } });
    expect((list.json() as Array<{ id: string; title: string }>).find((c) => c.id === chatId)?.title).toBe(
      "Launch code thread",
    );

    const removed = await app.inject({
      method: "DELETE", url: `/chats/${chatId}`, headers: { authorization: `Bearer ${token}` },
    });
    expect(removed.statusCode).toBe(200);

    const gone = await app.inject({
      method: "GET", url: `/chats/${chatId}`, headers: { authorization: `Bearer ${token}` },
    });
    expect(gone.statusCode).toBe(404);
  });

  test("the theme choice persists on the profile", async () => {
    const patched = await app.inject({
      method: "PATCH", url: "/me", headers: { authorization: `Bearer ${token}` }, payload: { theme: "light" },
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as { theme: string }).theme).toBe("light");

    const me = await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${token}` } });
    expect((me.json() as { theme: string }).theme).toBe("light");

    const bad = await app.inject({
      method: "PATCH", url: "/me", headers: { authorization: `Bearer ${token}` }, payload: { theme: "sepia" },
    });
    expect(bad.statusCode).toBe(400);
  });

  test("a disabled key stops answering chat, and enabling brings it back", async () => {
    const keys = await app.inject({ method: "GET", url: `/orgs/${orgId}/llm-keys`, headers: { authorization: `Bearer ${token}` } });
    const keyId = (keys.json() as Array<{ id: string }>)[0]!.id;

    const off = await app.inject({
      method: "PATCH", url: `/orgs/${orgId}/llm-keys/${keyId}`,
      headers: { authorization: `Bearer ${token}` }, payload: { enabled: false },
    });
    expect(off.statusCode).toBe(200);
    expect((off.json() as { enabled: boolean }).enabled).toBe(false);

    // With the only key switched off there is nothing to answer with.
    const blocked = await app.inject({
      method: "POST", url: "/chat",
      headers: { authorization: `Bearer ${token}` },
      payload: { messages: [{ role: "user", content: "are you there" }] },
    });
    expect(blocked.statusCode).toBe(502);
    expect((blocked.json() as { error: string }).error).toMatch(/no active LLM key/i);

    const on = await app.inject({
      method: "PATCH", url: `/orgs/${orgId}/llm-keys/${keyId}`,
      headers: { authorization: `Bearer ${token}` }, payload: { enabled: true },
    });
    expect(on.statusCode).toBe(200);
    expect((on.json() as { enabled: boolean }).enabled).toBe(true);
  });

  test("the enable switch is admin-only and validates its body", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const other = await app.inject({
      method: "POST", url: "/auth/signup",
      payload: { email: `m5-mem-${suffix}@example.test`, password: "m5-password-3", displayName: "Mem", orgName: `M5 Mem ${suffix}` },
    });
    const otherToken = (other.json() as { token: string }).token;

    const keys = await app.inject({ method: "GET", url: `/orgs/${orgId}/llm-keys`, headers: { authorization: `Bearer ${token}` } });
    const keyId = (keys.json() as Array<{ id: string }>)[0]!.id;

    const foreign = await app.inject({
      method: "PATCH", url: `/orgs/${orgId}/llm-keys/${keyId}`,
      headers: { authorization: `Bearer ${otherToken}` }, payload: { enabled: false },
    });
    expect(foreign.statusCode).toBe(403);

    const bad = await app.inject({
      method: "PATCH", url: `/orgs/${orgId}/llm-keys/${keyId}`,
      headers: { authorization: `Bearer ${token}` }, payload: { enabled: "nope" },
    });
    expect(bad.statusCode).toBe(400);
  });

  test("the neon preference persists alongside the theme", async () => {
    const patched = await app.inject({
      method: "PATCH", url: "/me", headers: { authorization: `Bearer ${token}` }, payload: { neon: true },
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as { neon: boolean }).neon).toBe(true);

    const me = await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${token}` } });
    expect((me.json() as { neon: boolean; theme: string }).neon).toBe(true);
  });
  test("chat history requires a session", async () => {
    const r = await app.inject({ method: "GET", url: "/chats" });
    expect(r.statusCode).toBe(401);
  });
});
