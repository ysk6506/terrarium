/**
 * An OpenClaw gateway, reached through its OpenAI-compatible Chat Completions endpoint (REQ-051,
 * ADR-0042). The gateway treats the `model` field as an agent target (`openclaw/<agentId>`) and lists them
 * at `GET /v1/models`. It takes function tools in the request, so Terrarium's tools are offered that way:
 * the agent answers with tool calls, Terrarium runs them and sends the results back, turn after turn, until
 * the diagnosis is submitted. The endpoint is switched off in the gateway until
 * `gateway.http.endpoints.chatCompletions.enabled` is set.
 *
 * Run against a real gateway (openclaw 2026.10.10, see docs/design-docs/harness-e2e.md): the endpoint and the
 * tool loop work as described; the gateway flattens the history into one user message, so a model sees tool
 * results as text. All of this is from OpenClaw's own page on the endpoint. It has no call to stop a run that was seen in
 * the docs, so stopping one only stops waiting for it.
 */
import type {
  AgentInfo,
  AgentRunOutcome,
  AgentRunRequest,
  HarnessInfo,
  HarnessPort,
  TalkReply,
  TalkRequest,
  ToolCallOutcome,
} from "@terrarium/core/experiments";
import { z } from "zod";
import type { FetchLike } from "../fetch";
import { credential, credentialFields } from "./credential";
import { base, EnvName, Url } from "./fields";
import { Rest } from "./rest";
import { chatTalk } from "./talk";
import { defineConnector } from "./types";
import { traceHeaders } from "./util";

const SYSTEM_PROMPT = [
  "You are an on-call engineer for a data center. Investigate with the tools you are given;",
  "they are the only way to see or change anything. Find the root cause and the fault type,",
  "then call submit_diagnosis exactly once. Do not guess before you have looked.",
].join(" ");

const schema = z
  .object({
    ...base("openclaw"),
    url: Url,
    tokenEnv: EnvName.optional(),
    maxTurns: z.number().int().min(1).max(200).default(40),
    requestTimeoutSeconds: z.number().min(1).max(1800).default(300),
  })
  .strict();

export type OpenClawConfig = z.output<typeof schema>;

interface ToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: { readonly name: string; readonly arguments: string };
}
interface Message {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string | null;
  readonly tool_calls?: readonly ToolCall[];
  readonly tool_call_id?: string;
}
interface Completion {
  readonly model?: string;
  readonly choices?: readonly { readonly message?: Message }[];
  readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number };
}

/** What the agent reads back from a tool: the data, or the error in words. */
function toolMessage(result: ToolCallOutcome): string {
  const text = JSON.stringify(
    result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error },
  );
  return text.length > 60_000 ? `${text.slice(0, 60_000)}… (truncated)` : text;
}

function argsOf(text: string): Record<string, unknown> | string {
  try {
    const value = JSON.parse(text || "{}") as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : "arguments must be a JSON object";
  } catch {
    return "arguments are not valid JSON";
  }
}

export class OpenClawHarness implements HarnessPort {
  readonly info: HarnessInfo;
  private readonly rest: Rest;

  constructor(
    private readonly config: OpenClawConfig,
    token: string | undefined,
    fetchImpl: FetchLike,
  ) {
    this.info = {
      id: config.id,
      name: config.name,
      kind: "openclaw",
      description:
        config.description || "OpenClaw 게이트웨이. 게이트웨이의 에이전트를 고를 수 있어요.",
      toolTransport: "function-calling",
      telemetry: "none",
    };
    this.rest = new Rest(config.url, token ? { authorization: `Bearer ${token}` } : {}, fetchImpl);
  }

