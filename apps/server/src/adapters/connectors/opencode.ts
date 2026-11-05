/**
 * An OpenCode server (`opencode serve`), reached through its HTTP API (REQ-051, ADR-0042). Its agents are
 * the agents; a run is a session that is given the task and asked about until it is idle again. Terrarium's
 * tools are added to the server as a remote MCP server named for the run (`POST /mcp`), which is the way
 * the server documents for adding one.
 *
 * Run against a real `opencode serve` 1.19.5 (docs/design-docs/harness-e2e.md): every call below worked as
 * written, with the two fixes noted at `detach` and in `agents`. Read from OpenCode's server page: `GET /agent`, `POST /session`, `POST /session/:id/prompt_async`,
 * `GET /session/status`, `POST /session/:id/abort`, `POST /mcp` with `{ name, config }`, basic auth from
 * OPENCODE_SERVER_PASSWORD. The shapes of a message part, of the model, of an MCP config and of the
 * messages that come back are from memory of OpenCode's SDK, not from a page that was read.
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
import { sleep, snippet } from "./util";

const MAX_POLL_FAILURES = 5;
/** Polls with no sign of work before an idle session counts as finished (it may have failed before it began). */
const IDLE_POLLS = 3;

const schema = z
  .object({
    ...base("opencode"),
    url: Url,
    username: z.string().min(1).max(60).default("opencode"),
    passwordEnv: EnvName.optional(),
    /** `provider/model`, e.g. `anthropic/claude-sonnet-4`. Left out, the agent's own model is used. */
    model: z
      .string()
      .regex(/^[^/\s]+\/\S+$/, "provider/model 모양이어야 해요")
      .optional(),
    pollSeconds: z.number().min(0.05).max(60).default(2),
  })
  .strict();

export type OpenCodeConfig = z.output<typeof schema>;

interface AgentEntry {
  readonly name?: string;
  readonly description?: string;
  readonly mode?: string;
  /** OpenCode's own helper agents (title, summary, compaction) are marked hidden. */
  readonly hidden?: boolean;
}
interface MessageEntry {
  readonly info?: {
    readonly role?: string;
    readonly providerID?: string;
    readonly modelID?: string;
    readonly cost?: number;
    readonly tokens?: { readonly input?: number; readonly output?: number };
    readonly error?: { readonly name?: string; readonly data?: { readonly message?: string } };
  };
  readonly parts?: ReadonlyArray<{ readonly type?: string; readonly text?: string }>;
}

export class OpenCodeHarness implements HarnessPort {
  readonly info: HarnessInfo;
  private readonly rest: Rest;

  constructor(
    private readonly config: OpenCodeConfig,
    password: string | undefined,
    fetchImpl: FetchLike,
  ) {
    this.info = {
      id: config.id,
      name: config.name,
      kind: "opencode",
      description: config.description || "OpenCode 서버. 서버의 에이전트를 고를 수 있어요.",
      toolTransport: "mcp",
      telemetry: "none",
    };
    const basic = Buffer.from(`${config.username}:${password}`).toString("base64");
    this.rest = new Rest(
      config.url,
      password ? { authorization: `Basic ${basic}` } : {},
      fetchImpl,
    );
  }

  async agents(): Promise<readonly AgentInfo[]> {
    const list = await this.rest.json<AgentEntry[]>(
      "에이전트 목록",
      "GET",
      "/agent",
      AbortSignal.timeout(10_000),
    );
    return list
      .filter((a): a is AgentEntry & { name: string } => typeof a.name === "string")
      .filter((a) => a.mode !== "subagent" && a.hidden !== true)
      .map((a) => ({
        id: a.name,
        name: a.name,
        ...(a.description ? { description: a.description } : {}),
        ...(this.config.model ? { model: this.config.model } : {}),
        ...(a.mode ? { facts: { mode: a.mode } } : {}),
      }));
  }

  async run(req: AgentRunRequest): Promise<AgentRunOutcome> {
    const wall = AbortSignal.any([
      req.signal,
      AbortSignal.timeout(req.limits.timeLimitSeconds * 1000 + 60_000),
    ]);
    const t0 = performance.now();
    let session: string | undefined;
    const server = `terrarium-${req.runId}`;
    let added = false;
    try {
      if (!req.tools.mcpUrl)
        return { status: "error", message: "이 실행에는 MCP 엔드포인트가 없어요" };
      added = true;
      await this.rest.json("툴 서버 더하기", "POST", "/mcp", wall, {
        name: server,
        config: { type: "remote", url: req.tools.mcpUrl, enabled: true },
      });
      const made = await this.rest.json<{ id: string }>("세션 만들기", "POST", "/session", wall, {
        title: `terrarium ${req.runId}`,
      });
      session = made.id;
      await this.rest.json(
        "과제 보내기",
        "POST",
        `/session/${encodeURIComponent(session)}/prompt_async`,
        wall,
        {
          agent: req.agentId,
          ...(this.config.model ? { model: modelOf(this.config.model) } : {}),
          parts: [{ type: "text", text: req.prompt }],
        },
      );
      await this.untilIdle(session, wall);
      if (wall.aborted) throw new Error("멈췄어요");
      return await this.outcome(session, wall, t0);
    } catch (err) {
      if (wall.aborted && session) await this.abort(session);
      if (req.signal.aborted) return { status: "cancelled" };
      return {
        status: "error",
        message: `OpenCode 서버에 연결하지 못했어요: ${(err as Error).message}`,
      };
    } finally {
      if (added) await this.detach(server);
    }
  }

