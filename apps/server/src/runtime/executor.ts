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

import type { ActivityEvent, ActivityWho, ExperimentEvent } from "@terrarium/core/contract";
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
import { stampReal } from "@terrarium/core/session";
import { callEffect, callTargets } from "@terrarium/core/tools";
import type { BlueprintCache } from "./blueprint-cache";
import type { HarnessDirectory } from "./context";
import type { RunLogs } from "./events";
import type { HostedSession, SessionHost } from "./hosts";
import type { Stamps } from "./ids";

/** Makes a run's tools reachable over MCP for harnesses that call tools that way. */
export interface ToolGateway {
  open(
    runId: string,
    endpoint: Pick<ToolEndpoint, "specs" | "call">,
    /** The harness's fixed tool address, when it has one: it serves this run's tools meanwhile. */
    slot?: string,
  ): { readonly url: string; close(): void };
  /** The fixed address of a slot, for the screen to show. */
  slotUrl?(slot: string): string;
}

export interface ExecutorDeps {
  readonly store: ExperimentStore;
  readonly harnesses: HarnessDirectory;
  readonly host: SessionHost;
  readonly stamps: Stamps;
  readonly gateway?: ToolGateway;
  /** The record of the runs going now, for the live topology view (REQ-083). */
  readonly logs?: RunLogs;
  /** World versions read lately; without it every run reads its own. */
  readonly blueprints?: BlueprintCache;
  readonly emit: (experimentId: string, event: ExperimentEvent) => void;
  /** Who works where, for the live view of a world (REQ-050). */
  readonly activity?: (worldId: string, event: ActivityEvent) => void;
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
  const { worldId } = e.recipe;
  const digest = e.snapshot.worldDigest;
  const read = () => deps.store.worldVersion(worldId, digest);
  const key = `${worldId}@${digest}`;
  const blueprint = await (deps.blueprints ? deps.blueprints.get(key, read) : read());
  const scenario = await deps.store.scenarioVersion(e.recipe.scenarioId, e.snapshot.scenarioDigest);
  if (!blueprint) throw new Error("실험이 가리키는 세계 버전을 찾을 수 없어요");
  if (!scenario) throw new Error("실험이 가리키는 시나리오 버전을 찾을 수 없어요");
  return { blueprint, scenario, world: { key, digest } };
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
  hasAdapter: boolean,
): HarnessRunInfo {
  const traced = hasAdapter || harness.info.telemetry === "clickstack";
  const traceId = traced ? traceparent.split("-")[1] : undefined;
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
    const { blueprint, scenario, world } = await versions(deps, experiment);
    return await deps.host.open({
      blueprint,
      world,
      scenario,
      tools: experiment.recipe.tools,
      seed: run.seed,
      time: experiment.recipe.time,
      profiles: experiment.recipe.profiles,
      ...(experiment.recipe.domains ? { domains: experiment.recipe.domains } : {}),
      ...(experiment.recipe.leadTimes ? { leadTimes: experiment.recipe.leadTimes } : {}),
    });
  } catch (err) {
    return `세션을 열 수 없어요: ${(err as Error).message}`;
  }
}

/** How long to wait for a harness to name its agent before the run shows under the agent's id. */
const WHO_WAIT_MS = 1000;

/** Experiment, harness, agent and model of a run, as the live view of a world names them. */
export async function whoIs(experiment: Experiment, harness: HarnessPort): Promise<ActivityWho> {
  const { agentId } = experiment.recipe;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wait = new Promise<readonly []>((resolve) => {
    timer = setTimeout(() => resolve([]), WHO_WAIT_MS);
  });
  const listed = Promise.resolve()
    .then(() => harness.agents())
    .catch(() => []);
  const agents = await Promise.race([listed, wait]);
  clearTimeout(timer);
  const agent = agents.find((a) => a.id === agentId);
  return {
    experimentId: experiment.id,
    experiment: experiment.name,
    owner: experiment.owner,
    harness: harness.info.name,
    agent: agent?.name ?? agentId,
    ...(agent?.model ? { model: agent.model } : {}),
  };
}

