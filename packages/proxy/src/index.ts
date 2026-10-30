/**
 * @lore/proxy — upstream LLM adapter skeleton.
 *
 * Pure types and stubs; no HTTP yet.
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

/** Env bag type so this package needs no Node types. */
export type UpstreamEnv = Readonly<Record<string, string | undefined>>;

/** OpenAI adapter stub. Base URL from OPENAI_BASE_URL. */
export function createOpenAIAdapter(env: UpstreamEnv): UpstreamAdapter {
  return {
    name: "openai",
    baseUrl: env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1",
    chatCompletions() {
      throw new Error("openai.chatCompletions: not implemented");
    },
    messages() {
      throw new Error("openai adapter does not serve /v1/messages");
    },
  };
}

/** Anthropic adapter stub. Base URL from ANTHROPIC_BASE_URL. */
export function createAnthropicAdapter(env: UpstreamEnv): UpstreamAdapter {
  return {
    name: "anthropic",
    baseUrl: env["ANTHROPIC_BASE_URL"] ?? "https://api.anthropic.com",
    chatCompletions() {
      throw new Error("anthropic adapter does not serve /v1/chat/completions");
    },
    messages() {
      throw new Error("anthropic.messages: not implemented");
    },
  };
}
