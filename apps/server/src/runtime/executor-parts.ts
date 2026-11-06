/**
 * What a run is wired with (REQ-030, ADR-0027): the executor's dependencies and limits, the watch that stops a harness
 * that overstays, and the tools as the harness reaches them. Kept apart from `executor.ts`, which decides how a run ends.
 */
import type { ActivityEvent, ExperimentEvent } from "@terrarium/core/contract";
import type { ExperimentStore, ToolCallOutcome, ToolEndpoint } from "@terrarium/core/experiments";
import { type CallResult, DEFAULT_AUTO_REPLY } from "@terrarium/core/session";
import { callEffect, callTargets } from "@terrarium/core/tools";
import type { BlueprintCache } from "./blueprint-cache";
import type { HarnessDirectory } from "./context";
import type { Escalations } from "./escalations";
import type { RunLogs } from "./events";
import { pump, type Waiter } from "./executor-operation";
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
  /** Where a run that asks a person for help waits (ADR-0087 item 4); without it the setup answers at once. */
  readonly escalations?: Escalations;
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

export const DEFAULT_WALL_LIMIT_MS = 30 * 60_000;
export const DEFAULT_GRACE_MS = 15_000;
export const WATCH_MS = 200;
export const OPERATION_SLACK_MS = 10 * 60_000;

export interface Watch {
  readonly controller: AbortController;
  stop(): void;
  readonly timedOut: () => boolean;
}

/** Wall-clock time the agent was kept waiting for a person: it is not the agent's time, so the limit does not count it. */
export interface Pace {
  pausedMs: number;
}

/** Abort the harness when stopped from outside, at the wall limit, or a grace period after the session ended. */
export function watch(
  deps: ExecutorDeps,
  session: HostedSession,
  outside: AbortSignal,
  pace: Pace,
  limitMs: number,
): Watch {
  const controller = new AbortController();
  let timedOut = false;
  let endedAt: number | undefined;
  const started = Date.now();
  const onOutside = () => controller.abort();
  outside.addEventListener("abort", onOutside, { once: true });
  const timer = setInterval(() => {
    const now = Date.now();
    if (session.endedBy !== undefined) endedAt ??= now;
    if (now - started - pace.pausedMs > limitMs) timedOut = true;
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

/** A call that asked a person: the run waits here until they answer (or the setup answers for them). */
async function awaitPerson(
  deps: ExecutorDeps,
  r: CallResult,
  at: Waiter,
  pace: Pace,
): Promise<CallResult> {
  const { run, experiment, session } = at;
  if (!r.waiting) return r;
  if (!deps.escalations) return session.resolveHuman({ kind: "reply", text: DEFAULT_AUTO_REPLY });
  const held = await deps.escalations.hold(
    {
      runId: run.id,
      experimentId: experiment.id,
      experimentName: experiment.name,
      owner: experiment.owner,
      agent: experiment.subject?.agent.name ?? experiment.recipe.agentId,
      since: deps.stamps.now(),
      request: r.waiting,
    },
    session,
    at.signal(),
  );
  pace.pausedMs += held.waitedMs;
  return held.result;
}

/** The run's tools as the harness reaches them; every call is also announced live. */
export function endpointFor(deps: ExecutorDeps, at: Waiter, pace: Pace, callsBefore: number) {
  const { run, session } = at;
  const worldId = at.experiment.recipe.worldId;
  const counter = { calls: callsBefore };
  const endpoint = {
    get specs() {
      return session.specs;
    },
    call: async (name: string, args: Record<string, unknown>): Promise<ToolCallOutcome> => {
      const r = await awaitPerson(deps, await session.call(name, args), at, pace);
      counter.calls++;
      pump(deps, at, { t: r.t, tool: name, real: deps.stamps.now() });
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
