/**
 * @lore/proxy — upstream LLM adapter.
 *
 * Pure types plus a real OpenAI chat-completions adapter over global fetch.
 * The Anthropic adapter stays a typed stub until it is wired.
 */

/** OpenAI-style chat completion request (minimal shape). */
export interface ChatCompletionsRequest {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
}

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface ChatCompletionsResponse {
  readonly id: string;
  readonly model: string;
  readonly choices: readonly { readonly message: ChatMessage }[];
}

/** Anthropic-style messages request (minimal shape). */
export interface MessagesRequest {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly max_tokens: number;
}

export interface MessagesResponse {
  readonly id: string;
  readonly model: string;
  readonly content: readonly { readonly type: string; readonly text: string }[];
}

/** An upstream provider adapter exposing both wire formats. */
export interface UpstreamAdapter {
  readonly name: string;
  readonly baseUrl: string;
  chatCompletions(request: ChatCompletionsRequest): Promise<ChatCompletionsResponse>;
  messages(request: MessagesRequest): Promise<MessagesResponse>;
}

/** Per-request credentials for an adapter (resolved from the org's stored key). */
export interface AdapterOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
}

const OPENAI_BASE = "https://api.openai.com/v1";
const ANTHROPIC_BASE = "https://api.anthropic.com";

async function postJson(url: string, apiKey: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`upstream ${res.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as unknown;
}

/** OpenAI adapter — real /chat/completions over fetch. */
export function createOpenAIAdapter(opts: AdapterOptions): UpstreamAdapter {
  const baseUrl = opts.baseUrl ?? OPENAI_BASE;
  return {
    name: "openai",
    baseUrl,
    async chatCompletions(request: ChatCompletionsRequest): Promise<ChatCompletionsResponse> {
      const json = await postJson(`${baseUrl}/chat/completions`, opts.apiKey, {
        model: request.model,
        messages: request.messages,
      });
      const data = json as {
        id?: string;
        model?: string;
        choices?: readonly { message?: { role?: string; content?: string } }[];
      };
      const choices = (data.choices ?? []).map((c) => ({
        message: {
          role: (c.message?.role ?? "assistant") as ChatMessage["role"],
          content: c.message?.content ?? "",
        },
      }));
      return { id: data.id ?? "", model: data.model ?? request.model, choices };
    },
    messages(): Promise<MessagesResponse> {
      throw new Error("openai adapter does not serve /v1/messages");
    },
  };
}

/** Anthropic Messages API POST — x-api-key + anthropic-version headers (not Bearer). */
async function postAnthropicJson(url: string, apiKey: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`upstream ${res.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as unknown;
}

/** Split a ChatMessage[] into Anthropic system text and conversation turns. */
function splitAnthropic(messages: readonly ChatMessage[]): {
  system: string;
  messages: readonly { role: "user" | "assistant"; content: string }[];
} {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const turns = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    }));
  return { system, messages: turns };
}

/** Anthropic adapter — real /v1/messages over fetch; NO embeddings API. */
export function createAnthropicAdapter(opts: AdapterOptions): UpstreamAdapter {
  const baseUrl = opts.baseUrl ?? ANTHROPIC_BASE;
  const base = baseUrl.endsWith("/v1") ? baseUrl.slice(0, -"/v1".length) : baseUrl;
  return {
    name: "anthropic",
    baseUrl,
    async chatCompletions(request: ChatCompletionsRequest): Promise<ChatCompletionsResponse> {
      const { system, messages } = splitAnthropic(request.messages);
      const json = await postAnthropicJson(`${base}/v1/messages`, opts.apiKey, {
        model: request.model,
        max_tokens: 1024,
        ...(system ? { system } : {}),
        messages,
      });
      const data = json as {
        id?: string;
        model?: string;
        content?: readonly { type?: string; text?: string }[];
      };
      const text = data.content?.[0]?.text ?? "";
      return {
        id: data.id ?? "",
        model: data.model ?? request.model,
        choices: [{ message: { role: "assistant", content: text } }],
      };
    },
    async messages(request: MessagesRequest): Promise<MessagesResponse> {
      const { system, messages } = splitAnthropic(request.messages);
      const json = await postAnthropicJson(`${base}/v1/messages`, opts.apiKey, {
        model: request.model,
        max_tokens: request.max_tokens,
        ...(system ? { system } : {}),
        messages,
      });
      const data = json as {
        id?: string;
        model?: string;
        content?: readonly { type?: string; text?: string }[];
      };
      return {
        id: data.id ?? "",
        model: data.model ?? request.model,
        content: (data.content ?? []).map((c) => ({
          type: c.type ?? "text",
          text: c.text ?? "",
        })),
      };
    },
  };
}

