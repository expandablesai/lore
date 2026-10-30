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

/** Anthropic adapter — typed stub until wired. */
export function createAnthropicAdapter(opts: AdapterOptions): UpstreamAdapter {
  const baseUrl = opts.baseUrl ?? ANTHROPIC_BASE;
  return {
    name: "anthropic",
    baseUrl,
    chatCompletions(): Promise<ChatCompletionsResponse> {
      throw new Error("anthropic adapter does not serve /v1/chat/completions");
    },
    messages(): Promise<MessagesResponse> {
      throw new Error("anthropic.messages: not implemented");
    },
  };
}
