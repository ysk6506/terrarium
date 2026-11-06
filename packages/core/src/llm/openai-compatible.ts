/**
 * The OpenAI-style API (`/v1/models`, `/v1/chat/completions`, `Authorization: Bearer`). LiteLLM speaks it too; its
 * model list is also read from `/model/info` when `/v1/models` does not answer.
 */
import { failureText, joinUrl, requester } from "./http";
import {
  type CompleteRequest,
  type CompleteResult,
  type LlmClient,
  type LlmClientOptions,
  LlmError,
} from "./types";

type Json = Record<string, unknown>;
const asObject = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown): string | undefined =>
  typeof v === "string" && v !== "" ? v : undefined;
const count = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

/** `{data: [{id}]}` of `/v1/models`, or `{data: [{model_name}]}` of LiteLLM's `/model/info`. */
export function modelNames(body: unknown): string[] {
  const names = asList(asObject(body).data).flatMap((m) => {
    const row = asObject(m);
    return text(row.id) ?? text(row.model_name) ?? [];
  });
  return [...new Set(names)];
}

/** The answer's words: a string, or a list of parts some gateways return. */
function contentOf(content: unknown): string {
  if (typeof content === "string") return content;
  return asList(content)
    .map((p) => text(asObject(p).text) ?? "")
    .join("");
}

export interface OpenAiClientOptions extends LlmClientOptions {
  /** LiteLLM: also try `/model/info` for the model list. */
  readonly litellm?: boolean;
}

export function createOpenAiClient(options: OpenAiClientOptions): LlmClient {
  const http = requester(
    options,
    options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {},
  );
  const noList = () => new LlmError("no-models", failureText("no-models"));
  return {
    async listModels() {
      const paths = options.litellm ? ["/v1/models", "/model/info"] : ["/v1/models"];
      let failure: LlmError | undefined;
      for (const path of paths) {
        try {
          const names = modelNames(await http.json("GET", joinUrl(options.baseUrl, path)));
          if (names.length > 0) return names;
          failure ??= noList();
        } catch (err) {
          if (!(err instanceof LlmError)) throw err;
          // a missing path is a reason to try the next one; a rejected key or a dead address is not
          if (err.reason !== "address" || err.status === undefined) throw err;
          failure ??= err;
        }
      }
      throw failure ?? noList();
    },

    async complete(req: CompleteRequest): Promise<CompleteResult> {
      const model = req.model ?? options.model;
      if (!model) throw new LlmError("other", "모델 이름이 필요해요");
      const messages = [
        ...(req.system ? [{ role: "system", content: req.system }] : []),
        ...req.messages,
      ];
      const body = asObject(
        await http.json("POST", joinUrl(options.baseUrl, "/v1/chat/completions"), {
          model,
          messages,
          max_tokens: req.maxTokens ?? 1024,
        }),
      );
      const choice = asObject(asList(body.choices)[0]);
      const usage = asObject(body.usage);
      const input = count(usage.prompt_tokens);
      const output = count(usage.completion_tokens);
      return {
        text: contentOf(asObject(choice.message).content),
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
