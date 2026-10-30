// Wire types for the EXPANDABLES LORE Fastify API, mirrored from
// `packages/db/src/schema.ts` enums and the route response shapes.

export type Role = "superadmin" | "org_admin" | "member" | "viewer";
export type UserStatus = "active" | "disabled";
export type Scope = "personal" | "project" | "org";
export type OrgMode = "standalone" | "multi-tenant";
export type DocumentStatus = "queued" | "extracting" | "indexed" | "failed";
export type AssertionStatus =
  | "proposed"
  | "confirmed"
  | "disputed"
  | "superseded"
  | "deleted";

export interface AuthUser {
  id: string;
  orgId: string;
  email: string;
  displayName: string;
  role: Role;
}

export interface MeUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  orgId: string;
  status: UserStatus;
}

export interface TokenResponse {
  token: string;
  user: AuthUser;
}

export interface Org {
  id: string;
  name: string;
  slug: string;
  mode: OrgMode;
  settings: unknown;
  createdAt: string;
}

export interface OrgMember {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: UserStatus;
}

export interface Project {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  settings: unknown;
}

export interface DocumentSummary {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  status: DocumentStatus;
  pageCount: number | null;
  createdAt: string;
}

export interface DocumentDetail {
  id: string;
  orgId: string;
  scope: Scope;
  filename: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
  status: DocumentStatus;
  pageCount: number | null;
  error: string | null;
}

export interface Chunk {
  id: string;
  seq: number;
  text: string;
  tokens: number;
  pageFrom: number | null;
  pageTo: number | null;
}

export interface UploadResult {
  id: string;
  status: DocumentStatus;
  deduplicated?: boolean;
}

export interface Assertion {
  id: string;
  scope: Scope;
  subject: string;
  predicate: string;
  object: string;
  status: AssertionStatus;
  trust: number;
  confidence: number;
}

export interface RememberResult {
  id: string;
  scope: Scope;
  subject: string;
  status: AssertionStatus;
}

export interface ForgetReceipt {
  forgotten: string;
  receipt: {
    by: string;
    reason: string | null;
    at: string;
    cascadedDocIds: string[];
  };
}

export interface OrgLlmKey {
  id: string;
  label: string;
  provider: string;
  createdAt: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatInput {
  messages: ChatMessage[];
}

export interface ChatReply {
  message: { role: "assistant"; content: string };
}
