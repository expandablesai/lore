import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  bigint,
  real,
  smallint,
  date,
  timestamp,
  jsonb,
  inet,
  primaryKey,
  unique,
  check,
  pgEnum,
  vector,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const userRole = pgEnum("user_role", [
  "superadmin",
  "org_admin",
  "member",
  "viewer",
]);
export const userStatus = pgEnum("user_status", ["active", "disabled"]);
export const orgMode = pgEnum("org_mode", ["standalone", "multi-tenant"]);
export const scopeEnum = pgEnum("scope", ["personal", "project", "org"]);
export const eventActorType = pgEnum("event_actor_type", [
  "user",
  "assistant",
  "tool",
  "system",
]);
export const eventKind = pgEnum("event_kind", [
  "message",
  "tool_call",
  "tool_result",
  "document",
  "web_capture",
  "commit",
  "decision",
  "correction",
]);
export const assertionStatus = pgEnum("assertion_status", [
  "proposed",
  "confirmed",
  "disputed",
  "superseded",
  "deleted",
]);
export const documentStatus = pgEnum("document_status", [
  "queued",
  "extracting",
  "indexed",
  "failed",
]);
export const decisionStatus = pgEnum("decision_status", [
  "active",
  "superseded",
]);
export const constraintHardness = pgEnum("constraint_hardness", [
  "hard",
  "soft",
]);

// ─── Orgs & Users ────────────────────────────────────────────────────────────

export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  mode: orgMode("mode").notNull().default("standalone"),
  settings: jsonb("settings").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  totpSecret: text("totp_secret"),
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  role: userRole("role").notNull().default("member"),
  status: userStatus("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ip: inet("ip"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const apiTokens = pgTable("api_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  userId: uuid("user_id"),
  projectId: uuid("project_id"),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  scopes: text("scopes").array().notNull().default(sql`'{}'`),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

// ─── Projects ────────────────────────────────────────────────────────────────

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  settings: jsonb("settings").notNull().default({}),
}, (t) => [unique().on(t.orgId, t.slug)]);

export const projectMembers = pgTable("project_members", {
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  role: userRole("role").notNull().default("member"),
}, (t) => [primaryKey({ columns: [t.projectId, t.userId] })]);

// ─── Memory: Events (immutable, hash-chained) ───────────────────────────────

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id"),
  orgId: uuid("org_id").notNull(),
  sessionId: uuid("session_id"),
  ts: timestamp("ts", { withTimezone: true }).notNull(),
  actorType: eventActorType("actor_type").notNull(),
  actorId: text("actor_id").notNull(),
  surface: text("surface").notNull(),
  kind: eventKind("kind").notNull(),
  payload: jsonb("payload").notNull(),
  trust: smallint("trust").notNull(),
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull(),
  sig: text("sig"),
}, (t) => [
  check("trust_range", sql`${t.trust} BETWEEN 0 AND 3`),
]);

// ─── Memory: Assertions (bi-temporal beliefs) ───────────────────────────────

export const assertions = pgTable("assertions", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  projectId: uuid("project_id"),
  ownerUserId: uuid("owner_user_id"),
  scope: scopeEnum("scope").notNull(),
  subject: text("subject").notNull(),
  predicate: text("predicate").notNull(),
  object: text("object").notNull(),
  validFrom: date("valid_from"),
  validTo: date("valid_to"),
  assertedAt: timestamp("asserted_at", { withTimezone: true }).notNull().defaultNow(),
  status: assertionStatus("status").notNull().default("proposed"),
  confidence: real("confidence").notNull().default(0.5),
  trust: smallint("trust").notNull(),
  sources: jsonb("sources").notNull(),
  audience: text("audience").array().notNull().default(sql`'{}'`),
  sourceDocIds: uuid("source_doc_ids").array().notNull().default(sql`'{}'`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("scope_enum", sql`${t.scope} IN ('personal','project','org')`),
  check("status_enum", sql`${t.status} IN ('proposed','confirmed','disputed','superseded','deleted')`),
  check("sources_nonempty", sql`jsonb_array_length(${t.sources}) > 0`),
  check("temporal_order", sql`${t.validTo} IS NULL OR ${t.validTo} >= ${t.validFrom}`),
]);

// ─── Memory: Embeddings (pgvector HNSW) ─────────────────────────────────────

export const embeddings = pgTable("embeddings", {
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  model: text("model").notNull(),
  dim: integer("dim").notNull(),
  vec: vector("vec", { dimensions: 3072 }).notNull(),
}, (t) => [primaryKey({ columns: [t.entityType, t.entityId, t.model] })]);

// ─── Documents ───────────────────────────────────────────────────────────────

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  projectId: uuid("project_id"),
  ownerUserId: uuid("owner_user_id"),
  scope: scopeEnum("scope").notNull(),
  filename: text("filename").notNull(),
  mime: text("mime").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  sha256: text("sha256").notNull(),
  storageKey: text("storage_key").notNull(),
  status: documentStatus("status").notNull().default("queued"),
  pageCount: integer("page_count"),
  extractedAt: timestamp("extracted_at", { withTimezone: true }),
  error: text("error"),
  retention: text("retention").notNull().default("forever"),
  legalHold: boolean("legal_hold").notNull().default(false),
  uploadedBy: uuid("uploaded_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique().on(t.orgId, t.sha256),
  check("retention_format", sql`${t.retention} = 'forever' OR ${t.retention} ~ '^\d+ (day|week|month|year)s?$'`),
]);

export const chunks = pgTable("chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull(),
  seq: integer("seq").notNull(),
  text: text("text").notNull(),
  tokens: integer("tokens").notNull(),
  pageFrom: integer("page_from"),
  pageTo: integer("page_to"),
}, (t) => [unique().on(t.documentId, t.seq)]);

// ─── Decisions & Constraints ─────────────────────────────────────────────────

export const decisions = pgTable("decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  projectId: uuid("project_id"),
  subject: text("subject").notNull(),
  chosen: text("chosen").notNull(),
  rationale: text("rationale"),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
  supersedes: uuid("supersedes"),
  status: decisionStatus("status").notNull().default("active"),
});

export const constraints = pgTable("constraints", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  projectId: uuid("project_id"),
  text: text("text").notNull(),
  hardness: constraintHardness("hardness").notNull().default("hard"),
  source: jsonb("source"),
});

// ─── Break-glass Grants ──────────────────────────────────────────────────────

export const breakGlassGrants = pgTable("break_glass_grants", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  adminUserId: uuid("admin_user_id").notNull(),
  targetUserId: uuid("target_user_id").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

// ─── Audit ───────────────────────────────────────────────────────────────────

export const audit = pgTable("audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id"),
  actorId: uuid("actor_id"),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetIds: uuid("target_ids").array(),
  detail: jsonb("detail"),
  ip: inet("ip"),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Jobs (pg-boss owns its own tables; this is the product-facing view) ─────

export const jobs = pgTable("jobs", {
  name: text("name").primaryKey(),
  lastRun: timestamp("last_run", { withTimezone: true }),
  lastStatus: text("last_status"),
  lastError: text("last_error"),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
});

// ─── LLM provider keys (encrypted at rest) ───────────────────────────────────
export const orgLlmKeys = pgTable("org_llm_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  provider: text("provider").notNull().default("openai"),
  cipher: text("cipher").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
