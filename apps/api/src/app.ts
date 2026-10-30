import { createDb, type Db } from "@lore/db";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import client from "prom-client";

import { createAuthRoutes } from "./routes/auth.ts";
import { createOrgRoutes } from "./routes/orgs.ts";
import { createUserRoutes } from "./routes/users.ts";
import { createProjectRoutes } from "./routes/projects.ts";
import { createMemoryRoutes } from "./routes/memory.ts";
import { createDocumentRoutes } from "./routes/documents.ts";
import { requireAuth } from "./plugins/auth-guard.ts";
import healthRoutes from "./routes/health.ts";

/**
 * App factory.
 *
 * Lives apart from `index.ts` because that module listens on a port at import
 * time — anything that just wants the Fastify instance (the vitest suites, via
 * `app.inject`) would otherwise start a real server as a side effect.
 */

const register = new client.Registry();
client.collectDefaultMetrics({ register });

export function createApp(db: Db = createDb()): FastifyInstance {
  const app = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.register(cors);
  app.register(multipart);

  app.register(healthRoutes);
  app.register(createAuthRoutes(db));

  app.register(async (protectedScope) => {
    protectedScope.addHook("preHandler", requireAuth(db));
    protectedScope.register(createOrgRoutes(db));
    protectedScope.register(createUserRoutes(db));
    protectedScope.register(createProjectRoutes(db));
    protectedScope.register(createMemoryRoutes(db));
    protectedScope.register(createDocumentRoutes(db), { prefix: "/documents" });
  });

  app.get("/metrics", async (_request, reply) => {
    reply.header("Content-Type", register.contentType);
    return register.metrics();
  });

  // TODO: admin routes (provisioning, fleet health)

  return app;
}
