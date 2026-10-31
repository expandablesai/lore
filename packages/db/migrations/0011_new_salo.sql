ALTER TABLE "users" DROP CONSTRAINT "locale_enum";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "locale_enum" CHECK ("users"."locale" IS NULL OR "users"."locale" IN ('en','hi','zh'));