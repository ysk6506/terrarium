/**
 * An agent that speaks A2A, the Agent2Agent protocol (REQ-051, ADR-0042). The agent card says what the
 * agent is and where it listens; a run is one message with the task and the address of that run's tools,
 * then the task is asked about until it ends. A2A has no standard way to hand over tools, so the address of
 * the MCP endpoint travels in the message, as a sentence and as data, for the agent to use.
 *
 * Both wire versions are spoken: 1.0 (SendMessage, supportedInterfaces, ROLE_USER, TASK_STATE_*) and 0.3
 * (message/send, a `kind` on every part, lowercase states). Which one is read from the card.
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
import { defineConnector } from "./types";
import { joinUrl, sleep, snippet } from "./util";

const schema = z
  .object({
    ...base("a2a"),
    /** The agent's address; the agent card is read from /.well-known/agent-card.json under it. */
    url: Url,
    tokenEnv: EnvName.optional(),
    agentId: z.string().min(1).max(64).optional(),
    protocolVersion: z.enum(["auto", "0.3", "1.0"]).default("auto"),
    pollSeconds: z.number().min(0.05).max(60).default(2),
  })
  .strict();

export type A2aConfig = z.output<typeof schema>;

type Version = "0.3" | "1.0";
interface Wire {
  readonly version: Version;
  readonly url: string;
}
interface Card {
  readonly name?: string;
  readonly description?: string;
  readonly version?: string;
  readonly url?: string;
  readonly protocolVersion?: string;
  readonly supportedInterfaces?: ReadonlyArray<{
    readonly url?: string;
    readonly protocolBinding?: string;
    readonly protocolVersion?: string;
  }>;
}

const METHODS = {
  "1.0": { send: "SendMessage", get: "GetTask", cancel: "CancelTask" },
  "0.3": { send: "message/send", get: "tasks/get", cancel: "tasks/cancel" },
} as const;

const MAX_POLL_FAILURES = 5;
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

/** How to speak to the agent, from its card. The first JSON-RPC interface wins; an old card has one address. */
export function wireOf(card: Card, forced: A2aConfig["protocolVersion"]): Wire {
  const rpc = card.supportedInterfaces?.find((i) => i.protocolBinding === "JSONRPC" && i.url);
  if (card.supportedInterfaces?.length && !rpc)
    throw new Error("에이전트 카드에 JSON-RPC로 말하는 인터페이스가 없어요");
  const url = rpc?.url ?? card.url;
  if (!url) throw new Error("에이전트 카드에 주소가 없어요");
  const said = rpc?.protocolVersion ?? card.protocolVersion ?? (rpc ? "1.0" : "0.3");
  const version: Version = forced !== "auto" ? forced : said.startsWith("0.") ? "0.3" : "1.0";
  return { version, url };
}

/** The state of a task as one lowercase word, whichever version said it ("TASK_STATE_INPUT_REQUIRED" → "input-required"). */
export const stateOf = (state: unknown) =>
  String(state ?? "")
    .replace(/^TASK_STATE_/, "")
    .toLowerCase()
    .replace(/_/g, "-");

interface Part {
  readonly text?: string;
}
const textOf = (parts: readonly Part[] | undefined) =>
  (parts ?? [])
    .map((p) => p.text)
    .filter((t): t is string => typeof t === "string")
    .join(" ");

interface TaskLike {
  readonly id?: string;
  readonly status?: { readonly state?: unknown; readonly message?: { readonly parts?: Part[] } };
  readonly artifacts?: ReadonlyArray<{ readonly parts?: Part[] }>;
  readonly parts?: Part[];
}

/** What a reply is: a task to follow, or a message that is the whole answer. */
function replyOf(result: unknown): { task?: TaskLike; message?: string } {
  const r = result as { task?: TaskLike; message?: TaskLike } | TaskLike | undefined;
  const wrapped = r as { task?: TaskLike; message?: TaskLike } | undefined;
  const item = wrapped?.task ?? wrapped?.message ?? (r as TaskLike | undefined);
  if (item?.status?.state !== undefined) return { task: item };
  return { message: textOf(item?.parts) };
}

/** What an ended task has to say: its closing note, or else the first thing it produced. */
const summaryOf = (task: TaskLike) =>
  snippet(
    textOf(task.status?.message?.parts) ||
      (task.artifacts ?? []).map((a) => textOf(a.parts)).find(Boolean) ||
      "",
  );

export class A2aAgent implements HarnessPort {
  readonly info: HarnessInfo;
  private rpcId = 0;

