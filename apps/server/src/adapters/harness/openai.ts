/**
 * A minimal agent loop against an OpenAI-compatible Chat Completions endpoint (an internal LiteLLM
 * or vLLM gateway): the model sees Terrarium's tools as functions and calls them until it submits a
 * diagnosis or stops. It is a harness in its own right — the simplest one — so "which model" can be
 * compared with everything else held fixed.
 */
import type {
  AgentInfo,
  AgentRunOutcome,
  AgentRunRequest,
  HarnessInfo,
  HarnessPort,
  ToolCallOutcome,
} from "@terrarium/core/experiments";
import type { OpenAiHarnessConfig } from "../config";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

interface ChatToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: { readonly name: string; readonly arguments: string };
}

interface ChatMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string | null;
  readonly tool_calls?: readonly ChatToolCall[];
  readonly tool_call_id?: string;
}

interface ChatResponse {
  readonly choices: readonly { readonly message: ChatMessage; readonly finish_reason?: string }[];
  readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number };
}

export const SYSTEM_PROMPT = [
  "You are an on-call engineer for a data center. Investigate with the tools you are given;",
  "they are the only way to see or change anything. Find the root cause and the fault type,",
  "then call submit_diagnosis exactly once. Do not guess before you have looked.",
].join(" ");

/** What the model reads back from a tool: the data, or the error in words. */
export function toolMessage(result: ToolCallOutcome): string {
  const body = result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error };
  const text = JSON.stringify(body);
  return text.length > 60_000 ? `${text.slice(0, 60_000)}… (truncated)` : text;
}

function parseArgs(text: string): Record<string, unknown> | string {
  try {
    const value = JSON.parse(text || "{}") as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : "arguments must be a JSON object";
  } catch {
    return "arguments are not valid JSON";
  }
}

interface LoopState {
  readonly messages: ChatMessage[];
  inputTokens: number;
  outputTokens: number;
  ended: boolean;
}

export class OpenAiHarness implements HarnessPort {
  readonly info: HarnessInfo;

  constructor(
    private readonly config: OpenAiHarnessConfig,
    private readonly apiKey: string | undefined,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    this.info = {
      id: config.id,
      name: config.name,
      kind: "openai-compatible",
      description:
        config.description || "OpenAI 호환 엔드포인트의 모델이 테라리움 툴을 함수로 호출한다.",
      toolTransport: "function-calling",
      telemetry: "none",
    };
  }

  async agents(): Promise<readonly AgentInfo[]> {
    return this.config.models.map((m) => ({
      id: m.id,
      name: m.name ?? m.model,
      model: m.model,
      ...(m.description ? { description: m.description } : {}),
    }));
  }

  private async complete(req: AgentRunRequest, state: LoopState): Promise<ChatMessage> {
    const model = this.config.models.find((m) => m.id === req.agentId);
    if (!model) throw new Error(`'${req.agentId}' 모델이 설정에 없다`);
    const timeout = AbortSignal.timeout(this.config.requestTimeoutSeconds * 1000);
    const response = await this.fetchImpl(
      `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
          ...(req.traceparent ? { traceparent: req.traceparent } : {}),
        },
        body: JSON.stringify({
          model: model.model,
          messages: state.messages,
          tools: req.tools.specs.map((s) => ({
            type: "function",
            function: { name: s.name, description: s.description, parameters: s.inputSchema },
          })),
          tool_choice: "auto",
          ...(model.temperature !== undefined ? { temperature: model.temperature } : {}),
        }),
        signal: AbortSignal.any([req.signal, timeout]),
      },
    );
    if (!response.ok)
      throw new Error(
        `모델 엔드포인트가 ${response.status}로 답했다: ${(await response.text()).slice(0, 300)}`,
      );
    const body = (await response.json()) as ChatResponse;
    state.inputTokens += body.usage?.prompt_tokens ?? 0;
    state.outputTokens += body.usage?.completion_tokens ?? 0;
    const message = body.choices[0]?.message;
    if (!message) throw new Error("모델이 빈 응답을 보냈다");
    return message;
  }

  private async callTools(
    req: AgentRunRequest,
    calls: readonly ChatToolCall[],
    state: LoopState,
  ): Promise<void> {
    for (const call of calls) {
      const args = parseArgs(call.function.arguments);
      const result: ToolCallOutcome =
        typeof args === "string"
          ? { ok: false, error: args }
          : await req.tools.call(call.function.name, args);
      state.messages.push({ role: "tool", tool_call_id: call.id, content: toolMessage(result) });
      if (result.ended) state.ended = true;
    }
  }

  async run(req: AgentRunRequest): Promise<AgentRunOutcome> {
    const state: LoopState = {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: req.prompt },
      ],
      inputTokens: 0,
      outputTokens: 0,
      ended: false,
    };
    const usage = () => ({
      harness: { inputTokens: state.inputTokens, outputTokens: state.outputTokens },
    });
    try {
      for (let turn = 0; turn < this.config.maxTurns && !state.ended; turn++) {
        if (req.signal.aborted) return { status: "cancelled", ...usage() };
        const message = await this.complete(req, state);
        state.messages.push(message);
        if (!message.tool_calls || message.tool_calls.length === 0)
          return { status: "finished", message: "모델이 툴 호출 없이 답을 끝냈다", ...usage() };
        await this.callTools(req, message.tool_calls, state);
      }
      return state.ended
        ? { status: "finished", ...usage() }
        : {
            status: "finished",
            message: `${this.config.maxTurns}턴 안에 끝내지 못했다`,
            ...usage(),
          };
    } catch (err) {
      if (req.signal.aborted) return { status: "cancelled", ...usage() };
      return {
        status: "error",
        message: err instanceof Error ? err.message : String(err),
        ...usage(),
      };
    }
  }
}
