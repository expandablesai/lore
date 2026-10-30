CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."assertion_status" AS ENUM('proposed', 'confirmed', 'disputed', 'superseded', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."constraint_hardness" AS ENUM('hard', 'soft');--> statement-breakpoint
CREATE TYPE "public"."decision_status" AS ENUM('active', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('queued', 'extracting', 'indexed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."event_actor_type" AS ENUM('user', 'assistant', 'tool', 'system');--> statement-breakpoint
CREATE TYPE "public"."event_kind" AS ENUM('message', 'tool_call', 'tool_result', 'document', 'web_capture', 'commit', 'decision', 'correction');--> statement-breakpoint
CREATE TYPE "public"."org_mode" AS ENUM('standalone', 'multi-tenant');--> statement-breakpoint
CREATE TYPE "public"."scope" AS ENUM('personal', 'project', 'org');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('superadmin', 'org_admin', 'member', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"project_id" uuid,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "assertions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid,
	"owner_user_id" uuid,
	"scope" "scope" NOT NULL,
	"subject" text NOT NULL,
	"predicate" text NOT NULL,
	"object" text NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"asserted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "assertion_status" DEFAULT 'proposed' NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"trust" smallint NOT NULL,
	"sources" jsonb NOT NULL,
	"audience" text[] DEFAULT '{}' NOT NULL,
	"source_doc_ids" uuid[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scope_enum" CHECK ("assertions"."scope" IN ('personal','project','org')),
	CONSTRAINT "status_enum" CHECK ("assertions"."status" IN ('proposed','confirmed','disputed','superseded','deleted')),
	CONSTRAINT "sources_nonempty" CHECK (jsonb_array_length("assertions"."sources") > 0),
	CONSTRAINT "temporal_order" CHECK ("assertions"."valid_to" IS NULL OR "assertions"."valid_to" >= "assertions"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_ids" uuid[],
	"detail" jsonb,
	"ip" "inet",
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "break_glass_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"target_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"text" text NOT NULL,
	"tokens" integer NOT NULL,
	"page_from" integer,
	"page_to" integer,
	CONSTRAINT "chunks_document_id_seq_unique" UNIQUE("document_id","seq")
);
--> statement-breakpoint
CREATE TABLE "constraints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid,
	"text" text NOT NULL,
	"hardness" "constraint_hardness" DEFAULT 'hard' NOT NULL,
	"source" jsonb
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid,
	"subject" text NOT NULL,
	"chosen" text NOT NULL,
	"rationale" text,
	"decided_at" timestamp with time zone NOT NULL,
	"supersedes" uuid,
	"status" "decision_status" DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid,
	"owner_user_id" uuid,
	"scope" "scope" NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"status" "document_status" DEFAULT 'queued' NOT NULL,
	"page_count" integer,
	"extracted_at" timestamp with time zone,
	"error" text,
	"retention" text DEFAULT 'forever' NOT NULL,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_org_id_sha256_unique" UNIQUE("org_id","sha256"),
	CONSTRAINT "retention_format" CHECK ("documents"."retention" = 'forever' OR "documents"."retention" ~ '^d+ (day|week|month|year)s?$')
);
--> statement-breakpoint
CREATE TABLE "embeddings" (
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"model" text NOT NULL,
	"dim" integer NOT NULL,
	"vec" vector(1536) NOT NULL,
	CONSTRAINT "embeddings_entity_type_entity_id_model_pk" PRIMARY KEY("entity_type","entity_id","model")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"org_id" uuid NOT NULL,
	"session_id" uuid,
	"ts" timestamp with time zone NOT NULL,
	"actor_type" "event_actor_type" NOT NULL,
	"actor_id" text NOT NULL,
	"surface" text NOT NULL,
	"kind" "event_kind" NOT NULL,
	"payload" jsonb NOT NULL,
	"trust" smallint NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	"sig" text,
	CONSTRAINT "trust_range" CHECK ("events"."trust" BETWEEN 0 AND 3)
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"name" text PRIMARY KEY NOT NULL,
	"last_run" timestamp with time zone,
	"last_status" text,
	"last_error" text,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"mode" "org_mode" DEFAULT 'standalone' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orgs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"project_id" uuid,
	"user_id" uuid,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	CONSTRAINT "project_members_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "projects_org_id_slug_unique" UNIQUE("org_id","slug")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;