  /**
   * The server keeps a remote MCP server after the run, and offers its (now dead) tools to every later
   * session. Seen against opencode 1.19.5: the second run saw both runs' tools and called the first run's.
   */
  private async detach(server: string): Promise<void> {
    await this.rest
      .send("POST", `/mcp/${encodeURIComponent(server)}/disconnect`, AbortSignal.timeout(10_000))
      .catch(() => undefined);
  }

  /** Ask for the sessions' states until this one has worked and is idle again. */
  private async untilIdle(session: string, wall: AbortSignal): Promise<void> {
    let failures = 0;
    let seenBusy = false;
    let idle = 0;
    while (!wall.aborted) {
      await sleep(this.config.pollSeconds * 1000, wall);
      if (wall.aborted) return;
      try {
        const all = await this.rest.json<Record<string, { type?: string }>>(
          "세션 상태",
          "GET",
          "/session/status",
          wall,
        );
        failures = 0;
        const busy = all[session]?.type !== undefined && all[session]?.type !== "idle";
        seenBusy ||= busy;
        idle = busy ? 0 : idle + 1;
        if (!busy && (seenBusy || idle >= IDLE_POLLS)) return;
      } catch (err) {
        if (wall.aborted) return;
        if (++failures >= MAX_POLL_FAILURES)
          throw new Error(
            `세션 상태를 ${failures}번 연달아 못 읽었어요: ${(err as Error).message}`,
          );
      }
    }
  }

  private async outcome(session: string, wall: AbortSignal, t0: number): Promise<AgentRunOutcome> {
    const messages = await this.rest.json<MessageEntry[]>(
      "메시지 읽기",
      "GET",
      `/session/${encodeURIComponent(session)}/message`,
      wall,
    );
    const replies = messages.filter((m) => m.info?.role === "assistant");
    const answered = replies.findLast((m) => m.info?.modelID);
    const harness = {
      wallSeconds: (performance.now() - t0) / 1000,
      ...(answered
        ? { model: [answered.info?.providerID, answered.info?.modelID].filter(Boolean).join("/") }
        : {}),
      inputTokens: replies.reduce((n, m) => n + (m.info?.tokens?.input ?? 0), 0),
      outputTokens: replies.reduce((n, m) => n + (m.info?.tokens?.output ?? 0), 0),
      costUsd: replies.reduce((n, m) => n + (m.info?.cost ?? 0), 0),
    };
    const failed = replies.map((m) => m.info?.error).findLast((e) => e !== undefined);
    if (failed)
      return {
        status: "error",
        message: `OpenCode 에이전트가 오류로 멈췄어요: ${failed.data?.message ?? failed.name ?? "이유 모름"}`,
        harness,
      };
    const last = replies.at(-1)?.parts?.findLast((p) => p.type === "text")?.text;
    return { status: "finished", ...(last ? { message: snippet(last) } : {}), harness };
  }

  private async abort(session: string): Promise<void> {
    await this.rest
      .send("POST", `/session/${encodeURIComponent(session)}/abort`, AbortSignal.timeout(10_000))
      .catch(() => undefined);
  }
}

const modelOf = (model: string) => {
  const [providerID, ...rest] = model.split("/");
  return { providerID, modelID: rest.join("/") };
};

export const openCodeConnector = defineConnector({
  spec: {
    kind: "opencode",
    label: "OpenCode (opencode serve)",
    description:
      "OpenCode 서버에 연결해요. 서버의 에이전트가 목록에 나오고, 테라리움 툴은 실행마다 MCP 서버로 서버에 더해져요. 같은 서버에서 사람이 쓰는 세션과 섞이지 않도록 실험용 서버를 따로 띄우는 편이 나아요.",
    scope: "harness",
    toolTransport: "mcp",
    toolGuide: [
      "테라리움이 실행마다 'terrarium-<실행 id>' 라는 원격 MCP 서버를 OpenCode에 자동으로 붙여요. 사람이 설정할 것은 없어요.",
      "실행하는 에이전트가 MCP 툴을 쓸 수 있게 허용되어 있어야 해요(툴 권한을 막아 둔 에이전트는 툴을 못 불러요).",
      "OpenCode 서버가 테라리움 서버 주소에 연결할 수 있어야 해요. 테라리움 주소가 localhost이면 서버 설정의 publicUrl 을 바꿔 주세요.",
    ],
    fromScreen: true,
    fields: [
      {
        key: "url",
        label: "서버 주소",
        type: "url",
        required: true,
        placeholder: "http://127.0.0.1:4096",
        help: "`opencode serve`의 기본 포트는 4096이에요.",
      },
      { key: "username", label: "사용자 이름", type: "text", default: "opencode" },
      ...credentialFields("password", "비밀번호", "OPENCODE_SERVER_PASSWORD"),
      {
        key: "model",
        label: "모델",
        type: "text",
        placeholder: "anthropic/claude-sonnet-4",
        help: "provider/model 모양. 비워 두면 에이전트에 정해진 모델을 써요.",
      },
      { key: "pollSeconds", label: "상태를 묻는 간격(초)", type: "number", default: 2 },
    ],
  },
  schema,
  connect: (config, ctx) =>
    new OpenCodeHarness(config, credential(ctx, "password", config.passwordEnv), ctx.fetch),
});
