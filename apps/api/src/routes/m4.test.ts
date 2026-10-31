// @lore/api M4 llm-keys: apiType dispatch — anthropic test route over /v1/messages,
// claude chat-only path with deterministic query embedding (no /v1/embeddings call).
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { createDb, type Db } from "@lore/db";
import type { FastifyInstance } from "fastify";
import { createApp } from "../app.ts";

process.env.LORE_ENCRYPTION_KEY ??= "0".repeat(64);

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://lore:lore@localhost:5432/lore_test";

describe("M4 llm-keys: apiType dispatch, anthropic test + chat-only", () => {
  let db: Db;
  let app: FastifyInstance;
  let token: string;
  let orgId: string;
  let keyId: string;

  beforeAll(async () => {
    db = createDb(DATABASE_URL);
    app = createApp(db);
    await app.ready();
    const suffix = crypto.randomUUID().slice(0, 8);
    const r = await app.inject({
      method: "POST", url: "/auth/signup",
      payload: { email: `m4-${suffix}@example.test`, password: "m4-password-1", displayName: "M4", orgName: `M4 Org ${suffix}` },
    });
    const body = r.json() as { token: string; user: { orgId: string } };
    token = body.token;
    orgId = body.user.orgId;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("POST /orgs/:id/llm-keys adds a claude key with apiType anthropic", async () => {
    const r = await app.inject({
      method: "POST", url: `/orgs/${orgId}/llm-keys`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        label: "m4-claude",
        apiKey: "sk-ant-m4-test",
        provider: "claude",
        apiType: "anthropic",
        baseUrl: "https://api.anthropic.com/v1",
        chatModel: "claude-3-5-sonnet-latest",
        embedModel: "",
        embedDim: 3072,
      },
    });
    expect(r.statusCode).toBe(201);
    const row = r.json() as { id: string; provider: string; apiType: string; embedModel: string };
    expect(row.provider).toBe("claude");
    expect(row.apiType).toBe("anthropic");
    expect(row.embedModel).toBe("");
    keyId = row.id;
  });

  test("POST .../test dispatches the anthropic adapter to /v1/messages with x-api-key", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(
        JSON.stringify({ id: "msg_1", model: "claude-3-5-sonnet-latest", content: [{ type: "text", text: "pong" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await app.inject({
      method: "POST", url: `/orgs/${orgId}/llm-keys/${keyId}/test`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { ok: boolean; model: string; reply: string };
    expect(body.ok).toBe(true);
    expect(body.reply).toBe("pong");
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe("https://api.anthropic.com/v1/messages");
    const headers = (call?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-m4-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
  });

  test("POST /chat with the claude key skips /v1/embeddings and answers via /v1/messages", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(
        JSON.stringify({ id: "msg_2", model: "claude-3-5-sonnet-latest", content: [{ type: "text", text: "the code is 42-Alpha" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await app.inject({
      method: "POST", url: "/chat",
      headers: { authorization: `Bearer ${token}` },
      payload: { messages: [{ role: "user", content: "what is the launch code" }] },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { message: { role: string; content: string } };
    expect(body.message.content).toBe("the code is 42-Alpha");
    expect(fetchMock.mock.calls.length).toBe(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/v1/messages");
  });

  test("POST .../test on a missing key returns 404", async () => {
    const r = await app.inject({
      method: "POST", url: `/orgs/${orgId}/llm-keys/${crypto.randomUUID()}/test`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(404);
  });

  test("POST .../models lists the model ids the provider advertises", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ data: [{ id: "strata-iq3-256" }, { id: "qwen2.5-vl-7b" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await app.inject({
      method: "POST", url: `/orgs/${orgId}/llm-keys/${keyId}/models`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    expect((r.json() as { models: string[] }).models).toEqual(["strata-iq3-256", "qwen2.5-vl-7b"]);
  });
});
