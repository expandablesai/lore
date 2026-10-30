import { z } from "zod";
import {
  audit,
  insertLlmKey,
  listLlmKeys,
  revealLlmKey,
  revokeLlmKey,
  type Db,
} from "@lore/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { createOpenAIAdapter } from "@lore/proxy";
import type { AuthenticatedUser } from "../plugins/auth-guard.ts";

/**
 * Per-org LLM provider keys — admin-only, org-scoped. Keys are encrypted at
 * rest; list responses never carry the ciphertext, and only the test route
 * decrypts (to make a single upstream call).
 */
function isOrgAdmin(user: AuthenticatedUser): boolean {
  return user.role === "org_admin" || user.role === "superadmin";
}

const orgParams = z.object({ id: z.string() });
const keyParams = z.object({ id: z.string(), keyId: z.string() });
const addBody = z.object({
  label: z.string().min(1).max(200),
  apiKey: z.string().min(8).max(200),
  provider: z.enum(["openai"]).optional(),
});

export const createLlmKeyRoutes: (db: Db) => FastifyPluginAsyncZod = (db) => async (app) => {
  app.addHook("preHandler", async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.get(
    "/orgs/:id/llm-keys",
    { schema: { params: orgParams } },
    async (request, reply) => {
      if (request.params.id !== request.user.orgId || !isOrgAdmin(request.user)) {
        return reply.code(403).send({ error: "forbidden" });
      }
      return listLlmKeys(db, request.params.id);
    },
  );

  app.post(
    "/orgs/:id/llm-keys",
    { schema: { params: orgParams, body: addBody } },
    async (request, reply) => {
      if (request.params.id !== request.user.orgId || !isOrgAdmin(request.user)) {
        return reply.code(403).send({ error: "forbidden" });
      }
      const { label, apiKey, provider } = request.body;
      const rows = await insertLlmKey(db, {
        orgId: request.params.id,
        label,
        apiKey,
        provider,
      });
      const row = rows[0];
      if (!row) throw new Error("llm key insert failed");
      await db.insert(audit).values({
        orgId: request.user.orgId,
        actorId: request.user.id,
        action: "llmkey.add",
        targetType: "org_llm_key",
        targetIds: [row.id],
        ip: request.ip,
      });
      return reply.code(201).send(row);
    },
  );

  app.post(
    "/orgs/:id/llm-keys/:keyId/revoke",
    { schema: { params: keyParams } },
    async (request, reply) => {
      if (request.params.id !== request.user.orgId || !isOrgAdmin(request.user)) {
        return reply.code(403).send({ error: "forbidden" });
      }
      const rows = await revokeLlmKey(db, request.params.id, request.params.keyId);
      if (!rows[0]) return reply.code(404).send({ error: "not found" });
      await db.insert(audit).values({
        orgId: request.user.orgId,
        actorId: request.user.id,
        action: "llmkey.revoke",
        targetType: "org_llm_key",
        targetIds: [request.params.keyId],
        ip: request.ip,
      });
      return { ok: true };
    },
  );

  app.post(
    "/orgs/:id/llm-keys/:keyId/test",
    { schema: { params: keyParams } },
    async (request, reply) => {
      if (request.params.id !== request.user.orgId || !isOrgAdmin(request.user)) {
        return reply.code(403).send({ error: "forbidden" });
      }
      const apiKey = await revealLlmKey(db, request.params.keyId);
      if (!apiKey) return reply.code(404).send({ error: "not found" });
      try {
        const adapter = createOpenAIAdapter({ apiKey });
        const res = await adapter.chatCompletions({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "ping" }],
        });
        return { ok: true, model: res.model, reply: res.choices[0]?.message.content ?? "" };
      } catch (e) {
        return reply
          .code(502)
          .send({ ok: false, error: e instanceof Error ? e.message : "upstream failed" });
      }
    },
  );
};
