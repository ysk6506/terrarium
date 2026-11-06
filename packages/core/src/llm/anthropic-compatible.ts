/** The Claude-style API (`/v1/models`, `/v1/messages`, `x-api-key`, `anthropic-version`). */
import { joinUrl, requester } from "./http";
import { modelNames } from "./openai-compatible";
import {
  type CompleteRequest,
  type CompleteResult,
  type LlmClient,
  type LlmClientOptions,
  LlmError,
} from "./types";

export const ANTHROPIC_VERSION = "2023-06-01";

type Json = Record<string, unknown>;
const asObject = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const count = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

export function createAnthropicClient(options: LlmClientOptions): LlmClient {
  const http = requester(options, {
    "anthropic-version": ANTHROPIC_VERSION,
    ...(options.apiKey ? { "x-api-key": options.apiKey } : {}),
  });
  return {
    async listModels() {
      const names = modelNames(
        await http.json("GET", `${joinUrl(options.baseUrl, "/v1/models")}?limit=1000`),
      );
      if (names.length === 0) throw new LlmError("no-models", "모델 목록을 받지 못했어요");
      return names;
    },

    async complete(req: CompleteRequest): Promise<CompleteResult> {
      const model = req.model ?? options.model;
      if (!model) throw new LlmError("other", "모델 이름이 필요해요");
      const body = asObject(
        await http.json("POST", joinUrl(options.baseUrl, "/v1/messages"), {
          model,
          max_tokens: req.maxTokens ?? 1024,
          ...(req.system ? { system: req.system } : {}),
          messages: req.messages,
        }),
      );
      const usage = asObject(body.usage);
      const input = count(usage.input_tokens);
      const output = count(usage.output_tokens);
      return {
        text: asList(body.content)
          .map((b) => asObject(b))
          .filter((b) => b.type === "text" && typeof b.text === "string")
          .map((b) => b.text as string)
          .join(""),
        ...(input !== undefined || output !== undefined
          ? {
              usage: {
                ...(input !== undefined ? { inputTokens: input } : {}),
                ...(output !== undefined ? { outputTokens: output } : {}),
              },
            }
          : {}),
      };
    },
  };
}
