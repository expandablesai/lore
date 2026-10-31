ALTER TABLE "org_llm_keys" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "neon" boolean DEFAULT false NOT NULL;