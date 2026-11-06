/** core.llm: a thin client for the model APIs people register (REQ-099, ADR-0119). */
import { createAnthropicClient } from "./anthropic-compatible";
import { createOpenAiClient } from "./openai-compatible";
import type { LlmClient, LlmClientOptions, LlmKind } from "./types";

export { ANTHROPIC_VERSION, createAnthropicClient } from "./anthropic-compatible";
export { checkLlm, type LlmCheck, MAX_LISTED } from "./check";
export { failureText, joinUrl } from "./http";
export { createOpenAiClient, modelNames } from "./openai-compatible";
export {
  type CompleteRequest,
  type CompleteResult,
  DEFAULT_TIMEOUT_MS,
  type FetchLike,
  LLM_KINDS,
  type LlmClient,
  type LlmClientOptions,
  LlmError,
  type LlmFailReason,
  type LlmKind,
  type LlmMessage,
} from "./types";

/** The client for a kind: `litellm` and `openai` share the OpenAI adapter, `anthropic` has its own. */
export function createLlmClient(kind: LlmKind, options: LlmClientOptions): LlmClient {
  return kind === "anthropic"
    ? createAnthropicClient(options)
    : createOpenAiClient({ ...options, litellm: kind === "litellm" });
}
