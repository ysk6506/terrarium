/**
 * What an operation run needs around the harness (REQ-090, ADR-0094): the record kept current while the agent waits (and
 * told to a harness that wants alarms pushed), and the way back when the harness is lost. Kept apart from `executor.ts`.
 */
import type { ActivityEvent } from "@terrarium/core/contract";
import type {
  AgentRunOutcome,
  AgentRunRequest,
  Experiment,
  HarnessPort,
  RunRecord,
} from "@terrarium/core/experiments";
import type { RunEvent } from "@terrarium/core/world";
import { AlarmFeed } from "./alarm-wake";
import type { RunLogs } from "./events";
import type { HostedSession } from "./hosts";

/** What the live record needs of the executor's dependencies. */
export interface LiveDeps {
  readonly logs?: RunLogs;
  readonly activity?: (worldId: string, event: ActivityEvent) => void;
}

/** Where a run stands, for the parts that park its calls; `signal` is read when needed, the watch is made later. */
export interface Waiter {
  readonly run: RunRecord;
  readonly experiment: Experiment;
  readonly session: HostedSession;
  readonly signal: () => AbortSignal;
}

/** What the run has written since last asked: kept for the live view, and told to a harness that wants alarms pushed. */
export function pump(
  deps: LiveDeps,
  at: Waiter,
  call?: { readonly t: number; readonly tool: string; readonly real: string },
): readonly RunEvent[] {
  const { run, session } = at;
  const fresh = session.eventsSince?.(deps.logs?.count(run.id) ?? 0) ?? [];
  if (fresh.length === 0 && !call) return fresh;
  deps.logs?.record(run.id, fresh, call);
  for (const event of fresh) {
    if (event.kind !== "counterpart" || event.what === "handed") continue;
    deps.activity?.(at.experiment.recipe.worldId, {
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
  return fresh;
}

/** How often an operation's record is read between calls: the agent may wait for an hour while alarms go up. */
const PUMP_MS = 1000;

/** An operation run: what the harness is told, and a timer that keeps the live record (and a waking harness) current. */
export function operationOf(deps: LiveDeps, at: Waiter, harness: HarnessPort) {
  const config = at.experiment.recipe.operation;
  if (!config) return undefined;
  const feed = config.wakeOnAlarm && harness.info.wakeable ? new AlarmFeed() : undefined;
  const timer = setInterval(() => {
    const fresh = pump(deps, at);
    feed?.offer(fresh);
  }, PUMP_MS);
  return {
    info: { hours: config.hours, ...(feed ? { wake: feed } : {}) },
    stop: () => clearInterval(timer),
  };
}

/** The agent lost its harness or got it back (ADR-0094 item 8), as the host knew it: at the last world time it saw. */
export interface LinkDraft {
  readonly what: "lost" | "back";
  readonly t: number;
  readonly reason?: string;
}

/** How often and how long an operation tries to reach a harness again that stopped before the hours were used. */
const MAX_RECONNECTS = 3;
const RECONNECT_WAIT_MS = 5000;

/** The newest world time the host has seen of this run. */
function lastWorldTime(at: Waiter): number {
  return at.session.eventsSince?.(0).at(-1)?.t ?? at.session.task.startedAt;
}

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/**
 * Run the agent. In an operation a harness that fails while the hours are not used up is asked again (a few times), with
 * a word that it was cut off; each loss and return is written into the record. Anything else ends the run as before.
 */
export async function runAgent(
  harness: HarnessPort,
  request: AgentRunRequest,
  held: { readonly at: Waiter; readonly calls: { calls: number }; readonly links: LinkDraft[] },
): Promise<AgentRunOutcome> {
  const once = (req: AgentRunRequest) =>
    harness
      .run(req)
      .catch(
        (err: unknown): AgentRunOutcome => ({ status: "error", message: (err as Error).message }),
      );
  let outcome = await once(request);
  for (let n = 0; n < MAX_RECONNECTS; n++) {
    const { at, links } = held;
    const lost =
      at.experiment.recipe.operation !== undefined &&
      outcome.status === "error" &&
      held.calls.calls > 0 &&
      !at.session.endedBy &&
      !request.signal.aborted;
    if (!lost) break;
    links.push({
      what: "lost",
      t: lastWorldTime(at),
      ...(outcome.message ? { reason: outcome.message } : {}),
    });
    await pause(RECONNECT_WAIT_MS, request.signal);
    links.push({ what: "back", t: lastWorldTime(at) });
    outcome = await once({
      ...request,
      prompt: `${request.prompt}\n\n연결이 끊겼다가 다시 이어졌어요. 처음부터 다시 하지 말고 events_since(0)으로 지금까지의 일을 확인하고 이어서 맡아 주세요.`,
    });
  }
  return outcome;
}

/** Put the host's link events into the record where their world time falls, and number the record again. */
export function withLinks(events: readonly RunEvent[], links: readonly LinkDraft[]): RunEvent[] {
  if (links.length === 0) return [...events];
  const merged: RunEvent[] = [...events];
  for (const l of links) {
    const at = merged.findIndex((e) => e.t > l.t);
    const event = {
      kind: "link",
      seq: 0,
      t: l.t,
      what: l.what,
      ...(l.reason ? { reason: l.reason } : {}),
    } as RunEvent;
    merged.splice(at < 0 ? merged.length : at, 0, event);
  }
  return merged.map((e, seq) => ({ ...e, seq }));
}
