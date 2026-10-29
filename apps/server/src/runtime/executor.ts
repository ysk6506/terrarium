/**
 * One run, start to finish (REQ-030, ADR-0027): open the session at the versions the experiment
 * recorded, hand the agent its task and tools through its harness, and score what it did.
 *
 * How a run ends:
 *   - the session ends (diagnosis, tool budget, time limit) → the harness gets a short grace period
 *     to report, then is stopped;
 *   - the harness says it is done → the session ends as "no diagnosis" if it had not already;
 *   - a person cancels → the run is cancelled, not scored;
 *   - the harness fails before the agent made a single call → the run failed (infrastructure,
 *     not scored); after that, an error is the agent's (scored as agent_error);
 *   - the agent takes longer than the wall-clock limit → scored as out of time.
 */

import type { ExperimentEvent } from "@terrarium/core/contract";
import {
  type AgentRunOutcome,
  applyRunEvent,
  type Experiment,
  type ExperimentStore,
  type HarnessPort,
  type HarnessRunInfo,
  type RunRecord,
  type ToolCallOutcome,
  type ToolEndpoint,
} from "@terrarium/core/experiments";
import { randomToken } from "@terrarium/core/kernel";
import type { EndReason } from "@terrarium/core/oracle";
import type { HostedSession, SessionHost } from "./hosts";
import type { Stamps } from "./ids";

/** Makes a run's tools reachable over MCP for harnesses that call tools that way. */
export interface ToolGateway {
  open(
    runId: string,
    endpoint: Pick<ToolEndpoint, "specs" | "call">,
  ): { readonly url: string; close(): void };
}

export interface ExecutorDeps {
  readonly store: ExperimentStore;
  readonly harnesses: ReadonlyMap<string, HarnessPort>;
  readonly host: SessionHost;
  readonly stamps: Stamps;
  readonly gateway?: ToolGateway;
  readonly emit: (experimentId: string, event: ExperimentEvent) => void;
  /** Wall-clock limit for one agent (default 30 minutes). */
  readonly wallLimitMs?: number;
  /** How long a harness may keep going after the session has ended (default 15 s). */
  readonly graceMs?: number;
}

/** Why a run was stopped from outside. */
export type StopReason = "cancelled" | "shutdown";

const DEFAULT_WALL_LIMIT_MS = 30 * 60_000;
const DEFAULT_GRACE_MS = 15_000;
const WATCH_MS = 200;

export function summaryOf(run: RunRecord) {
  return {
    id: run.id,
    index: run.index,
    seed: run.seed,
    status: run.status,
    queuedAt: run.queuedAt,
    ...(run.startedAt ? { startedAt: run.startedAt } : {}),
    ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
    score: run.result?.score.total ?? null,
    passed: run.result?.score.passed ?? false,
    ...(run.error ? { error: run.error } : {}),
  };
}

async function save(deps: ExecutorDeps, run: RunRecord): Promise<RunRecord> {
  await deps.store.putRun(run);
  deps.emit(run.experimentId, { type: "run", run: summaryOf(run) });
  return run;
}

/** W3C trace context for this run: the harness's spans join it in ClickStack. */
export const newTraceparent = () => `00-${randomToken(16)}-${randomToken(8)}-01`;

async function versions(deps: ExecutorDeps, e: Experiment) {
  const blueprint = await deps.store.worldVersion(e.recipe.worldId, e.snapshot.worldDigest);
  const scenario = await deps.store.scenarioVersion(e.recipe.scenarioId, e.snapshot.scenarioDigest);
  if (!blueprint) throw new Error("실험이 가리키는 세계 버전을 찾을 수 없다");
  if (!scenario) throw new Error("실험이 가리키는 시나리오 버전을 찾을 수 없다");
  return { blueprint, scenario };
}

interface Watch {
  readonly controller: AbortController;
  stop(): void;
  readonly timedOut: () => boolean;
}

/** Abort the harness when stopped from outside, at the wall limit, or a grace period after the session ended. */
function watch(deps: ExecutorDeps, session: HostedSession, outside: AbortSignal): Watch {
  const controller = new AbortController();
  let timedOut = false;
  let endedAt: number | undefined;
  const started = Date.now();
  const onOutside = () => controller.abort();
  outside.addEventListener("abort", onOutside, { once: true });
  const timer = setInterval(() => {
    const now = Date.now();
    if (session.endedBy !== undefined) endedAt ??= now;
    if (now - started > (deps.wallLimitMs ?? DEFAULT_WALL_LIMIT_MS)) timedOut = true;
    if (timedOut || (endedAt !== undefined && now - endedAt > (deps.graceMs ?? DEFAULT_GRACE_MS)))
      controller.abort();
  }, WATCH_MS);
  return {
    controller,
    timedOut: () => timedOut,
    stop: () => {
      clearInterval(timer);
      outside.removeEventListener("abort", onOutside);
    },
  };
}

function endReasonOf(
  session: HostedSession,
  outcome: AgentRunOutcome,
  timedOut: boolean,
): EndReason {
  if (session.endedBy) return session.endedBy;
  if (timedOut) return "time_limit";
  return outcome.status === "error" ? "agent_error" : "agent_finished";
}

