/**
 * An agent behind any HTTP API (REQ-051, ADR-0042). What to send to start a run, how to see that it is done
 * and how to stop it are written as settings with `{{prompt}}`-style holes, so an API that does not speak
 * the Terrarium harness protocol is reached by writing down what it already does, not by writing code.
 */
import type {
  AgentRunOutcome,
  AgentRunRequest,
  HarnessPort,
  TalkReply,
  TalkRequest,
} from "@terrarium/core/experiments";
import { z } from "zod";
import type { FetchLike } from "../fetch";
import { credential, credentialFields } from "./credential";
import { base, EnvName, Url } from "./fields";
import { defineConnector } from "./types";
import {
  fillJson,
  fillPath,
  joinUrl,
  pointerGet,
  sleep,
  snippet,
  unknownNames,
  type Vars,
  varsOf,
} from "./util";

const NAMES = [
  "runId",
  "agentId",
  "seed",
  "prompt",
  "mcpUrl",
  "traceparent",
  "maxToolCalls",
  "timeLimitSeconds",
  "remoteId",
];
const MAX_POLL_FAILURES = 5;

const Words = z.array(z.string().min(1).max(40)).max(20);

const schema = z
  .object({
    ...base("http-template"),
    url: Url,
    tokenEnv: EnvName.optional(),
    /** Header the token goes in, and what comes before it. */
    authHeader: z.string().min(1).max(60).default("Authorization"),
    authPrefix: z.string().max(20).default("Bearer "),
    headers: z.record(z.string().max(300)).default({}),
    agentId: z.string().min(1).max(64).default("agent"),
    agentName: z.string().max(80).optional(),
    model: z.string().max(80).optional(),
    healthPath: z.string().max(200).optional(),
    startMethod: z.enum(["POST", "PUT"]).default("POST"),
    startPath: z.string().min(1).max(200).default("/"),
    startBody: z.string().max(4000).default('{"prompt": "{{prompt}}", "mcpUrl": "{{mcpUrl}}"}'),
    /** sync: the start request answers when the agent is done. poll: it answers at once and a status path is asked. */
    mode: z.enum(["sync", "poll"]).default("sync"),
    idPointer: z.string().max(100).optional(),
    statusPath: z.string().max(200).optional(),
    statusPointer: z.string().max(100).optional(),
    doneValues: Words.default(["done", "finished", "completed", "succeeded", "success"]),
    failedValues: Words.default(["failed", "error", "cancelled", "canceled"]),
    cancelPath: z.string().max(200).optional(),
    cancelMethod: z.enum(["DELETE", "POST"]).default("DELETE"),
    pollSeconds: z.number().min(0.05).max(60).default(2),
    /** Where the agent's answer sits in the reply (a JSON pointer), for "말 걸어 보기". Left out, the whole body is the answer. */
    replyPointer: z.string().max(100).optional(),
    /** Which preset the form made this from, so editing shows the same few fields again. */
    preset: z.string().max(30).optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    const say = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    for (const key of ["startPath", "statusPath", "cancelPath", "healthPath"] as const) {
      const bad = unknownNames(c[key] ?? "", NAMES);
      if (bad.length > 0) say(key, `모르는 변수 {{${bad.join("}}, {{")}}}가 있어요`);
    }
    const bad = unknownNames(c.startBody, NAMES);
    if (bad.length > 0) say("startBody", `모르는 변수 {{${bad.join("}}, {{")}}}가 있어요`);
    try {
      JSON.parse(fillJson(c.startBody, Object.fromEntries(NAMES.map((n) => [n, "x"]))));
    } catch {
      say("startBody", "JSON 형식이 아니에요 ({{변수}}는 따옴표 안에 써요)");
    }
    if (c.mode === "poll" && !c.statusPath)
      say("statusPath", "상태를 묻는 방식에는 주소가 필요해요");
    if (c.mode === "poll" && !c.statusPointer)
      say("statusPointer", "상태를 묻는 방식에는 상태 값의 위치(예: /status)가 필요해요");
  });

export type HttpTemplateConfig = z.output<typeof schema>;

export class TemplateAgent implements HarnessPort {
  readonly info;

  constructor(
    private readonly config: HttpTemplateConfig,
    private readonly token: string | undefined,
    private readonly fetchImpl: FetchLike,
  ) {
    this.info = {
      id: config.id,
      name: config.name,
      kind: "http-template",
      description: config.description || "HTTP API로 연결된 에이전트.",
      toolTransport: "mcp" as const,
      telemetry: "none" as const,
    };
  }