  async agents(): Promise<readonly AgentInfo[]> {
    const list = await this.rest.json<{ data?: ReadonlyArray<{ id?: string }> }>(
      "에이전트 목록",
      "GET",
      "/v1/models",
      AbortSignal.timeout(10_000),
    );
    return (list.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string" && id.startsWith("openclaw/"))
      .map((id) => id.slice("openclaw/".length))
      .map((agent) => ({
        id: agent,
        name: agent === "default" ? "기본 에이전트" : agent,
        ...(agent === "default" ? { description: "게이트웨이에 정해진 기본 에이전트." } : {}),
      }));
  }

  talk(req: TalkRequest): Promise<TalkReply> {
    return chatTalk(this.rest, `openclaw/${req.agentId}`, req);
  }

  async run(req: AgentRunRequest): Promise<AgentRunOutcome> {
    const messages: Message[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: req.prompt },
    ];
    const used: { inputTokens: number; outputTokens: number; model?: string } = {
      inputTokens: 0,
      outputTokens: 0,
    };
    let ended = false;
    try {
      for (let turn = 0; turn < this.config.maxTurns && !ended; turn++) {
        if (req.signal.aborted) return { status: "cancelled", harness: used };
        const reply = await this.complete(req, messages, used);
        messages.push(reply);
        if (!reply.tool_calls?.length)
          return {
            status: "finished",
            message: "에이전트가 툴 호출 없이 답을 끝냈어요",
            harness: used,
          };
        for (const call of reply.tool_calls) {
          const args = argsOf(call.function.arguments);
          const result: ToolCallOutcome =
            typeof args === "string"
              ? { ok: false, error: args }
              : await req.tools.call(call.function.name, args);
          messages.push({ role: "tool", tool_call_id: call.id, content: toolMessage(result) });
          if (result.ended) ended = true;
        }
      }
      return {
        status: "finished",
        ...(ended ? {} : { message: `${this.config.maxTurns}턴 안에 끝내지 못했어요` }),
        harness: used,
      };
    } catch (err) {
      if (req.signal.aborted) return { status: "cancelled", harness: used };
      return { status: "error", message: (err as Error).message, harness: used };
    }
  }

  private async complete(
    req: AgentRunRequest,
    messages: readonly Message[],
    used: { inputTokens: number; outputTokens: number; model?: string },
  ): Promise<Message> {
    const signal = AbortSignal.any([
      req.signal,
      AbortSignal.timeout(this.config.requestTimeoutSeconds * 1000),
    ]);
    const body = await this.rest.json<Completion>(
      "채팅 요청",
      "POST",
      "/v1/chat/completions",
      signal,
      {
        model: `openclaw/${req.agentId}`,
        messages,
        tools: req.tools.specs.map((s) => ({
          type: "function",
          function: { name: s.name, description: s.description, parameters: s.inputSchema },
        })),
        tool_choice: "auto",
      },
      traceHeaders(req),
    );
    used.inputTokens += body.usage?.prompt_tokens ?? 0;
    used.outputTokens += body.usage?.completion_tokens ?? 0;
    if (body.model) used.model = body.model;
    const message = body.choices?.[0]?.message;
    if (!message) throw new Error("게이트웨이가 빈 응답을 보냈어요");
    return message;
  }
}

export const openClawConnector = defineConnector({
  spec: {
    kind: "openclaw",
    label: "OpenClaw (게이트웨이)",
    description:
      "OpenClaw 게이트웨이의 OpenAI 호환 채팅 엔드포인트에 연결해요. 게이트웨이의 에이전트가 목록에 나오고, 테라리움 툴은 함수 툴로 건네요. 게이트웨이 설정에서 이 엔드포인트를 켜 두어야 해요(기본은 꺼짐).",
    scope: "harness",
    toolTransport: "function-calling",
    toolGuide: [
      "이 실행의 툴은 요청의 함수 호출(tools)로 직접 넘겨요. 툴 목록은 테라리움이 정하고, 호출 결과도 테라리움이 돌려줘요.",
      "OpenClaw 게이트웨이에서 /v1/chat/completions 를 켜 두어야 해요(gateway.http.endpoints.chatCompletions.enabled).",
      "에이전트가 함수 호출을 쓸 수 있는 모델을 쓰고 있어야 해요.",
      "게이트웨이 설정에서 tools.toolSearch 를 false 로 두어야 테라리움 툴이 에이전트에게 바로 보여요. 켜 두면 툴이 검색 뒤에 숨어 있어요.",
      "OpenClaw 에이전트에는 exec, write 같은 자체 툴도 같이 보여요. 공정하게 재려면 tools.profile 과 tools.deny 로 줄여 주세요.",
      "프롬프트와 툴 스키마만 5만 토큰 가까이 돼요. 컨텍스트 창이 6만 토큰 이상인 모델을 써 주세요.",
    ],
    fromScreen: true,
    fields: [
      {
        key: "url",
        label: "게이트웨이 주소",
        type: "url",
        required: true,
        placeholder: "http://127.0.0.1:18789",
      },
      ...credentialFields("token", "토큰", "OPENCLAW_GATEWAY_TOKEN"),
      {
        key: "maxTurns",
        label: "최대 대화 횟수",
        type: "number",
        default: 40,
        help: "에이전트와 툴을 주고받는 최대 횟수.",
      },
      {
        key: "requestTimeoutSeconds",
        label: "한 번의 요청 제한(초)",
        type: "number",
        default: 300,
      },
    ],
  },
  schema,
  connect: (config, ctx) =>
    new OpenClawHarness(config, credential(ctx, "token", config.tokenEnv), ctx.fetch),
});
