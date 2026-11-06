/**
 * How the services did during a run, read from the run's events alone (REQ-088, ADR-0091 item 3). A service that
 * stops or slows raises a `service_down` or `service_degraded` alarm and the alarm is cleared when it is well again,
 * so the list of events (the one replay and the result's first line also read) already says when each service was
 * impaired. Nothing here looks at the world: the same events always read the same.
 */
import type { RunEvent } from "./run-events";
import { type ServiceStatus, SLOW_HARM_SHARE } from "./service";

/** The status a service had from this moment, until its next change. */
export interface StatusChange {
  readonly t: number;
  /** Position of the event that set it in the run's list; "before a call" means a smaller position. */
  readonly seq: number;
  readonly status: ServiceStatus;
}

/** Per service, its changes in the order they happened. A service that never had trouble is not in it. */
export type ServiceTimeline = ReadonlyMap<string, readonly StatusChange[]>;

const CODE_STATUS: Readonly<Record<string, ServiceStatus>> = {
  service_down: "down",
  service_degraded: "degraded",
};

/** What a service alarm says: which service and which status; `undefined` for any other event. */
function serviceAlarm(
  e: RunEvent,
): { id: string; raised: boolean; status: ServiceStatus } | undefined {
  if (e.kind !== "world") return undefined;
  const c = e.command;
  if (c.type === "alarm.raise") {
    const status = c.alarm.kind === "service" ? CODE_STATUS[c.alarm.code] : undefined;
    return status ? { id: c.alarm.entityId, raised: true, status } : undefined;
  }
  if (c.type !== "alarm.clear") return undefined;
  const at = c.alarmId.indexOf(":");
  const status = at > 0 ? CODE_STATUS[c.alarmId.slice(0, at)] : undefined;
  return status ? { id: c.alarmId.slice(at + 1), raised: false, status } : undefined;
}

/** The status of every service over the run. Two changes at one moment count as the later one (a slow service that stops). */
export function serviceTimeline(events: readonly RunEvent[]): ServiceTimeline {
  const out = new Map<string, StatusChange[]>();
  const now = new Map<string, ServiceStatus>();
  for (const e of events) {
    const a = serviceAlarm(e);
    if (!a) continue;
    const before = now.get(a.id) ?? "healthy";
    // a cleared alarm only matters when it is the one the service is in
    if (!a.raised && before !== a.status) continue;
    const status: ServiceStatus = a.raised ? a.status : "healthy";
    now.set(a.id, status);
    const list = out.get(a.id) ?? [];
    const last = list.at(-1);
    if (last && last.t === e.t) list.pop();
    const prior = list.at(-1)?.status ?? "healthy";
    if (prior !== status) list.push({ t: e.t, seq: e.seq, status });
    out.set(a.id, list);
  }
  return out;
}

/** A service's status just before the event at `seq` (what the world was when a call was made). */
export function statusBefore(timeline: ServiceTimeline, id: string, seq: number): ServiceStatus {
  let status: ServiceStatus = "healthy";
  for (const c of timeline.get(id) ?? []) {
    if (c.seq >= seq) break;
    status = c.status;
  }
  return status;
}

/** A service's status at world time `t` (a change at `t` already counts). */
export function statusAt(timeline: ServiceTimeline, id: string, t: number): ServiceStatus {
  let status: ServiceStatus = "healthy";
  for (const c of timeline.get(id) ?? []) {
    if (c.t > t) break;
    status = c.status;
  }
  return status;
}

/** How many services are not healthy at `t`, and whether any of them is stopped. */
export function impairedAt(
  timeline: ServiceTimeline,
  t: number,
): { readonly count: number; readonly down: number } {
  let count = 0;
  let down = 0;
  for (const id of timeline.keys()) {
    const s = statusAt(timeline, id, t);
    if (s !== "healthy") count++;
    if (s === "down") down++;
  }
  return { count, down };
}

/**
 * The most services in trouble at one time among the changes before the event at `seq` (all of them when `seq` is
 * not given), and when that was first the case. `down` says whether one of them was stopped and not only slow.
 */
export function peakImpaired(
  timeline: ServiceTimeline,
  seq = Number.POSITIVE_INFINITY,
): { readonly count: number; readonly down: boolean; readonly t: number } {
  const changes = [...timeline.entries()]
    .flatMap(([id, list]) => list.map((c) => ({ id, ...c })))
    .filter((c) => c.seq < seq)
    .sort((a, b) => a.seq - b.seq);
  const now = new Map<string, ServiceStatus>();
  let peak = { count: 0, down: false, t: 0 };
  for (const c of changes) {
    now.set(c.id, c.status);
    const states = [...now.values()].filter((s) => s !== "healthy");
    if (states.length > peak.count)
      peak = { count: states.length, down: states.includes("down"), t: c.t };
  }
  return peak;
}

/** What a stopped service loses in an hour counts in full; a slow one loses `SLOW_HARM_SHARE` of it. */
export const harmShare = (s: ServiceStatus): number =>
  s === "down" ? 1 : s === "degraded" ? SLOW_HARM_SHARE : 0;
