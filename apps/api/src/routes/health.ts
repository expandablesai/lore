import type { FastifyPluginAsync } from "fastify";

const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/healthz", async () => ({ ok: true }));
  app.get("/readyz", async () => ({ ready: true }));
};

export default healthRoutes;
