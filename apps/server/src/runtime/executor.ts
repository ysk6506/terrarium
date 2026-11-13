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

import type { ActivityWho } from "@terrarium/core/contract";
import {
  type AgentRunOutcome,
  type AgentRunRequest,
  applyRunEvent,
  type Experiment,
  type HarnessPort,
  type HarnessRunInfo,
  OPERATION_SCENARIO_ID,
  type RunRecord,
  type TelemetryAttachment,
} from "@terrarium/core/experiments";
import { randomToken } from "@terrarium/core/kernel";
import type { EndReason } from "@terrarium/core/oracle";
import { operationScenario, stampReal } from "@terrarium/core/session";
import {
  keepJournal,
  type LinkDraft,
  operationOf,
  RESUME_NOTE,
  type Resume,
  resumeOf,
  runAgent,
  type Waiter,
  withLinks,
} from "./executor-operation";
import {
  DEFAULT_WALL_LIMIT_MS,
  type ExecutorDeps,
  endpointFor,
  OPERATION_SLACK_MS,
  type Pace,
  type StopReason,
  type Watch,
  watch,
} from "./executor-parts";
import type { HostedSession } from "./hosts";

export type { ExecutorDeps, StopReason, ToolGateway } from "./executor-parts";

export function summaryOf(run: RunRecord) {
  return {
    id: run.id,
    index: run.index,
    seed: run.seed,
    repeat: run.repeat,
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
  const { operation } = e.recipe;
  const scenario = operation
    ? operationScenario(OPERATION_SCENARIO_ID, worldId, operation)
    : await deps.store.scenarioVersion(e.recipe.scenarioId, e.snapshot.scenarioDigest);
  if (!blueprint) throw new Error("실험이 가리키는 세계 버전을 찾을 수 없어요");
  if (!scenario) throw new Error("실험이 가리키는 시나리오 버전을 찾을 수 없어요");
  return { blueprint, scenario, world: { key, digest } };
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
  resume?: Resume,
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
      ...(experiment.recipe.escalation ? { escalation: experiment.recipe.escalation } : {}),
      ...(experiment.recipe.faultScope ? { faultScope: experiment.recipe.faultScope } : {}),
      ...(experiment.recipe.sop ? { sop: experiment.recipe.sop } : {}),
      ...(experiment.recipe.domains ? { domains: experiment.recipe.domains } : {}),
      ...(experiment.recipe.leadTimes ? { leadTimes: experiment.recipe.leadTimes } : {}),
      ...(experiment.recipe.operation ? { operation: experiment.recipe.operation } : {}),
      ...(experiment.recipe.permission ? { permission: experiment.recipe.permission } : {}),
      ...(experiment.recipe.rules ? { rules: experiment.recipe.rules } : {}),
      ...(resume ? { resume: resume.parts.inputs } : {}),
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

interface Ending {
  readonly links: readonly LinkDraft[];
  /** Where the run stands; its journal, when it is an operation, lets a restart pick it up again. */
  readonly at: Waiter;
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
  if (e.stopped === "shutdown") {
    // an operation is left as it is: the journal brings it back when the server starts again (ADR-0112)
    if (e.at.journal && e.session.endedBy === undefined) {
      e.at.journal.flush(e.session);
      e.session.dispose();
      return e.run;
    }
    return failWith("서버가 멈춰 실행이 중단됐어요");
  }
  if (e.outcome.status === "error" && e.calls === 0 && !e.session.endedBy)
    return failWith(`에이전트가 시작하지 못했어요: ${e.outcome.message ?? "원인 미상"}`);
  const finished = await e.session.finish(endReasonOf(e.session, e.outcome, e.timedOut));
  const calls = deps.logs?.callsOf(e.run.id) ?? [];
  const result = finished.events
    ? {
        ...finished,
        events: withLinks(stampReal(finished.events, calls, e.run.startedAt), e.links),
      }
    : finished;
  e.session.dispose();
  return save(deps, applyRunEvent(e.run, { type: "complete", at, result, harness: e.info }));
}

/** The run, to the end (see the header). An operation's journal is dropped once the run is over; a run left running keeps it. */
export async function executeRun(
  deps: ExecutorDeps,
  queued: RunRecord,
  experiment: Experiment,
  outside: AbortSignal,
  stopReason: () => StopReason | undefined,
): Promise<RunRecord> {
  const done = await executeOnce(deps, queued, experiment, outside, stopReason);
  if (experiment.recipe.operation && done.status !== "running")
    await deps.store.deleteJournal(done.id).catch(() => undefined);
  return done;
}

const failRun = (deps: ExecutorDeps, run: RunRecord, error: string) =>
  save(deps, applyRunEvent(run, { type: "fail", at: deps.stamps.now(), error }));

/** A run that is ready to go, or the record it ended as before it could start. */
type Begun =
  | { readonly run: RunRecord; readonly harness: HarnessPort; readonly resume?: Resume }
  | { readonly done: RunRecord };

/**
 * The run starts, or (a restarted server meeting a run it left running) is picked up: an operation is built again from
 * its journal, or ends for the reason it cannot (ADR-0112).
 */
async function begin(
  deps: ExecutorDeps,
  queued: RunRecord,
  experiment: Experiment,
): Promise<Begun> {
  const resuming = queued.status === "running";
  const run = resuming
    ? queued
    : await save(deps, applyRunEvent(queued, { type: "start", at: deps.stamps.now() }));
  const harness = deps.harnesses.get(experiment.recipe.harnessId);
  if (!harness)
    return {
      done: await failRun(
        deps,
        run,
        `하네스 '${experiment.recipe.harnessId}'가 지금 설정에 없어요`,
      ),
    };
  if (!resuming) return { run, harness };
  const resume = experiment.recipe.operation
    ? await resumeOf(deps.store, run, experiment)
    : "이어 갈 수 있는 실행이 아니에요";
  if (typeof resume === "string")
    return { done: await failRun(deps, run, `서버가 멈춰 중단됐어요. ${resume}`) };
  return { run, harness, resume };
}

/** How long the agent may take in real time: an operation its hours at worst (an alarm slows a fast-forward run to real speed). */
const wallLimitOf = (deps: ExecutorDeps, experiment: Experiment): number =>
  experiment.recipe.operation
    ? experiment.recipe.operation.hours * 3_600_000 + OPERATION_SLACK_MS
    : (deps.wallLimitMs ?? DEFAULT_WALL_LIMIT_MS);

/** Everything a run is wired to while it goes. */
interface Wiring {
  readonly at: Waiter;
  readonly links: LinkDraft[];
  readonly counter: { calls: number };
  readonly pace: Pace;
  readonly watched: Watch;
  readonly request: AgentRunRequest;
  readonly operation: ReturnType<typeof operationOf>;
  readonly exposed: { readonly url: string; close(): void } | undefined;
  readonly attachment: TelemetryAttachment | undefined;
  readonly traceparent: string;
}

function wire(
  deps: ExecutorDeps,
  outside: AbortSignal,
  at: Pick<Waiter, "run" | "experiment" | "session">,
  harness: HarnessPort,
  resume: Resume | undefined,
): Wiring {
  const { run, experiment, session } = at;
  deps.logs?.open(run.id, run.startedAt);
  deps.logs?.record(run.id, session.eventsSince?.(0) ?? []);
  for (const stamp of resume?.parts.stamps ?? []) deps.logs?.record(run.id, [], stamp);
  const held: { watch?: Watch } = {};
  const kept = keepJournal(deps.store, at, resume);
  const waiter: Waiter = {
    ...at,
    signal: () => (held.watch as Watch).controller.signal,
    ...(kept.journal ? { journal: kept.journal } : {}),
  };
  const pace: Pace = { pausedMs: 0 };
  const callsBefore = resume?.parts.inputs.filter((i) => i[0] === "c").length ?? 0;
  const { endpoint, counter } = endpointFor(deps, waiter, pace, callsBefore);
  const operation = operationOf(deps, waiter, harness);
  const exposed =
    harness.info.toolTransport === "mcp"
      ? deps.gateway?.open(run.id, endpoint, harness.info.mcpSlot)
      : undefined;
  // Where this connection's traces pile up decides what the harness is asked to carry (ADR-0085).
  const attachment = deps.harnesses
    .telemetryOf?.(experiment.recipe.harnessId)
    ?.attach({ runId: run.id });
  const watched = watch(deps, session, outside, pace, wallLimitOf(deps, experiment));
  held.watch = watched;
  const traceparent = attachment?.traceparent ?? newTraceparent();
  const request: AgentRunRequest = {
    runId: run.id,
    seed: run.seed,
    repeat: run.repeat,
    agentId: experiment.recipe.agentId,
    prompt: resume ? `${session.task.prompt}\n\n${RESUME_NOTE}` : session.task.prompt,
    limits: {
      maxToolCalls: session.task.maxToolCalls,
      timeLimitSeconds: session.task.timeLimitSeconds,
    },
    ...(operation ? { operation: operation.info } : {}),
    tools: { ...endpoint, ...(exposed ? { mcpUrl: exposed.url } : {}) },
    signal: watched.controller.signal,
    traceparent,
    ...(attachment ? { telemetry: attachment } : {}),
  };
  return {
    at: waiter,
    links: kept.links,
    counter,
    pace,
    watched,
    request,
    operation,
    exposed,
    attachment,
    traceparent,
  };
}

async function executeOnce(
  deps: ExecutorDeps,
  queued: RunRecord,
  experiment: Experiment,
  outside: AbortSignal,
  stopReason: () => StopReason | undefined,
): Promise<RunRecord> {
  const begun = await begin(deps, queued, experiment);
  if ("done" in begun) return begun.done;
  const { run, harness, resume } = begun;
  const who = whoIs(experiment, harness);
  const session = await openSession(deps, run, experiment, resume);
  if (typeof session === "string")
    return failRun(deps, run, resume ? `서버가 멈춰 중단됐어요. ${session}` : session);
  const worldId = experiment.recipe.worldId;
  deps.activity?.(worldId, { type: "start", runId: run.id, who: await who });
  const wired = wire(deps, outside, { run, experiment, session }, harness, resume);
  const { at, links, watched } = wired;
  try {
    const outcome = await runAgent(harness, wired.request, { at, calls: wired.counter, links });
    return await conclude(deps, {
      run,
      session,
      links,
      at,
      outcome,
      info: harnessInfo(harness, outcome, wired.traceparent, wired.attachment !== undefined),
      calls: wired.counter.calls,
      timedOut: watched.timedOut(),
      stopped: stopReason(),
    });
  } catch (err) {
    session.dispose();
    return failRun(deps, run, `실행 중 오류: ${(err as Error).message}`);
  } finally {
    watched.stop();
    wired.operation?.stop();
    wired.exposed?.close();
    deps.logs?.close(run.id);
    deps.activity?.(worldId, { type: "end", runId: run.id });
  }
}