function harnessInfo(
  harness: HarnessPort,
  outcome: AgentRunOutcome,
  traceparent: string,
): HarnessRunInfo {
  const traceId = harness.info.telemetry === "clickstack" ? traceparent.split("-")[1] : undefined;
  return {
    ...(traceId ? { traceId } : {}),
    ...outcome.harness,
    ...(outcome.message ? { message: outcome.message } : {}),
  };
}

async function openSession(
  deps: ExecutorDeps,
  run: RunRecord,
  experiment: Experiment,
): Promise<HostedSession | string> {
  try {
    const { blueprint, scenario } = await versions(deps, experiment);
    return await deps.host.open({
      blueprint,
      scenario,
      tools: experiment.recipe.tools,
      seed: run.seed,
      time: experiment.recipe.time,
      profiles: experiment.recipe.profiles,
    });
  } catch (err) {
    return `세션을 열 수 없다: ${(err as Error).message}`;
  }
}

/** The run's tools as the harness reaches them; every call is also announced live. */
function endpointFor(deps: ExecutorDeps, run: RunRecord, session: HostedSession) {
  const counter = { calls: 0 };
  const endpoint = {
    specs: session.specs,
    call: async (name: string, args: Record<string, unknown>): Promise<ToolCallOutcome> => {
      const r = await session.call(name, args);
      counter.calls++;
      deps.emit(run.experimentId, {
        type: "call",
        runId: run.id,
        t: r.t,
        tool: name,
        ok: r.ok,
        ...(r.error ? { error: r.error } : {}),
      });
      return r;
    },
  };
  return { endpoint, counter };
}

interface Ending {
  readonly run: RunRecord;
  readonly session: HostedSession;
  readonly outcome: AgentRunOutcome;
  readonly info: HarnessRunInfo;
  readonly calls: number;
  readonly timedOut: boolean;
  readonly stopped: StopReason | undefined;
}

/** Decide what the run was, from how it stopped (see the header). */
async function conclude(deps: ExecutorDeps, e: Ending): Promise<RunRecord> {
  const at = deps.stamps.now();
  if (e.stopped === "cancelled") {
    e.session.dispose();
    return save(deps, applyRunEvent(e.run, { type: "cancel", at }));
  }
  const failWith = (error: string) => {
    e.session.dispose();
    return save(deps, applyRunEvent(e.run, { type: "fail", at, error, harness: e.info }));
  };
  if (e.stopped === "shutdown") return failWith("서버가 멈춰 실행이 중단됐다");
  if (e.outcome.status === "error" && e.calls === 0 && !e.session.endedBy)
    return failWith(`에이전트가 시작하지 못했다: ${e.outcome.message ?? "원인 미상"}`);
  const result = await e.session.finish(endReasonOf(e.session, e.outcome, e.timedOut));
  e.session.dispose();
  return save(deps, applyRunEvent(e.run, { type: "complete", at, result, harness: e.info }));
}

export async function executeRun(
  deps: ExecutorDeps,
  queued: RunRecord,
  experiment: Experiment,
  outside: AbortSignal,
  stopReason: () => StopReason | undefined,
): Promise<RunRecord> {
  const run = await save(deps, applyRunEvent(queued, { type: "start", at: deps.stamps.now() }));
  const fail = (error: string) =>
    save(deps, applyRunEvent(run, { type: "fail", at: deps.stamps.now(), error }));
  const harness = deps.harnesses.get(experiment.recipe.harnessId);
  if (!harness) return fail(`하네스 '${experiment.recipe.harnessId}'가 지금 설정에 없다`);
  const session = await openSession(deps, run, experiment);
  if (typeof session === "string") return fail(session);
  const { endpoint, counter } = endpointFor(deps, run, session);
  const exposed =
    harness.info.toolTransport === "mcp" ? deps.gateway?.open(run.id, endpoint) : undefined;
  const traceparent = newTraceparent();
  const w = watch(deps, session, outside);
  try {
    const outcome = await harness
      .run({
        runId: run.id,
        seed: run.seed,
        agentId: experiment.recipe.agentId,
        prompt: session.task.prompt,
        limits: {
          maxToolCalls: session.task.maxToolCalls,
          timeLimitSeconds: session.task.timeLimitSeconds,
        },
        tools: { ...endpoint, ...(exposed ? { mcpUrl: exposed.url } : {}) },
        signal: w.controller.signal,
        traceparent,
      })
      .catch(
        (err: unknown): AgentRunOutcome => ({ status: "error", message: (err as Error).message }),
      );
    return await conclude(deps, {
      run,
      session,
      outcome,
      info: harnessInfo(harness, outcome, traceparent),
      calls: counter.calls,
      timedOut: w.timedOut(),
      stopped: stopReason(),
    });
  } catch (err) {
    session.dispose();
    return fail(`실행 중 오류: ${(err as Error).message}`);
  } finally {
    w.stop();
    exposed?.close();
  }
}
