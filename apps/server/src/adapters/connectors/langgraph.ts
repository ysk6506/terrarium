/**
 * A LangGraph Agent Server (what a LangGraph or LangChain agent becomes when it is deployed with
 * `langgraph dev`, LangSmith Deployment or a self-hosted container), reached through its REST API
 * (REQ-051, ADR-0042). Its assistants are the agents. A run is a thread plus a background run that is
 * asked about until it ends.
 *
 * A LangGraph graph is code, so it gets Terrarium's tools only if it asks for them: the address of the
 * run's MCP endpoint is put in `config.configurable.terrarium_mcp_url`, and the graph (for example with
 * langchain-mcp-adapters) reads it from there.
 *
 * Endpoints were read from the Agent Server API reference and the generated client; the request bodies and
 * the run status names come from the LangGraph SDK as remembered, not from a page that was read.
 */
import type {
  AgentInfo,
  AgentRunOutcome,
  AgentRunRequest,
  HarnessInfo,
  HarnessPort,
} from "@terrarium/core/experiments";
import { z } from "zod";
import type { FetchLike } from "../fetch";
import { credential, credentialFields } from "./credential";
import { base, EnvName, Url } from "./fields";
import { Rest } from "./rest";
import { defineConnector } from "./types";
import { fillJson, sleep, varsOf } from "./util";

const DEFAULT_INPUT = '{"messages":[{"role":"user","content":"{{prompt}}"}]}';
const MAX_POLL_FAILURES = 5;
const PAGE = 100;
const MAX_ASSISTANTS = 1000;

const schema = z
  .object({
    ...base("langgraph"),
    url: Url,
    apiKeyEnv: EnvName.optional(),
    input: z
      .string()
      .max(5000)
      .default(DEFAULT_INPUT)
      .superRefine((text, ctx) => {
        try {
          JSON.parse(text.replace(/\{\{\s*[A-Za-z]+\s*\}\}/g, "x"));
        } catch {
          ctx.addIssue({ code: "custom", message: "입력이 JSON이어야 해요" });
        }
      }),
    pollSeconds: z.number().min(0.05).max(60).default(2),
  })
  .strict();

export type LangGraphConfig = z.output<typeof schema>;

interface Assistant {
  readonly assistant_id?: string;
  readonly graph_id?: string;
  readonly version?: number;
  readonly name?: string;
  readonly description?: string;
}
interface RunState {
  readonly status?: string;
}

export class LangGraphHarness implements HarnessPort {
  readonly info: HarnessInfo;
  private readonly rest: Rest;

  constructor(
    private readonly config: LangGraphConfig,
    apiKey: string | undefined,
    fetchImpl: FetchLike,
  ) {
    this.info = {
      id: config.id,
      name: config.name,
      kind: "langgraph",
      description: config.description || "LangGraph Agent Server. 어시스턴트가 에이전트예요.",
      toolTransport: "mcp",
      telemetry: "none",
    };
    this.rest = new Rest(config.url, apiKey ? { "x-api-key": apiKey } : {}, fetchImpl);
  }

  async agents(): Promise<readonly AgentInfo[]> {
    const signal = AbortSignal.timeout(10_000);
    const found: Assistant[] = [];
    for (let offset = 0; offset < MAX_ASSISTANTS; offset += PAGE) {
      const page = await this.rest.json<Assistant[]>(
        "어시스턴트 목록",
        "POST",
        "/assistants/search",
        signal,
        { limit: PAGE, offset },
      );
      found.push(...page);
      if (page.length < PAGE) break;
    }
    return found
      .filter((a): a is Assistant & { assistant_id: string } => typeof a.assistant_id === "string")
      .map((a) => ({
        id: a.assistant_id,
        name: a.name ?? a.graph_id ?? a.assistant_id,
        ...(a.description ? { description: a.description } : {}),
        facts: {
          ...(a.graph_id ? { graph: a.graph_id } : {}),
          ...(a.version === undefined ? {} : { assistantVersion: String(a.version) }),
        },
      }));
  }

  async run(req: AgentRunRequest): Promise<AgentRunOutcome> {
    const wall = AbortSignal.any([
      req.signal,
      AbortSignal.timeout(req.limits.timeLimitSeconds * 1000 + 60_000),
    ]);
    const t0 = performance.now();
    const seconds = () => ({ harness: { wallSeconds: (performance.now() - t0) / 1000 } });
    let where: { thread: string; run: string } | undefined;
    try {
      const thread = await this.rest.json<{ thread_id: string }>(
        "스레드 만들기",
        "POST",
        "/threads",
        wall,
        { metadata: { terrarium_run_id: req.runId } },
      );
      const started = await this.rest.json<{ run_id: string }>(
        "실행 시작",
        "POST",
        `/threads/${encodeURIComponent(thread.thread_id)}/runs`,
        wall,
        {
          assistant_id: req.agentId,
          input: JSON.parse(fillJson(this.config.input, varsOf(req))),
          config: { configurable: configurable(req) },
          metadata: { terrarium_run_id: req.runId },
        },
      );
      where = { thread: thread.thread_id, run: started.run_id };
      return await this.poll(req, where, wall, seconds);
    } catch (err) {
      if (wall.aborted && where) await this.cancel(where);
      if (req.signal.aborted) return { status: "cancelled" };
      return {
        status: "error",
        message: `LangGraph 서버에 연결하지 못했어요: ${(err as Error).message}`,
      };
    }
  }