  constructor(
    private readonly config: A2aConfig,
    private readonly token: string | undefined,
    private readonly fetchImpl: FetchLike,
  ) {
    this.info = {
      id: config.id,
      name: config.name,
      kind: "a2a",
      description: config.description || "A2A로 연결된 에이전트.",
      toolTransport: "mcp",
      telemetry: "none",
    };
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      accept: "application/json",
      ...extra,
      ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
    };
  }

  private async card(signal: AbortSignal): Promise<Card> {
    const given = this.config.url;
    const tries = given.endsWith(".json")
      ? [given]
      : [joinUrl(given, ".well-known/agent-card.json"), joinUrl(given, ".well-known/agent.json")];
    let last = "";
    for (const url of tries) {
      const r = await this.fetchImpl(url, { method: "GET", headers: this.headers(), signal });
      if (r.ok) return (await r.json()) as Card;
      last = `${url}가 ${r.status}로 답했어요`;
    }
    throw new Error(`에이전트 카드를 읽지 못했어요: ${last}`);
  }

  async agents(): Promise<readonly AgentInfo[]> {
    const card = await this.card(AbortSignal.timeout(10_000));
    const wire = wireOf(card, this.config.protocolVersion);
    const name = card.name ?? this.config.name;
    return [
      {
        id: this.config.agentId ?? (slug(name) || "agent"),
        name,
        ...(card.description ? { description: card.description } : {}),
        facts: {
          ...(card.version ? { agentVersion: card.version } : {}),
          protocol: wire.version,
        },
      },
    ];
  }

  private async rpc(
    wire: Wire,
    method: string,
    params: object,
    signal: AbortSignal,
  ): Promise<unknown> {
    const r = await this.fetchImpl(wire.url, {
      method: "POST",
      headers: this.headers({
        "content-type": "application/json",
        ...(wire.version === "1.0" ? { "a2a-version": "1.0" } : {}),
      }),
      body: JSON.stringify({ jsonrpc: "2.0", id: ++this.rpcId, method, params }),
      signal,
    });
    if (!r.ok) throw new Error(`${method}에 ${r.status}로 답했어요`);
    const body = (await r.json()) as { result?: unknown; error?: { message?: string } };
    if (body.error) throw new Error(body.error.message ?? `${method} 오류`);
    return body.result;
  }

  private message(wire: Wire, req: AgentRunRequest): object {
    const mcp = req.tools.mcpUrl ?? "";
    const text = `${req.prompt}\n\nTools: use the MCP server at ${mcp} for everything you look at or change, and finish by calling submit_diagnosis. 툴은 MCP 서버(${mcp})로 써요.`;
    const data = {
      terrarium: {
        runId: req.runId,
        mcpUrl: mcp,
        tools: req.tools.specs.map((s) => s.name),
        limits: req.limits,
        seed: req.seed,
        ...(req.traceparent ? { traceparent: req.traceparent } : {}),
      },
    };
    return wire.version === "1.0"
      ? {
          message: {
            messageId: req.runId,
            role: "ROLE_USER",
            parts: [{ text }, { data }],
          },
          configuration: { returnImmediately: true },
        }
      : {
          message: {
            kind: "message",
            messageId: req.runId,
            role: "user",
            parts: [
              { kind: "text", text },
              { kind: "data", data },
            ],
          },
          configuration: { blocking: false },
        };
  }

  async run(req: AgentRunRequest): Promise<AgentRunOutcome> {
    const wall = AbortSignal.any([
      req.signal,
      AbortSignal.timeout(req.limits.timeLimitSeconds * 1000 + 60_000),
    ]);
    const t0 = performance.now();
    const seconds = () => ({ wallSeconds: (performance.now() - t0) / 1000 });
    let wire: Wire | undefined;
    let taskId: string | undefined;
    try {
      wire = wireOf(await this.card(wall), this.config.protocolVersion);
      const m = METHODS[wire.version];
      const first = replyOf(await this.rpc(wire, m.send, this.message(wire, req), wall));
      if (!first.task)
        return {
          status: "finished",
          harness: { ...seconds(), message: snippet(first.message ?? "") },
        };
      taskId = first.task.id;
      if (!taskId) return { status: "error", message: "에이전트가 과제 id를 주지 않았어요" };
      return await this.follow(wire, taskId, first.task, wall, req.signal, seconds);
    } catch (err) {
      if (wire && taskId) await this.stop(wire, taskId);
      if (req.signal.aborted) return { status: "cancelled" };
      return {
        status: "error",
        message: `A2A 에이전트에 연결하지 못했어요: ${(err as Error).message}`,
      };
    }
  }

  /** Ask about the task until it ends. */
  private async follow(
    wire: Wire,
    id: string,
    first: TaskLike,
    wall: AbortSignal,
    asked: AbortSignal,
    seconds: () => object,
  ): Promise<AgentRunOutcome> {
    const m = METHODS[wire.version];
    let task = first;
    let failures = 0;
    for (;;) {
      const verdict = this.ended(task, seconds);
      if (verdict) {
        if (verdict.status === "error" && stateOf(task.status?.state).endsWith("required"))
          await this.stop(wire, id);
        return verdict;
      }
      if (wall.aborted) break;
      await sleep(this.config.pollSeconds * 1000, wall);
      if (wall.aborted) break;
      try {
        const got = replyOf(await this.rpc(wire, m.get, { id }, wall));
        if (got.task) task = got.task;
        failures = 0;
      } catch (err) {
        if (wall.aborted) break;
        if (++failures >= MAX_POLL_FAILURES)
          return {
            status: "error",
            message: `과제 상태를 ${failures}번 연달아 못 읽었어요: ${(err as Error).message}`,
          };
      }
    }
    await this.stop(wire, id);
    return asked.aborted
      ? { status: "cancelled" }
      : { status: "error", message: "시간이 다 됐어요" };
  }

  /** What a task's state means for the run, or nothing while it is still going. */
  private ended(task: TaskLike, seconds: () => object): AgentRunOutcome | undefined {
    const state = stateOf(task.status?.state);
    const harness = { ...seconds(), message: summaryOf(task) };
    switch (state) {
      case "completed":
        return { status: "finished", harness };
      case "failed":
        return { status: "error", message: `에이전트가 실패했어요: ${harness.message}`, harness };
      case "rejected":
        return { status: "error", message: "에이전트가 과제를 거절했어요", harness };
      case "canceled":
      case "cancelled":
        return { status: "cancelled" };
      case "input-required":
      case "auth-required":
        return {
          status: "error",
          message: `에이전트가 ${state === "auth-required" ? "인증" : "사람의 입력"}을 요구하며 멈췄어요. 실험에서는 답해 줄 사람이 없어요`,
          harness,
        };
      default:
        return undefined;
    }
  }

  private async stop(wire: Wire, id: string): Promise<void> {
    await this.rpc(wire, METHODS[wire.version].cancel, { id }, AbortSignal.timeout(10_000)).catch(
      () => undefined,
    );
  }
}

