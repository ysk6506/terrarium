/**
 * A Hermes Agent gateway (REQ-051, ADR-0055), through the runs API of its API server: `POST /v1/runs` starts
 * a run and answers at once with its id (202), `GET /v1/runs/{id}` says how it is going, and
 * `POST /v1/runs/{id}/stop` stops it. A run ends as completed, failed, cancelled or interrupted.
 *
 * Hermes takes tools only from the `mcp_servers` of its own config file, not per request. So the tools come
 * to it through one fixed address of this connection (`mcpSlot`): the platform serves the tool list at that
 * address all the time and, while a run of this connection is going, runs the calls against that run's world.
 * A fixed address can mean only one run, so runs of one connection go one after the other.
 *
 * Read from Hermes Agent's source (gateway/platforms/api_server*.py); it has not been run against a live
 * Hermes yet.
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
import { KeyedQueue, sleep } from "./util";

const schema = z
  .object({
    ...base("hermes"),
    url: Url,
    tokenEnv: EnvName.optional(),
    /** A Hermes profile; its API is under /p/<profile>. Empty for the default profile. */
    profile: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,64}$/)
      .optional(),
    pollSeconds: z.number().min(0.2).max(30).default(1),
  })
  .strict();

export type HermesConfig = z.output<typeof schema>;

const DONE = new Set(["completed", "failed", "cancelled", "interrupted"]);
const MAX_POLL_FAILURES = 5;

interface RunStatus {
  readonly run_id?: string;
  readonly status?: string;
  readonly output?: string;
  readonly error?: string | { readonly message?: string };
  readonly model?: string;
  readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number };
}

const errorText = (e: RunStatus["error"]): string =>
  typeof e === "string" ? e : (e?.message ?? "알 수 없는 오류");

const taskText = (prompt: string): string =>
  [
    prompt,
    "",
    "Terrarium의 툴(MCP 서버 'terrarium')만 이 세계를 보고 바꿀 수 있어요. 원인과 고장 종류를 찾은 뒤",
    "submit_diagnosis 툴을 한 번만 불러 답해요. 보기 전에 짐작하지 않아요.",
  ].join("\n");

export class HermesHarness implements HarnessPort {
  readonly info: HarnessInfo;
  private readonly rest: Rest;
  private readonly queue = new KeyedQueue();

  constructor(
    private readonly config: HermesConfig,
    token: string | undefined,
    fetchImpl: FetchLike,
  ) {
    this.info = {
      id: config.id,
      name: config.name,
      kind: "hermes",
      description: config.description || "Hermes Agent. 고정 툴 주소를 Hermes 설정에 적어 써요.",
      toolTransport: "mcp",
      telemetry: "none",
      mcpSlot: config.id,
    };
    const prefix = config.profile ? `/p/${encodeURIComponent(config.profile)}` : "";
    this.rest = new Rest(
      `${config.url.replace(/\/+$/, "")}${prefix}`,
      token ? { authorization: `Bearer ${token}` } : {},
      fetchImpl,
    );
  }

  async agents(): Promise<readonly AgentInfo[]> {
    const models = await this.rest
      .json<{ data?: ReadonlyArray<{ id?: string }> }>(
        "모델 목록",
        "GET",
        "/v1/models",
        AbortSignal.timeout(10_000),
      )
      .catch((err: unknown) => {
        // The address and the key have to be right; a missing model list is not an error.
        if (/에 (401|403)/.test((err as Error).message)) throw err;
        return undefined;
      });
    const model = models?.data?.find((m) => typeof m.id === "string")?.id;
    const profile = this.config.profile;
    return [
      {
        id: profile ?? "default",
        name: profile ? `Hermes (${profile})` : "Hermes Agent",
        description: profile
          ? `Hermes 프로필 '${profile}'.`
          : "Hermes의 기본 프로필. 다른 프로필은 연결을 따로 만들어요.",
        ...(model ? { model } : {}),
      },
    ];
  }

  run(req: AgentRunRequest): Promise<AgentRunOutcome> {
    return this.queue.run("one", () => this.runOne(req));
  }

