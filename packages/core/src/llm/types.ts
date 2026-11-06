/**
 * A thin client for the model APIs people register (REQ-099, ADR-0119). Two protocols cover three kinds:
 * `openai` and `litellm` speak the OpenAI one, `anthropic` the Claude one. Only what Terrarium needs is here: list the
 * models and ask for one complete answer. Streaming and tool calls are not done on purpose (ADR-0119 item 6).
 */

export const LLM_KINDS = ["litellm", "openai", "anthropic"] as const;
export type LlmKind = (typeof LLM_KINDS)[number];

/** The `fetch` the adapters use; tests hand in a fake, so no test reaches a real server. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface LlmMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface CompleteRequest {
  /** Left out: the client's own default model. */
  readonly model?: string;
  readonly system?: string;
  readonly messages: readonly LlmMessage[];
  readonly maxTokens?: number;
}

export interface CompleteResult {
  readonly text: string;
  readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number };
}

export interface LlmClient {
  /** The model names the API offers. Throws `LlmError`. */
  listModels(): Promise<string[]>;
  /** One answer to the messages. Throws `LlmError`. */
  complete(req: CompleteRequest): Promise<CompleteResult>;
}

/** Why a call failed, in the words the screen tells apart. */
export type LlmFailReason =
  | "address" // the name does not resolve, or the path is not there (404)
  | "network" // the server cannot get out to that address at all
  | "auth" // 401 / 403
  | "timeout"
  | "no-models" // answered, but with no model list
  | "rate" // 429
  | "server" // 5xx
  | "other";

export class LlmError extends Error {
  constructor(
    readonly reason: LlmFailReason,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export interface LlmClientOptions {
  /** The API's base address, with or without a trailing `/v1`. */
  readonly baseUrl: string;
  readonly apiKey?: string;
  /** Extra headers on every request (a company gateway's). They win over the defaults. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Used when a request names no model. */
  readonly model?: string;
  readonly fetch?: FetchLike;
  /** Per request, ms. */
  readonly timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 15_000;
