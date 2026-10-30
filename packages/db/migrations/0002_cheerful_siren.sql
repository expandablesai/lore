DELETE FROM "embeddings";
--> statement-breakpoint
ALTER TABLE "embeddings" ALTER COLUMN "vec" SET DATA TYPE vector(3072);