/** An upstream embedding provider returning real vectors for semantic search. */
export interface Embedder {
  readonly name: string;
  readonly baseUrl: string;
  embed(input: string | readonly string[], model: string): Promise<Float32Array[]>;
}

/** A vision model that turns one image into indexable text. */
export interface Visioner {
  readonly name: string;
  readonly baseUrl: string;
  describe(request: { model: string; imageDataUrl: string; prompt?: string }): Promise<string>;
}

/** What to ask a vision model for: an index entry, not a chat reply. */
export const DEFAULT_VISION_PROMPT = [
  "Describe this image so it can be found again later by someone searching for it.",
  "Cover, in plain prose: what it shows, any readable text or labels (transcribe them",
  "verbatim), colours, people and objects, and any numbers or names. Do not speculate",
  "about things that are not visible.",
].join(" ");

/**
 * OpenAI-compatible vision call — one image plus a prompt, text back.
 *
 * This is the same /chat/completions endpoint with multimodal content parts,
 * which is what LiteLLM-style gateways forward to their vision backends.
 */
export function createOpenAIVisioner(opts: AdapterOptions): Visioner {
  const baseUrl = opts.baseUrl ?? OPENAI_BASE;
  return {
    name: "openai",
    baseUrl,
    async describe(request: { model: string; imageDataUrl: string; prompt?: string }): Promise<string> {
      const json = await postJson(`${baseUrl}/chat/completions`, opts.apiKey, {
        model: request.model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: request.prompt ?? DEFAULT_VISION_PROMPT },
              { type: "image_url", image_url: { url: request.imageDataUrl } },
            ],
          },
        ],
      });
      const data = json as {
        choices?: readonly { message?: { content?: string | readonly { text?: string }[] } }[];
      };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content === "string") return content.trim();
      if (Array.isArray(content)) {
        return content
          .map((part) => ("text" in part ? (part.text ?? "") : ""))
          .join(" ")
          .trim();
      }
      return "";
    },
  };
}

/** The models a key's provider advertises, for picking a vision model by name. */
export async function listModels(
  opts: AdapterOptions & { apiType?: "openai" | "anthropic" },
): Promise<string[]> {
  const baseUrl = opts.baseUrl ?? OPENAI_BASE;
  // Anthropic authenticates with x-api-key and a version header; a Bearer token
  // is answered with 401, which made "list models" fail for every Claude key.
  const headers =
    opts.apiType === "anthropic"
      ? { "x-api-key": opts.apiKey, "anthropic-version": "2023-06-01" }
      : { authorization: `Bearer ${opts.apiKey}` };
  const res = await fetch(`${baseUrl}/models`, { headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`upstream ${res.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text) as { data?: readonly { id?: string }[]; models?: readonly { name?: string }[] };
  const ids = (data.data ?? []).map((m) => m.id ?? "").filter(Boolean);
  if (ids.length > 0) return ids;
  // Ollama's native /api/tags shape, in case the base URL points at it.
  return (data.models ?? []).map((m) => m.name ?? "").filter(Boolean);
}

/** OpenAI embedder — real /v1/embeddings over fetch. */
export function createOpenAIEmbedder(opts: AdapterOptions): Embedder {
  const baseUrl = opts.baseUrl ?? OPENAI_BASE;
  return {
    name: "openai",
    baseUrl,
    async embed(input: string | readonly string[], model: string): Promise<Float32Array[]> {
      const json = await postJson(`${baseUrl}/embeddings`, opts.apiKey, {
        model,
        input,
      });
      const data = json as { data?: readonly { embedding?: readonly number[] }[] };
      return (data.data ?? []).map((r) => Float32Array.from(r.embedding ?? []));
    },
  };
}