  private async runOne(req: AgentRunRequest): Promise<AgentRunOutcome> {
    const used: { inputTokens: number; outputTokens: number; model?: string } = {
      inputTokens: 0,
      outputTokens: 0,
    };
    if (req.signal.aborted) return { status: "cancelled", harness: used };
    let runId: string | undefined;
    try {
      const started = await this.rest.json<{ run_id?: string }>(
        "실행 시작",
        "POST",
        "/v1/runs",
        req.signal,
        { input: taskText(req.prompt) },
        req.traceparent ? { traceparent: req.traceparent } : {},
      );
      runId = started?.run_id;
      if (!runId) throw new Error("Hermes가 실행 번호를 돌려주지 않았어요");
      const last = await this.untilDone(runId, req.signal, used);
      return this.outcome(last, used);
    } catch (err) {
      if (req.signal.aborted) {
        if (runId) await this.stop(runId);
        return { status: "cancelled", harness: used };
      }
      if (runId) await this.stop(runId);
      return { status: "error", message: (err as Error).message, harness: used };
    }
  }

  private async untilDone(
    runId: string,
    signal: AbortSignal,
    used: { inputTokens: number; outputTokens: number; model?: string },
  ): Promise<RunStatus> {
    let failures = 0;
    for (;;) {
      await sleep(this.config.pollSeconds * 1000, signal);
      if (signal.aborted) throw new Error("멈췄어요");
      let status: RunStatus;
      try {
        status = await this.rest.json<RunStatus>(
          "실행 상태",
          "GET",
          `/v1/runs/${encodeURIComponent(runId)}`,
          signal,
        );
        failures = 0;
      } catch (err) {
        if (signal.aborted || ++failures >= MAX_POLL_FAILURES) throw err;
        continue;
      }
      used.inputTokens = status.usage?.input_tokens ?? used.inputTokens;
      used.outputTokens = status.usage?.output_tokens ?? used.outputTokens;
      if (status.model) used.model = status.model;
      if (status.status === "waiting_for_approval")
        throw new Error(
          "Hermes가 사람의 승인을 기다리고 있어요. Hermes 설정에서 이 툴들은 승인 없이 쓰게 해 주세요",
        );
      if (status.status && DONE.has(status.status)) return status;
    }
  }

  private outcome(
    last: RunStatus,
    used: { inputTokens: number; outputTokens: number; model?: string },
  ): AgentRunOutcome {
    if (last.status === "completed") return { status: "finished", harness: used };
    if (last.status === "failed")
      return { status: "error", message: errorText(last.error), harness: used };
    return {
      status: "error",
      message: `Hermes가 실행을 ${last.status === "cancelled" ? "멈췄" : "중단했"}어요`,
      harness: used,
    };
  }

  /** Ask Hermes to stop; if it cannot (already over), that is fine. */
  private async stop(runId: string): Promise<void> {
    await this.rest
      .json(
        "실행 중지",
        "POST",
        `/v1/runs/${encodeURIComponent(runId)}/stop`,
        AbortSignal.timeout(10_000),
      )
      .catch(() => undefined);
  }
}

export const hermesConnector = defineConnector({
  spec: {
    kind: "hermes",
    label: "Hermes Agent",
    description:
      "Hermes Agent의 API 서버에 연결해요. 실행은 Hermes의 실행 API(시작, 상태, 중지)로 다루고, 툴은 이 연결의 고정 MCP 주소로 건네요.",
    scope: "harness",
    toolTransport: "mcp",
    toolGuide: [
      "Hermes는 툴을 요청마다 받지 않고 설정 파일의 mcp_servers에서만 읽어요. 이 연결이 만든 고정 주소를 Hermes의 config.yaml에 한 번 적어 두세요: mcp_servers → terrarium → url.",
      "이 주소는 실험이 돌 때만 그 실행의 세계로 이어지고, 평소에는 툴 목록만 보여 줘요.",
      "고정 주소는 한 번에 한 실행만 뜻할 수 있어서, 이 연결의 실험은 하나씩 차례로 돌아요. 동시에 많이 돌리려면 Hermes를 여러 개 두고 연결을 따로 만드세요.",
      "Hermes 쪽에서 API 서버를 켜고(API_SERVER_KEY) 이 툴들을 승인 없이 쓰게 해 두어야 해요.",
    ],
    fromScreen: true,
    fields: [
      {
        key: "url",
        label: "Hermes API 서버 주소",
        type: "url",
        required: true,
        placeholder: "http://127.0.0.1:8642",
      },
      ...credentialFields("token", "API 키", "API_SERVER_KEY"),
      {
        key: "profile",
        label: "프로필",
        type: "text",
        advanced: true,
        help: "비워 두면 기본 프로필. 다른 프로필의 API는 /p/<프로필> 아래에 있어요.",
      },
      {
        key: "pollSeconds",
        label: "상태를 보는 간격(초)",
        type: "number",
        default: 1,
        advanced: true,
      },
    ],
  },
  schema,
  connect: (config, ctx) =>
    new HermesHarness(config, credential(ctx, "token", config.tokenEnv), ctx.fetch),
});
