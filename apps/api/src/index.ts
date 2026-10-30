import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import client from "prom-client";
import healthRoutes from "./routes/health.ts";

const register = new client.Registry();
client.collectDefaultMetrics({ register });

export function createApp(): FastifyInstance {
  const app = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.register(cors);
  app.register(multipart);

  app.register(healthRoutes);

  app.get("/metrics", async (_request, reply) => {
    reply.header("Content-Type", register.contentType);
    return register.metrics();
  });

  // TODO: auth routes (signup, login, sessions)
  // TODO: orgs routes (create, list, members)
  // TODO: users routes (profile, settings)
  // TODO: projects routes (create, list, members)
  // TODO: memory routes (recall, reflect, pages)
  // TODO: documents routes (upload, list, read)
  // TODO: admin routes (provisioning, fleet health)

  return app;
}

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";

const app = createApp();

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
