ALTER TABLE "org_llm_keys" ADD COLUMN "base_url" text DEFAULT 'https://api.openai.com/v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "org_llm_keys" ADD COLUMN "chat_model" text DEFAULT 'gpt-4o' NOT NULL;--> statement-breakpoint
ALTER TABLE "org_llm_keys" ADD COLUMN "embed_model" text DEFAULT 'text-embedding-3-large' NOT NULL;--> statement-breakpoint
ALTER TABLE "org_llm_keys" ADD COLUMN "embed_dim" integer DEFAULT 3072 NOT NULL;