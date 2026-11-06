/**
 * What a run did for the services, read from its events (REQ-088, ADR-0091 item 3): when they stopped, when they were
 * well again, whether the agent made them worse on the way, and what it cost. A pure function of the event list and of
 * what each service costs when it stops, so scoring a finished run and replaying it read the same input and give the
 * same numbers.
 *
 *   cost  = Σ over each service of (hours stopped + 30% of the hours slow) × harm per hour, in won;
 *           a batch service counts the delay instead: the same hours × the hours of delay a stop causes.
 */
import {
  type BlueprintIndex,
  harmShare,
  impairedAt,
  type RunEvent,
  type ServiceTimeline,
  serviceDef,
  serviceTimeline,
  statusBefore,
  type ToolEvent,
} from "@terrarium/core/world";

/** What one service costs when it is not running: money each hour, or hours of delay each hour. */
export interface ServiceHarm {
  readonly id: string;
  readonly perHourKrw?: number;
  readonly delayHours?: number;
}

/** The services of a world with what each costs when it is not running. */
export function serviceHarms(index: Pick<BlueprintIndex, "ofKind">): ServiceHarm[] {
  return index.ofKind("service").map((e) => {
    const { harm } = serviceDef(e);
    return {
      id: e.id,
      ...(harm.perHourKrw === undefined ? {} : { perHourKrw: harm.perHourKrw }),
      ...(harm.delayHours === undefined ? {} : { delayHours: harm.delayHours }),
    };
  });
}

export interface RecoveryReport {
  /** The services that stopped or slowed at some point. */
  readonly services: readonly string[];
  /** When the first one did, in world seconds; absent when none ever did. */
  readonly impairedAt?: number;
  /** When all of them were well again for good; absent when some still were at the end. */
  readonly recoveredAt?: number;
  /** World seconds the run is read up to. */
  readonly endAt: number;
  /** Whether every service was well again at the end. */
  readonly recovered: boolean;
  /** Whether the services are well at the end and the agent changed something, so the recovery is its own and not luck. */
  readonly byAgent: boolean;
  /** From the first service in trouble to recovery (to the end when it never came): the MTTR. */
  readonly seconds: number;
  /** The same, counted from the moment the agent had the task, which is what the score reads. */
  readonly agentSeconds: number;
  /** From the agent's start to the change that brought the services back; absent without a recovery by the agent. */
  readonly fixAfterSeconds?: number;
  /** The services that were well before a change of the agent's and stopped right after it. */
  readonly worsened: readonly string[];
  /** How many changes the agent made. */
  readonly acts: number;
  /** The cost of the trouble, in won (request and stateful services); an estimate, like the harm figures. */
  readonly costKrw: number;
  /** The delay of the trouble, in hours (batch services). */
  readonly delayHours: number;
}

/** A change made soon after is counted as what the change did. */
export const WORSEN_WINDOW_S = 180;

const HOUR = 3600;

const isAct = (e: RunEvent): e is ToolEvent => e.kind === "tool" && e.effect === "act" && e.ok;

const agentStartOf = (events: readonly RunEvent[]): number =>
  events.find((e) => e.kind === "score" && e.what === "agent_start")?.t ?? events[0]?.t ?? 0;

/** The services that stopped right after one of the agent's changes while they were well before it. */
function worsenedBy(timeline: ServiceTimeline, acts: readonly ToolEvent[]): string[] {
  const out = new Set<string>();
  for (const act of acts) {
    for (const [id, changes] of timeline) {
      if (statusBefore(timeline, id, act.seq) !== "healthy") continue;
      const hit = changes.some(
        (c) =>
          c.seq > act.seq && c.t >= act.t && c.t <= act.t + WORSEN_WINDOW_S && c.status === "down",
      );
      if (hit) out.add(id);
    }
  }
  return [...out];
}

/** Money and delay: each stretch of time between two changes costs what the services in it cost. */
function costOf(
  timeline: ServiceTimeline,
  harms: readonly ServiceHarm[],
  endAt: number,
): { krw: number; delay: number } {
  let krw = 0;
  let delay = 0;
  for (const h of harms) {
    const changes = timeline.get(h.id) ?? [];
    changes.forEach((c, i) => {
      const until = Math.min(changes[i + 1]?.t ?? endAt, endAt);
      const hours = (Math.max(0, until - c.t) / HOUR) * harmShare(c.status);
      krw += hours * (h.perHourKrw ?? 0);
      delay += hours * (h.delayHours ?? 0);
    });
  }
  return { krw: Math.round(krw), delay: Math.round(delay * 100) / 100 };
}

/** When the last service was well again and stayed so to the end; absent when some were not at the end. */
function recoveryTime(timeline: ServiceTimeline, endAt: number): number | undefined {
  if (impairedAt(timeline, endAt).count > 0) return undefined;
  let last = 0;
  for (const changes of timeline.values()) {
    const final = changes.at(-1);
    if (final?.status === "healthy") last = Math.max(last, final.t);
  }
  return last;
}

/**
 * The change that brought the services back: the agent's last one at or before the recovery. A fault that comes and
 * goes by itself (a leak that kills the process, which then starts again) can have the services well for a moment
 * before the agent has done anything; its first change then is the one that made it stay, if any did.
 */
function fixingAct(acts: readonly ToolEvent[], recoveredAt: number): ToolEvent | undefined {
  return acts.filter((a) => a.t <= recoveredAt).at(-1) ?? acts[0];
}

/**
 * The report of a run. `endedAt` is the world time the run is read up to: the last event of a finished run, which is
 * what a replay of its events gives; a run being scored just now passes the world's clock, the same moment.
 */
export function analyzeRecovery(
  events: readonly RunEvent[],
  harms: readonly ServiceHarm[],
  endedAt?: number,
): RecoveryReport {
  const timeline = serviceTimeline(events);
  const endAt = events.reduce((t, e) => Math.max(t, e.t), endedAt ?? 0);
  const first = [...timeline.values()].reduce<number | undefined>(
    (t, changes) => (changes[0] ? Math.min(t ?? changes[0].t, changes[0].t) : t),
    undefined,
  );
  const agentStart = agentStartOf(events);
  const acts = events.filter(isAct).filter((a) => a.t >= agentStart);
  const recoveredAt = first === undefined ? undefined : recoveryTime(timeline, endAt);
  const fix = recoveredAt === undefined ? undefined : fixingAct(acts, recoveredAt);
  const stoppedAt = recoveredAt ?? endAt;
  const cost = costOf(timeline, harms, endAt);
  return {
    services: [...timeline.keys()],
    ...(first === undefined ? {} : { impairedAt: first }),
    ...(recoveredAt === undefined ? {} : { recoveredAt }),
    endAt,
    recovered: first !== undefined && recoveredAt !== undefined,
    byAgent: fix !== undefined,
    seconds: first === undefined ? 0 : Math.max(0, stoppedAt - first),
    agentSeconds: first === undefined ? 0 : Math.max(0, stoppedAt - Math.max(first, agentStart)),
    ...(fix ? { fixAfterSeconds: Math.max(0, fix.t - agentStart) } : {}),
    worsened: worsenedBy(timeline, acts),
    acts: acts.length,
    costKrw: cost.krw,
    delayHours: cost.delay,
  };
}
