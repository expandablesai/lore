// M8 interface language: the preference round-trips, is validated, and reaches
// the model as an instruction — with the browser's language as the default.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { createDb, type Db } from "@lore/db";
import type { FastifyInstance } from "fastify";
import { createApp } from "../app.ts";

process.env.LORE_ENCRYPTION_KEY ??= "0".repeat(64);

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://lore:lore@localhost:5432/lore_test";

/** OpenAI-shaped reply, capturing the request body the route produced. */
function captureReply() {
  const calls: Array<{ system: string }> = [];
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { messages: Array<{ role: string; content: string }> };
    calls.push({ system: body.messages.find((m) => m.role === "system")?.content ?? "" });
    return new Response(
      JSON.stringify({ id: "c1", model: "test-model", choices: [{ message: { role: "assistant", content: "ok" } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  return { fetchMock, calls };
}

describe("M8 interface language", () => {
  let db: Db;
  let app: FastifyInstance;
  let token: string;
  let orgId: string;

  beforeAll(async () => {
    db = createDb(DATABASE_URL);
    app = createApp(db);
    await app.ready();
    const suffix = crypto.randomUUID().slice(0, 8);
    const r = await app.inject({
      method: "POST", url: "/auth/signup",
      payload: {
        email: `m8-${suffix}@example.test`,
        password: "m8-password-1",
        displayName: "M8",
        orgName: `M8 Org ${suffix}`,
      },
    });
    const body = r.json() as { token: string; user: { orgId: string } };
    token = body.token;
    orgId = body.user.orgId;

    const key = await app.inject({
      method: "POST", url: `/orgs/${orgId}/llm-keys`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        label: "m8-chat", apiKey: "sk-m8-test-key", provider: "custom",
        baseUrl: "http://127.0.0.1:9/v1", chatModel: "test-model",
      },
    });
    if (key.statusCode !== 201) throw new Error(`key setup failed: ${key.statusCode} ${key.body}`);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("a new account follows the browser: locale starts null", async () => {
    const me = await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${token}` } });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { locale: string | null }).locale).toBeNull();
  });

  test("the chosen language round-trips through /me", async () => {
    const patch = await app.inject({
      method: "PATCH", url: "/me",
      headers: { authorization: `Bearer ${token}` },
      payload: { locale: "hi" },
    });
    expect(patch.statusCode).toBe(200);
    expect((patch.json() as { locale: string }).locale).toBe("hi");

    const me = await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${token}` } });
    expect((me.json() as { locale: string }).locale).toBe("hi");
  });

  test("an unsupported language is refused", async () => {
    const patch = await app.inject({
      method: "PATCH", url: "/me",
      headers: { authorization: `Bearer ${token}` },
      payload: { locale: "de" },
    });
    expect(patch.statusCode).toBe(400);
    expect((patch.json() as { error: string }).error).toContain("language");
  });

  test("null hands the choice back to the browser", async () => {
    const patch = await app.inject({
      method: "PATCH", url: "/me",
      headers: { authorization: `Bearer ${token}` },
      payload: { locale: null },
    });
    expect(patch.statusCode).toBe(200);
    expect((patch.json() as { locale: string | null }).locale).toBeNull();
  });

  test("the model is told to answer in the chosen language", async () => {
    await app.inject({
      method: "PATCH", url: "/me",
      headers: { authorization: `Bearer ${token}` },
      payload: { locale: "hi" },
    });
    const { fetchMock, calls } = captureReply();
    vi.stubGlobal("fetch", fetchMock);

    const r = await app.inject({
      method: "POST", url: "/chat",
      headers: { authorization: `Bearer ${token}` },
      payload: { messages: [{ role: "user", content: "hello" }] },
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.system).toContain("Answer in Hindi");
  });

  test("with no stored choice the browser header decides", async () => {
    await app.inject({
      method: "PATCH", url: "/me",
      headers: { authorization: `Bearer ${token}` },
      payload: { locale: null },
    });
    const { fetchMock, calls } = captureReply();
    vi.stubGlobal("fetch", fetchMock);

    await app.inject({
      method: "POST", url: "/chat",
      headers: { authorization: `Bearer ${token}`, "accept-language": "zh-CN,zh;q=0.9" },
      payload: { messages: [{ role: "user", content: "hello" }] },
    });
    expect(calls[0]?.system).toContain("Answer in Simplified Chinese");
  });
});