export const a2aConnector = defineConnector({
  spec: {
    kind: "a2a",
    label: "A2A 에이전트",
    description:
      "A2A(Agent2Agent) 프로토콜로 말하는 에이전트 하나를 등록해요. 에이전트 카드에서 이름과 주소를 읽어요. 규격 0.3과 1.0을 모두 받아요.",
    scope: "agent",
    toolTransport: "mcp",
    toolGuide: [
      "이 실행 전용 툴 주소를 메시지의 글과 데이터 부분에 함께 넣어 보내요. 에이전트는 그 주소의 MCP 서버를 툴로 쓰면 돼요.",
      "에이전트가 테라리움 서버 주소에 연결할 수 있어야 해요. 테라리움 주소가 localhost이면 서버 설정의 publicUrl 을 바꿔 주세요.",
    ],
    fromScreen: true,
    fields: [
      {
        key: "url",
        label: "에이전트 주소",
        type: "url",
        required: true,
        placeholder: "https://agent.internal",
        help: "에이전트 카드가 있는 곳의 기본 주소(/.well-known/agent-card.json 앞까지). 카드 파일 주소를 직접 써도 돼요.",
      },
      ...credentialFields("token", "토큰", "AGENT_TOKEN"),
      {
        key: "agentId",
        label: "에이전트 id",
        type: "text",
        help: "비워 두면 카드의 이름으로 만들어요.",
      },
      {
        key: "protocolVersion",
        label: "A2A 규격 버전",
        type: "select",
        default: "auto",
        options: [
          { value: "auto", label: "카드를 보고 정해요" },
          { value: "1.0", label: "1.0" },
          { value: "0.3", label: "0.3" },
        ],
      },
      { key: "pollSeconds", label: "상태를 묻는 간격(초)", type: "number", default: 2 },
    ],
  },
  schema,
  connect: (config, ctx) =>
    new A2aAgent(config, credential(ctx, "token", config.tokenEnv), ctx.fetch),
});