/** The run's tools as the harness reaches them; every call is also announced live. */
function endpointFor(deps: ExecutorDeps, run: RunRecord, session: HostedSession, worldId: string) {
  const counter = { calls: 0 };
  const endpoint = {
    specs: session.specs,
    call: async (name: string, args: Record<string, unknown>): Promise<ToolCallOutcome> => {
      const r = await session.call(name, args);
      counter.calls++;
      const fresh = session.eventsSince?.(deps.logs?.count(run.id) ?? 0) ?? [];
      deps.logs?.record(run.id, fresh, { t: r.t, tool: name, real: deps.stamps.now() });
      for (const event of fresh) {
        if (event.kind !== "counterpart" || event.what === "handed") continue;
        deps.activity?.(worldId, {
          type: "partner",
          runId: run.id,
          t: event.t,
          handoff: event.handoff,
          device: event.fault.target,
          what: event.what,
          team: event.team,
          who: event.fault.who,
          replacing: event.fault.kind === "replace",
          onSite: event.fault.onSite,
        });
      }
      const effect = callEffect(name, args);
      const targets = callTargets(name, args);
      deps.emit(run.experimentId, {
        type: "call",
        runId: run.id,
        t: r.t,
        tool: name,
        args,
        ok: r.ok,
        ...(r.error ? { error: r.error } : {}),
        effect,
        targets,
      });
      deps.activity?.(worldId, {
        type: "call",
        runId: run.id,
        t: r.t,
        tool: name,
        args,
        ok: r.ok,
        effect,
        targets,
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
  if (e.stopped === "shutdown") return failWith("서버가 멈춰 실행이 중단됐어요");
  if (e.outcome.status === "error" && e.calls === 0 && !e.session.endedBy)
    return failWith(`에이전트가 시작하지 못했어요: ${e.outcome.message ?? "원인 미상"}`);
  const finished = await e.session.finish(endReasonOf(e.session, e.outcome, e.timedOut));
  const calls = deps.logs?.callsOf(e.run.id) ?? [];
  const result = finished.events
    ? { ...finished, events: stampReal(finished.events, calls, e.run.startedAt) }
    : finished;
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
  if (!harness) return fail(`하네스 '${experiment.recipe.harnessId}'가 지금 설정에 없어요`);
  const who = whoIs(experiment, harness);
  const session = await openSession(deps, run, experiment);
  if (typeof session === "string") return fail(session);
  const worldId = experiment.recipe.worldId;
  deps.logs?.open(run.id, run.startedAt);
  deps.logs?.record(run.id, session.eventsSince?.(0) ?? []);
  deps.activity?.(worldId, { type: "start", runId: run.id, who: await who });
  const { endpoint, counter } = endpointFor(deps, run, session, worldId);
  const exposed =
    harness.info.toolTransport === "mcp"
      ? deps.gateway?.open(run.id, endpoint, harness.info.mcpSlot)
      : undefined;
  // Where this connection's traces pile up decides what the harness is asked to carry (ADR-0085).
  const attachment = deps.harnesses
    .telemetryOf?.(experiment.recipe.harnessId)
    ?.attach({ runId: run.id });
  const traceparent = attachment?.traceparent ?? newTraceparent();
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
        ...(attachment ? { telemetry: attachment } : {}),
      })
      .catch(
        (err: unknown): AgentRunOutcome => ({ status: "error", message: (err as Error).message }),
      );
    return await conclude(deps, {
      run,
      session,
      outcome,
      info: harnessInfo(harness, outcome, traceparent, attachment !== undefined),
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
    deps.logs?.close(run.id);
    deps.activity?.(worldId, { type: "end", runId: run.id });
  }
}
