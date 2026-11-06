/**
 * The incidents of an operation, read from a run's events (REQ-090, ADR-0094 item 7): the faults the generator made,
 * when each began and when it was over, and the alarms with the moments they went up and came down. The measures, the
 * time bar's recovery bars and the mid-run card all read these, so they cannot disagree.
 */
import type { RunEvent } from "./run-events";

/** The cause the fault generator writes on the faults it makes. */
export const GENERATOR_CAUSE = "generator";

/** Calls that show the agent the alarms, whatever else they show: looking at one of them is "봤다". */
export const ALARM_TOOLS: ReadonlySet<string> = new Set([
  "events_since",
  "list_alarms",
  "service_status",
  "list_services",
  "get_impact",
]);

/** One alarm from the moment it went up to the moment it came down. */
export interface AlarmLife {
  readonly seq: number;
  readonly t: number;
  readonly entity: string;
  readonly id: string;
  /** Seq and time of the clear; infinity while it is up. */
  clearedSeq: number;
  clearedT: number;
}

export function alarmLives(events: readonly RunEvent[]): AlarmLife[] {
  const out: AlarmLife[] = [];
  const up = new Map<string, AlarmLife>();
  for (const e of events) {
    if (e.kind !== "world") continue;
    const c = e.command;
    if (c.type === "alarm.raise") {
      const life: AlarmLife = {
        seq: e.seq,
        t: e.t,
        entity: c.alarm.entityId,
        id: c.alarm.id,
        clearedSeq: Number.POSITIVE_INFINITY,
        clearedT: Number.POSITIVE_INFINITY,
      };
      out.push(life);
      up.set(c.alarm.id, life);
    } else if (c.type === "alarm.clear") {
      const life = up.get(c.alarmId);
      if (life) {
        life.clearedSeq = e.seq;
        life.clearedT = e.t;
        up.delete(c.alarmId);
      }
    }
  }
  return out;
}

export interface Incident {
  readonly id: string;
  readonly target: string;
  readonly seq: number;
  /** When the fault began. */
  readonly t: number;
  /** When it was over; absent while it is open. */
  readonly endT?: number;
}

/**
 * The generated faults and when each was over: when the fault is removed, or when every alarm its equipment raised after
 * it began is down again, whichever is first.
 */
export function incidents(events: readonly RunEvent[], alarms = alarmLives(events)): Incident[] {
  const removed = new Map<string, number>();
  for (const e of events)
    if (e.kind === "world" && e.command.type === "fault.remove" && !removed.has(e.command.faultId))
      removed.set(e.command.faultId, e.t);
  return events.flatMap((e) => {
    if (e.kind !== "world" || e.command.type !== "fault.add" || e.cause !== GENERATOR_CAUSE)
      return [];
    const { id, target } = e.command.fault;
    const mine = alarms.filter((a) => a.entity === target && a.seq > e.seq);
    const quiet =
      mine.length > 0 && mine.every((a) => a.clearedSeq !== Number.POSITIVE_INFINITY)
        ? Math.max(...mine.map((a) => a.clearedT))
        : undefined;
    const ends = [removed.get(id), quiet].filter((x): x is number => x !== undefined);
    return [
      { id, target, seq: e.seq, t: e.t, ...(ends.length ? { endT: Math.min(...ends) } : {}) },
    ];
  });
}