  private async request(
    method: string,
    path: string,
    signal: AbortSignal,
    body?: string,
    extra: Readonly<Record<string, string>> = {},
  ): Promise<Response> {
    const { config } = this;
    return this.fetchImpl(joinUrl(config.url, path), {
      method,
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...config.headers,
        ...extra,
        ...(this.token ? { [config.authHeader]: `${config.authPrefix}${this.token}` } : {}),
      },
      ...(body === undefined ? {} : { body }),
      signal,
    });
  }

  /** The one agent this connection is. With a health path, it must answer for the agent to count as reachable. */
  async agents() {
    const c = this.config;
    if (c.healthPath) {
      const r = await this.request("GET", c.healthPath, AbortSignal.timeout(10_000));
      if (!r.ok) throw new Error(`상태 확인 주소가 ${r.status}로 답했어요`);
    }
    return [
      {
        id: c.agentId,
        name: c.agentName ?? c.name,
        ...(c.model ? { model: c.model } : {}),
        ...(c.description ? { description: c.description } : {}),
      },
    ];
  }

  /** One question, no tools: the start request with the text as the prompt, and the answer read from the reply. */
  async talk(req: TalkRequest): Promise<TalkReply> {
    const c = this.config;
    if (c.mode !== "sync")
      throw new Error("상태를 물어보는 방식(poll)의 에이전트는 아직 말 걸어 보기를 못 해요");
    const vars = varsOf(
      {
        runId: req.runId,
        agentId: c.agentId,
        seed: 0,
        prompt: req.text,
        limits: { maxToolCalls: 0, timeLimitSeconds: 60 },
        tools: { specs: [], call: async () => ({ ok: false, error: "툴이 없어요" }) },
        signal: req.signal,
        ...(req.telemetry ? { traceparent: req.telemetry.traceparent } : {}),
      },
      { remoteId: "" },
    );
    const r = await this.request(
      c.startMethod,
      fillPath(c.startPath, vars),
      req.signal,
      fillJson(c.startBody, vars),
      req.telemetry?.headers,
    );
    const text = await r.text();
    if (!r.ok) throw new Error(`${r.status}로 답했어요: ${snippet(text)}`);
    if (!c.replyPointer) return { text, toolCalls: 0 };
    const answer = pointerGet(safeJson(text), c.replyPointer);
    if (typeof answer !== "string")
      throw new Error(`답에서 ${c.replyPointer} 자리를 찾지 못했어요: ${snippet(text)}`);
    const reply = safeJson(text) as
      | { model?: unknown; usage?: Record<string, unknown> }
      | undefined;
    const tokens = (k: string) =>
      typeof reply?.usage?.[k] === "number" ? (reply.usage[k] as number) : undefined;
    return {
      text: answer,
      ...(typeof reply?.model === "string" ? { model: reply.model } : {}),
      ...(tokens("prompt_tokens") === undefined
        ? {}
        : { inputTokens: tokens("prompt_tokens") as number }),
      ...(tokens("completion_tokens") === undefined
        ? {}
        : { outputTokens: tokens("completion_tokens") as number }),
      toolCalls: 0,
    };
  }

  async run(req: AgentRunRequest): Promise<AgentRunOutcome> {
    const c = this.config;
    if (!req.tools.mcpUrl && c.startBody.includes("{{mcpUrl}}"))
      return { status: "error", message: "이 실행에는 MCP 엔드포인트가 없어요" };
    const vars = varsOf(req);
    const wall = AbortSignal.any([
      req.signal,
      AbortSignal.timeout(req.limits.timeLimitSeconds * 1000 + 60_000),
    ]);
    const t0 = performance.now();
    try {
      const r = await this.request(
        c.startMethod,
        fillPath(c.startPath, vars),
        wall,
        fillJson(c.startBody, vars),
        req.telemetry?.headers,
      );
      if (!r.ok)
        return {
          status: "error",
          message: `시작 요청이 ${r.status}로 답했어요: ${snippet(await r.text())}`,
        };
      const text = await r.text();
      const seconds = () => ({ harness: { wallSeconds: (performance.now() - t0) / 1000 } });
      if (c.mode === "sync") return { status: "finished", ...seconds(), message: snippet(text) };
      const reply = safeJson(text);
      const remote = String(pointerGet(reply, c.idPointer) ?? req.runId);
      return await this.poll(req, { ...vars, remoteId: remote }, wall, seconds);
    } catch (err) {
      if (req.signal.aborted) return { status: "cancelled" };
      return {
        status: "error",
        message: `에이전트에 연결하지 못했어요: ${(err as Error).message}`,
      };
    }
  }

  private async poll(
    req: AgentRunRequest,
    vars: Vars,
    wall: AbortSignal,
    seconds: () => object,
  ): Promise<AgentRunOutcome> {
    const c = this.config;
    let failures = 0;
    while (!wall.aborted) {
      await sleep(c.pollSeconds * 1000, wall);
      if (wall.aborted) break;
      try {
        const outcome = await this.lookAtStatus(vars, wall, seconds);
        failures = 0;
        if (outcome) return outcome;
      } catch (err) {
        if (wall.aborted) break;
        if (++failures >= MAX_POLL_FAILURES)
          return {
            status: "error",
            message: `상태를 ${failures}번 연달아 못 읽었어요: ${(err as Error).message}`,
          };
      }
    }
    if (c.cancelPath) await this.cancel(vars);
    return req.signal.aborted
      ? { status: "cancelled" }
      : { status: "error", message: "시간이 다 됐어요" };
  }

  /** One look at the status: how the run ended, or `undefined` while it is still going. A failed read throws. */
  private async lookAtStatus(
    vars: Vars,
    wall: AbortSignal,
    seconds: () => object,
  ): Promise<AgentRunOutcome | undefined> {
    const c = this.config;
    const r = await this.request("GET", fillPath(c.statusPath ?? "", vars), wall);
    if (!r.ok) throw new Error(`${r.status}`);
    const state = String(pointerGet(safeJson(await r.text()), c.statusPointer) ?? "").toLowerCase();
    if (c.doneValues.some((v) => v.toLowerCase() === state))
      return { status: "finished", ...seconds(), message: state };
    if (c.failedValues.some((v) => v.toLowerCase() === state))
      return { status: "error", message: `에이전트 상태: ${state}` };
    return undefined;
  }

  private async cancel(vars: Vars): Promise<void> {
    const c = this.config;
    await this.request(
      c.cancelMethod,
      fillPath(c.cancelPath ?? "", vars),
      AbortSignal.timeout(10_000),
    ).catch(() => undefined);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const HOLES =
  "{{prompt}} {{runId}} {{agentId}} {{seed}} {{mcpUrl}} {{traceparent}} {{maxToolCalls}} {{timeLimitSeconds}}";

export const httpTemplateConnector = defineConnector({
  spec: {
    kind: "http-template",
    label: "범용 HTTP API (요청을 직접 적기)",
    description:
      "에이전트가 평범한 HTTP API일 때 써요. 시작할 때 보낼 요청과, 끝났는지 보는 방법, 멈추는 방법을 적어요. 코드를 짤 필요가 없어요.",
    scope: "agent",
    toolTransport: "mcp",
    toolGuide: [
      "시작 요청 본문에 {{mcpUrl}} 을 쓰면 이 실행 전용 툴 주소가 들어가요. 에이전트는 그 주소의 MCP 서버를 툴로 쓰면 돼요.",
      "본문에 {{mcpUrl}} 이 없으면 테라리움의 툴을 쓰지 않는 에이전트로 보고 실행해요(점수가 나오지 않을 수 있어요).",
      "에이전트가 테라리움 서버 주소에 연결할 수 있어야 해요. 테라리움 주소가 localhost이면 서버 설정의 publicUrl 을 바꿔 주세요.",
      "OpenAI 호환 채팅은 툴을 받지 못하고 한 번 답하고 끝나요. 말이 통하는지 볼 때 쓰고, 점수를 재는 실험에는 툴을 쓰는 에이전트를 연결해요.",
    ],
    presets: [
      {
        key: "openai",
        label: "OpenAI 호환 채팅",
        description:
          "OpenAI 호환 채팅 API에 연결해요. vLLM, LiteLLM, Ollama 같은 모델 서버도 이 모양이에요. 주소, 모델, 토큰만 적어요.",
        fields: [
          {
            key: "url",
            label: "주소",
            type: "url",
            required: true,
            placeholder: "https://llm.internal/v1",
            help: "끝이 /v1인 주소를 적어요. /chat/completions는 알아서 붙여요.",
          },
          { key: "model", label: "모델 이름", type: "text", required: true, placeholder: "gpt-4o" },
          {
            key: "token",
            label: "토큰",
            type: "secret",
            help: "입력하면 서버에 암호화해서 저장하고, 저장한 뒤에는 다시 보여 주지 않아요.",
          },
        ],
        fixed: {
          startBody:
            '{"model": "[[model]]", "messages": [{"role": "user", "content": "{{prompt}}"}]}',
          replyPointer: "/choices/0/message/content",
          preset: "openai",
        },
        urlPath: { into: "startPath", append: "/chat/completions" },
        promise: {
          request:
            'POST {주소}/chat/completions · {"model": "…", "messages": [{"role": "user", "content": "과제 문장"}]}',
          reply: '{"choices": [{"message": {"content": "답"}}]}',
        },
      },
      {
        key: "simple",
        label: "간단 JSON",
        description:
          "주소 하나만 있는 API에 연결해요. 과제 문장과 툴 서버 주소를 보내고, 답을 text로 받아요.",
        fields: [
          {
            key: "url",
            label: "주소",
            type: "url",
            required: true,
            placeholder: "https://agent.internal/ask",
          },
        ],
        fixed: {
          startBody: '{"prompt": "{{prompt}}", "tools": "{{mcpUrl}}"}',
          replyPointer: "/text",
          preset: "simple",
        },
        urlPath: { into: "startPath" },
        promise: {
          request: 'POST {주소} · {"prompt": "과제 문장", "tools": "툴 서버(MCP) 주소"}',
          reply: '{"text": "답"}',
        },
      },
    ],
    fromScreen: true,
    fields: [
      {
        key: "url",
        label: "API 주소",
        type: "url",
        required: true,
        placeholder: "https://agent.internal",
      },
      ...credentialFields("token", "토큰", "AGENT_TOKEN"),
      {
        key: "agentId",
        label: "에이전트 id",
        type: "text",
        default: "agent",
        help: "실험에서 이 에이전트를 가리키는 이름.",
      },
      { key: "agentName", label: "에이전트 이름", type: "text" },
      { key: "model", label: "모델 이름", type: "text", help: "결과에 모델별로 나뉘어 보여요." },
      {
        key: "healthPath",
        label: "상태 확인 주소",
        type: "text",
        placeholder: "/health",
        help: "있으면 연결 확인에서 이 주소가 2xx로 답해야 해요. 없으면 연결되는지는 확인하지 못해요.",
      },
      {
        key: "startMethod",
        label: "시작 요청 방식",
        type: "select",
        default: "POST",
        options: [
          { value: "POST", label: "POST" },
          { value: "PUT", label: "PUT" },
        ],
      },
      {
        key: "startPath",
        label: "시작 요청 주소",
        type: "text",
        default: "/",
        help: `쓸 수 있는 변수: ${HOLES}`,
      },
      {
        key: "startBody",
        label: "시작 요청 본문(JSON)",
        type: "textarea",
        default: '{"prompt": "{{prompt}}", "mcpUrl": "{{mcpUrl}}"}',
        help: "변수는 따옴표 안에 써요. 값은 알아서 안전하게 들어가요.",
      },
      {
        key: "mode",
        label: "끝나는 방식",
        type: "select",
        default: "sync",
        options: [
          { value: "sync", label: "시작 요청이 끝날 때까지 답하지 않아요" },
          { value: "poll", label: "바로 답하고 상태를 물어봐야 해요" },
        ],
      },
      {
        key: "idPointer",
        label: "응답에서 실행 id의 위치",
        type: "text",
        placeholder: "/id",
        help: "상태 확인 방식에서 {{remoteId}}로 써요. 없으면 테라리움의 실행 id를 써요.",
      },
      { key: "statusPath", label: "상태 주소", type: "text", placeholder: "/runs/{{remoteId}}" },
      {
        key: "statusPointer",
        label: "응답에서 상태 값의 위치",
        type: "text",
        placeholder: "/status",
      },
      {
        key: "doneValues",
        label: "끝났다는 값",
        type: "lines",
        help: "한 줄에 하나. 비워 두면 done, finished, completed, succeeded, success.",
      },
      {
        key: "failedValues",
        label: "실패했다는 값",
        type: "lines",
        help: "한 줄에 하나. 비워 두면 failed, error, cancelled, canceled.",
      },
      { key: "cancelPath", label: "중지 주소", type: "text", placeholder: "/runs/{{remoteId}}" },
      { key: "pollSeconds", label: "상태를 묻는 간격(초)", type: "number", default: 2 },
      {
        key: "replyPointer",
        label: "응답에서 답의 위치",
        type: "text",
        placeholder: "/text",
        help: "말 걸어 보기에서 답으로 보여 줄 값의 위치예요. 비워 두면 응답 전체를 보여 줘요.",
      },
    ],
  },
  schema,
  connect: (config, ctx) =>
    new TemplateAgent(config, credential(ctx, "token", config.tokenEnv), ctx.fetch),
});
