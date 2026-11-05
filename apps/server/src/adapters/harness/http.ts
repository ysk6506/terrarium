/**
 * Any harness that speaks the Terrarium harness protocol over HTTP (REQ-031, ADR-0042). Terrarium
 * asks it to start a run and gives it an MCP endpoint with exactly that run's tools; the harness runs
 * its agent however it likes and reports when it is done. A thin shim in front of an internal harness
 * is enough to put it on the leaderboard. Protocol: docs/design-docs/harness-protocol.md.
 */
import type {
  AgentInfo,
  AgentRunOutcome,
  AgentRunRequest,
  HarnessInfo,
  HarnessPort,
  HarnessRunInfo,
} from "@terrarium/core/experiments";
import type { HttpHarnessConfig } from "../connectors/harness-http";
import type { FetchLike } from "../fetch";

export const HARNESS_PROTOCOL = "terrarium.harness/1";

/** What a harness answers to GET /runs/:id. */
export interface RemoteRunStatus {
  readonly status: "running" | "finished" | "error" | "cancelled";
  readonly message?: string;
  readonly traceId?: string;
  readonly usage?: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly costUsd?: number;
  };
  readonly wallSeconds?: number;
}

const MAX_POLL_FAILURES = 5;
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    const stop = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", stop, { once: true });
  });

function harnessInfo(
  status: RemoteRunStatus | undefined,
  traceId: string | undefined,
): HarnessRunInfo {
  const u = status?.usage;
  return {
    ...(status?.traceId || traceId ? { traceId: status?.traceId ?? traceId } : {}),
    ...(u?.inputTokens !== undefined ? { inputTokens: u.inputTokens } : {}),
    ...(u?.outputTokens !== undefined ? { outputTokens: u.outputTokens } : {}),
    ...(u?.costUsd !== undefined ? { costUsd: u.costUsd } : {}),
    ...(status?.wallSeconds !== undefined ? { wallSeconds: status.wallSeconds } : {}),
    ...(status?.message ? { message: status.message } : {}),
  };
}

/** The trace id inside a W3C traceparent ("00-<trace>-<span>-01"). */
export const traceIdOf = (traceparent: string | undefined) => traceparent?.split("-")[1];

export class HttpHarness implements HarnessPort {
  readonly info: HarnessInfo;

  constructor(
    private readonly config: HttpHarnessConfig,
    private readonly token: string | undefined,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    this.info = {
      id: config.id,
      name: config.name,
      kind: "http",
      description: config.description || "테라리움 하네스 프로토콜로 연결된 외부 하네스.",
      toolTransport: "mcp",
      telemetry: config.telemetry,
    };
  }

  private url(path: string): string {
    return `${this.config.url.replace(/\/$/, "")}${path}`;
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
    return this.fetchImpl(this.url(path), {
      method,
      headers: {
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: signal ?? AbortSignal.timeout(15_000),
    });
  }

  async agents(): Promise<readonly AgentInfo[]> {
    const r = await this.request("GET", "/agents");
    if (!r.ok) throw new Error(`하네스가 에이전트 목록에 ${r.status}로 답했어요`);
    const body = (await r.json()) as { agents?: AgentInfo[] };
    return (body.agents ?? []).filter(
      (a) => typeof a.id === "string" && typeof a.name === "string",
    );
  }

  private async start(req: AgentRunRequest): Promise<string | undefined> {
    if (!req.tools.mcpUrl)
      return "이 하네스는 MCP로 툴을 쓰는데, 이 실행에 MCP 엔드포인트가 없어요";
    const r = await this.request("POST", "/runs", {
      protocol: HARNESS_PROTOCOL,
      runId: req.runId,
      agentId: req.agentId,
      seed: req.seed,
      prompt: req.prompt,
      limits: req.limits,
      tools: { mcpUrl: req.tools.mcpUrl, specs: req.tools.specs },
      ...(req.traceparent ? { traceparent: req.traceparent } : {}),
    });
    return r.ok
      ? undefined
      : `하네스가 실행 시작에 ${r.status}로 답했어요: ${(await r.text()).slice(0, 300)}`;
  }

  private async status(runId: string): Promise<RemoteRunStatus> {
    const r = await this.request("GET", `/runs/${encodeURIComponent(runId)}`);
    if (!r.ok) throw new Error(`상태 조회에 ${r.status}`);
    return (await r.json()) as RemoteRunStatus;
  }

  /** Ask the harness to stop, then collect what it reported (best effort). */
  private async stop(runId: string): Promise<RemoteRunStatus | undefined> {
    await this.request("DELETE", `/runs/${encodeURIComponent(runId)}`).catch(() => undefined);
    return this.status(runId).catch(() => undefined);
  }

  async run(req: AgentRunRequest): Promise<AgentRunOutcome> {
    const traceId = traceIdOf(req.traceparent);
    const refused = await this.start(req).catch(
      (err: Error) => `하네스에 연결할 수 없어요: ${err.message}`,
    );
    if (refused) return { status: "error", message: refused };
    let failures = 0;
    let last: RemoteRunStatus | undefined;
    while (!req.signal.aborted) {
      await sleep(this.config.pollSeconds * 1000, req.signal);
      if (req.signal.aborted) break;
      try {
        last = await this.status(req.runId);
        failures = 0;
      } catch (err) {
        if (++failures >= MAX_POLL_FAILURES)
          return {
            status: "error",
            message: `하네스에 연결할 수 없어요: ${(err as Error).message}`,
            harness: harnessInfo(last, traceId),
          };
        continue;
      }
      if (last.status !== "running")
        return {
          status: last.status,
          ...(last.message ? { message: last.message } : {}),
          harness: harnessInfo(last, traceId),
        };
    }
    const final = await this.stop(req.runId);
    return { status: "cancelled", harness: harnessInfo(final ?? last, traceId) };
  }
}
