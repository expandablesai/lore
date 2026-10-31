// Typed same-origin API client for the LORE console.
//
// The console is served behind Caddy which strips the `/api` prefix and
// proxies to the Fastify app, so every call is rooted at `/api`. Auth is a
// bearer token: `Authorization: Bearer <token>`.

import type {
  Assertion,
  AuthUser,
  ChatImage,
  ChatInput,
  ChatReply,
  ChatSummary,
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
  StoredChatMessage,
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

/** Shown when the edge gate, rather than the API, rejected the call. */
export const GATE_EXPIRED_MESSAGE =
  "Your sign-in session expired — reloading to sign in again.";

/**
 * The edge fronting `/api` is Authelia, not the app. When the portal session
 * lapses every call is rejected by the gate — as a plain-text 401, or as a
 * redirect to the portal host which the browser blocks as a cross-origin
 * fetch and surfaces as a bare "NetworkError". Neither is something the console
 * can act on, so send the browser back through the portal once; the page reload
 * hits the gate, the portal signs in again and returns here.
 */
function bounceThroughGate(): void {
  if (typeof window === "undefined") return;
  const marker = "lore.gate.bounced";
  try {
    const last = Number(window.sessionStorage.getItem(marker) ?? "0");
    // Already bounced recently: leave the message on screen rather than loop.
    if (Date.now() - last < 15_000) return;
    window.sessionStorage.setItem(marker, String(Date.now()));
  } catch {
    // Session storage can be blocked; one bounce is still better than none.
  }
  window.setTimeout(() => {
    try {
      window.location.reload();
    } catch {
      // Navigation is unavailable (embedded/test document) — the message stands.
    }
  }, 1200);
}

/** A 401 the app itself produced carries a JSON `error`; the gate's does not. */
function isGateRejection(status: number, text: string): boolean {
  return status === 401 && !text.trimStart().startsWith("{");
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

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body,
    });
  } catch (error) {
    if (error instanceof TypeError) {
      // A blocked cross-origin redirect is indistinguishable from a real
      // network failure here, and the gate is the only thing that redirects.
      bounceThroughGate();
      throw new ApiError(0, GATE_EXPIRED_MESSAGE);
    }
    throw error;
  }

  const text = await res.text();
  if (isGateRejection(res.status, text)) {
    bounceThroughGate();
    throw new ApiError(res.status, GATE_EXPIRED_MESSAGE);
  }
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
  apiType?: string;
  baseUrl?: string;
  chatModel?: string;
  embedModel?: string;
  embedDim?: number;
  visionModel?: string;
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
    request<{ id: string; orgId: string; label: string; provider: string; apiType: string; baseUrl: string; chatModel: string; embedModel: string; embedDim: number; visionModel: string | null; createdAt: string }>(
      `/orgs/${orgId}/llm-keys`,
      { method: "POST", token, body: input },
    ),

  revokeLlmKey: (token: string, orgId: string, keyId: string) =>
    request<{ ok: boolean }>(`/orgs/${orgId}/llm-keys/${keyId}/revoke`, { method: "POST", token }),

  testLlmKey: (token: string, orgId: string, keyId: string) =>
    request<{ ok: boolean; model: string; reply: string }>(`/orgs/${orgId}/llm-keys/${keyId}/test`, { method: "POST", token }),

  llmKeyModels: (token: string, orgId: string, keyId: string) =>
    request<{ ok: boolean; models: string[] }>(`/orgs/${orgId}/llm-keys/${keyId}/models`, { method: "POST", token }),

  chat: (token: string, input: ChatInput & { chatId?: string }) =>
    request<ChatReply & { chatId: string }>("/chat", { method: "POST", token, body: input }),

  chats: (token: string) => request<ChatSummary[]>("/chats", { token }),

  chatHistory: (token: string, id: string) =>
    request<{ chat: { id: string; title: string; updatedAt: string }; messages: StoredChatMessage[] }>(
      `/chats/${id}`,
      { token },
    ),

  renameChat: (token: string, id: string, title: string) =>
    request<{ ok: boolean }>(`/chats/${id}`, { method: "PATCH", token, body: { title } }),

  deleteChat: (token: string, id: string) =>
    request<{ ok: boolean }>(`/chats/${id}`, { method: "DELETE", token }),

  setTheme: (token: string, theme: "light" | "dark" | "system") =>
    request<MeUser>("/me", { method: "PATCH", token, body: { theme } }),

  updateMe: (token: string, input: { theme?: "light" | "dark" | "system"; neon?: boolean }) =>
    request<MeUser>("/me", { method: "PATCH", token, body: input }),

  setLlmKeyEnabled: (token: string, orgId: string, keyId: string, enabled: boolean) =>
    request<{ id: string; enabled: boolean }>(`/orgs/${orgId}/llm-keys/${keyId}`, {
      method: "PATCH",
      token,
      body: { enabled },
    }),

  /**
   * The stored bytes of a document.
   *
   * An <img src> cannot carry an Authorization header, so callers fetch the
   * blob with the bearer token and hand the console an object URL instead.
   */
  documentBlob: async (token: string, id: string): Promise<Blob> => {
    const res = await fetch(`${API_BASE}/documents/${id}/blob`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.status === 401) throw new ApiError(401, GATE_EXPIRED_MESSAGE);
    if (!res.ok) throw new ApiError(res.status, `could not load the file (HTTP ${res.status})`);
    return res.blob();
  },

  health: () => request<{ ok: boolean }>("/healthz"),
};
