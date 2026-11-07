ALTER TABLE "chat_messages" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "local" boolean;