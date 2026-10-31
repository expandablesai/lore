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
  theme?: "light" | "dark" | "system";
  neon?: boolean;
  /** Interface language; null means "follow the browser". */
  locale?: string | null;
  hasAvatar?: boolean;
}

/** A saved conversation in the sidebar. */
export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

/** One stored message, as the API returns it. */
export interface StoredChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  images: ChatImage[];
  createdAt: string;
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
  error: string | null;
  createdAt: string;
  extractedAt: string | null;
  uploadedByName: string | null;
  chunkCount: number;
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
  createdAt: string;
  extractedAt: string | null;
  uploadedByName: string | null;
  chunkCount: number;
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
  reprocessed?: boolean;
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
  apiType: string;
  baseUrl: string;
  chatModel: string;
  embedModel: string;
  embedDim: number;
  visionModel: string | null;
  enabled: boolean;
  createdAt: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  /** ISO timestamp shown beside the message. */
  at?: string;
}

/** An image the reply rests on; the console fetches its bytes itself. */
export interface ChatImage {
  documentId: string;
  filename: string;
  mime: string;
}

export interface ChatInput {
  messages: ChatMessage[];
}

export interface ChatReply {
  message: { role: "assistant"; content: string; at?: string };
  /** When the question was stored, so the live turn matches a reloaded one. */
  userAt?: string;
  images?: ChatImage[];
}
