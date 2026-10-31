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
