// Typed same-origin API client for the LORE console.
//
// The console is served behind Caddy which strips the `/api` prefix and
// proxies to the Fastify app, so every call is rooted at `/api`. Auth is a
// bearer token: `Authorization: Bearer <token>`.

import type {
  Assertion,
  AuthUser,
  Chunk,
  DocumentDetail,
  DocumentSummary,
  ForgetReceipt,
  MeUser,
  Org,
  OrgLlmKey,
  OrgMember,
  Project,
  RememberResult,
  Role,
  Scope,
  TokenResponse,
  UploadResult,
} from "./types";

const API_BASE = "/api";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  token?: string | null;
  body?: unknown;
  form?: FormData;
}

function messageFrom(status: number, data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data) {
    const err = (data as { error: unknown }).error;
    if (typeof err === "string" && err.length > 0) return err;
  }
  return fallback || `HTTP ${status}`;
}

export async function request<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;

  let body: BodyInit | undefined;
  if (opts.form) {
    body = opts.form;
  } else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body,
  });

  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new ApiError(
      res.status,
      messageFrom(res.status, data, res.statusText),
    );
  }
  return data as T;
}

export interface SignupInput {
  email: string;
  password: string;
  displayName: string;
  orgName: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AddMemberInput {
  email: string;
  displayName: string;
  password: string;
  role: Exclude<Role, "superadmin">;
}

export interface AddLlmKeyInput {
  label: string;
  apiKey: string;
  provider?: string;
}

export interface RememberInput {
  scope: Scope;
  subject: string;
  predicate: string;
  object: string;
  sources: unknown[];
  trust?: number;
}

export interface RecallInput {
  query?: string;
  scope?: Scope;
}

export interface DocumentListParams {
  limit?: number;
  offset?: number;
}

function docListQuery(params: DocumentListParams): string {
  const search = new URLSearchParams();
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.offset !== undefined) search.set("offset", String(params.offset));
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export const api = {
  signup: (input: SignupInput) =>
    request<TokenResponse>("/auth/signup", { method: "POST", body: input }),

  login: (input: LoginInput) =>
    request<TokenResponse>("/auth/login", { method: "POST", body: input }),

  session: (token: string) =>
    request<{ user: AuthUser }>("/auth/session", { token }),

  me: (token: string) => request<MeUser>("/me", { token }),

  orgs: (token: string) => request<Org[]>("/orgs", { token }),

  orgMembers: (token: string, orgId: string) =>
    request<OrgMember[]>(`/orgs/${orgId}/users`, { token }),

  addMember: (token: string, orgId: string, input: AddMemberInput) =>
    request<{ id: string; email: string; role: Role }>(
      `/orgs/${orgId}/users`,
      { method: "POST", token, body: input },
    ),

  projects: (token: string) => request<Project[]>("/projects", { token }),

  documents: (token: string, params: DocumentListParams = {}) =>
    request<{ documents: DocumentSummary[] }>(
      `/documents${docListQuery(params)}`,
      { token },
    ),

  document: (token: string, id: string) =>
    request<{ document: DocumentDetail; chunks: Chunk[] }>(
      `/documents/${id}`,
      { token },
    ),

  uploadDocument: (token: string, file: File, scope?: Scope) => {
    const form = new FormData();
    form.append("file", file);
    if (scope) form.append("scope", scope);
    return request<UploadResult>("/documents/upload", {
      method: "POST",
      token,
      form,
    });
  },

  reprocessDocument: (token: string, id: string) =>
    request<UploadResult>(`/documents/${id}/reprocess`, { method: "POST", token }),

  recall: (token: string, input: RecallInput) =>
    request<Assertion[]>("/recall", { method: "POST", token, body: input }),

  remember: (token: string, input: RememberInput) =>
    request<RememberResult>("/remember", { method: "POST", token, body: input }),

  forget: (token: string, input: { id: string; reason?: string }) =>
    request<ForgetReceipt>("/forget", { method: "POST", token, body: input }),

  orgLlmKeys: (token: string, orgId: string) =>
    request<OrgLlmKey[]>(`/orgs/${orgId}/llm-keys`, { token }),

  addLlmKey: (token: string, orgId: string, input: AddLlmKeyInput) =>
    request<{ id: string; orgId: string; label: string; provider: string; createdAt: string }>(
      `/orgs/${orgId}/llm-keys`,
      { method: "POST", token, body: input },
    ),

  revokeLlmKey: (token: string, orgId: string, keyId: string) =>
    request<{ ok: boolean }>(`/orgs/${orgId}/llm-keys/${keyId}/revoke`, { method: "POST", token }),

  testLlmKey: (token: string, orgId: string, keyId: string) =>
    request<{ ok: boolean; model: string; reply: string }>(`/orgs/${orgId}/llm-keys/${keyId}/test`, { method: "POST", token }),

  health: () => request<{ ok: boolean }>("/healthz"),
};
