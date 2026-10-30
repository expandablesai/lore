import { PgBoss } from "pg-boss";

// TODO: register ingestion job handlers — document.upload, document.extract,
// document.embed, consolidation, maintenance

const SHUTDOWN_SIGNALS = ["SIGTERM", "SIGINT"] as const;

export async function startWorker(): Promise<PgBoss> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const boss = new PgBoss({ connectionString: databaseUrl, schema: "boss" });

  for (const signal of SHUTDOWN_SIGNALS) {
    process.on(signal, () => {
      console.log(`worker received ${signal} — draining in-flight jobs`);
      void boss
        .stop()
        .then(() => process.exit(0))
        .catch((error: unknown) => {
          console.error("worker shutdown failed", error);
          process.exit(1);
        });
    });
  }

  await boss.start();
  console.log("worker ready");

  return boss;
}

// main guard: run the worker when this module is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startWorker().catch((error: unknown) => {
    console.error("worker failed to start", error);
    process.exit(1);
  });
}