  private async poll(
    req: AgentRunRequest,
    where: { thread: string; run: string },
    wall: AbortSignal,
    seconds: () => object,
  ): Promise<AgentRunOutcome> {
    let failures = 0;
    while (!wall.aborted) {
      await sleep(this.config.pollSeconds * 1000, wall);
      if (wall.aborted) break;
      try {
        const state = await this.rest.json<RunState>(
          "실행 상태",
          "GET",
          `/threads/${encodeURIComponent(where.thread)}/runs/${encodeURIComponent(where.run)}`,
          wall,
        );
        failures = 0;
        const ended = endOf(state.status);
        if (ended) return { ...ended, ...(ended.status === "finished" ? seconds() : {}) };
      } catch (err) {
        if (wall.aborted) break;
        if (++failures >= MAX_POLL_FAILURES)
          return {
            status: "error",
            message: `실행 상태를 ${failures}번 연달아 못 읽었어요: ${(err as Error).message}`,
          };
      }
    }
    await this.cancel(where);
    return req.signal.aborted
      ? { status: "cancelled" }
      : { status: "error", message: "시간이 다 됐어요" };
  }

  private async cancel(where: { thread: string; run: string }): Promise<void> {
    await this.rest
      .send(
        "POST",
        `/threads/${encodeURIComponent(where.thread)}/runs/${encodeURIComponent(where.run)}/cancel?action=interrupt`,
        AbortSignal.timeout(10_000),
      )
      .catch(() => undefined);
  }
}

/** What the graph can read from `config["configurable"]` to reach this run's tools. */
export function configurable(req: AgentRunRequest): Record<string, unknown> {
  return {
    terrarium_mcp_url: req.tools.mcpUrl ?? "",
    terrarium_run_id: req.runId,
    terrarium_seed: req.seed,
    terrarium_max_tool_calls: req.limits.maxToolCalls,
    terrarium_time_limit_seconds: req.limits.timeLimitSeconds,
    ...(req.traceparent ? { terrarium_traceparent: req.traceparent } : {}),
  };
}

/** How a run's status ends the wait, or undefined while it goes on. */
function endOf(status: string | undefined): AgentRunOutcome | undefined {
  switch (status) {
    case "success":
      return { status: "finished" };
    case "error":
    case "timeout":
      return { status: "error", message: `LangGraph 실행이 '${status}'로 끝났어요` };
    case "interrupted":
      return { status: "error", message: "그래프가 사람의 입력을 기다리며 멈췄어요(interrupted)" };
    default:
      return undefined;
  }
}

export const langGraphConnector = defineConnector({
  spec: {
    kind: "langgraph",
    label: "LangGraph / LangChain (Agent Server)",
    description:
      "LangGraph Agent Server에 연결해요. 서버의 어시스턴트가 에이전트로 나와요. LangChain 에이전트도 배포하면 이 서버가 돼요. 그래프가 테라리움 툴을 쓰려면 config.configurable.terrarium_mcp_url을 읽도록 짜여 있어야 해요.",
    scope: "harness",
    toolTransport: "mcp",
    toolGuide: [
      "테라리움은 이 실행 전용 툴 주소를 요청의 config.configurable.terrarium_mcp_url 로 넘겨요. 그래프가 그 주소의 MCP 서버를 툴로 붙이도록 만들어 두어야 해요.",
      "같은 곳으로 terrarium_run_id, terrarium_seed, terrarium_max_tool_calls, terrarium_time_limit_seconds, terrarium_traceparent 도 가요.",
      "Agent Server가 테라리움 서버 주소에 연결할 수 있어야 해요. 테라리움 주소가 localhost이면 서버 설정의 publicUrl 을 바꿔 주세요.",
    ],
    fromScreen: true,
    fields: [
      {
        key: "url",
        label: "서버 주소",
        type: "url",
        required: true,
        placeholder: "http://localhost:2024",
        help: "`langgraph dev`는 2024번 포트를 써요.",
      },
      ...credentialFields("apiKey", "API 키", "LANGSMITH_API_KEY"),
      {
        key: "input",
        label: "그래프에 넣을 입력(JSON)",
        type: "textarea",
        default: DEFAULT_INPUT,
        help: "{{prompt}} 자리에 과제가 들어가요. 대화형 그래프는 기본값이면 돼요.",
      },
      { key: "pollSeconds", label: "상태를 묻는 간격(초)", type: "number", default: 2 },
    ],
  },
  schema,
  connect: (config, ctx) =>
    new LangGraphHarness(config, credential(ctx, "apiKey", config.apiKeyEnv), ctx.fetch),
});
