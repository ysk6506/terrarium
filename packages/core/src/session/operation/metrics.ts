/**
 * What an operation run measures (REQ-090, ADR-0094 item 7), read from its event list alone, so scoring a finished run,
 * a replay of it and the mid-run card all give the same numbers.
 *
 *   놓친 알람      an alarm that went up and that the agent never looked at: no alarm-showing call (`events_since`,
 *                  `list_alarms`, `service_status`, `list_services`, `get_impact`) after it went up, and no look at the
 *                  equipment it names while it was up. (`events_since` after it was cleared still shows it.)
 *   탐지 지연      per generated fault: from the fault to the agent's first alarm-showing call after it. A fault never
 *                  looked for counts until the end of the run (the number is then a lower bound; `undetected` says how many).
 *   사건 끝       the fault is removed, or every alarm of its equipment raised after it is down again (the earlier).
 *   감시 주기      the median gap between looks (alarm-showing calls less than 10 s apart are one look), in world seconds.
 *   가용률         1 - Σ (stopped time + 30% of slow time) / (services × the run's length).
 */
import { analyzeRecovery, type ServiceHarm } from "@terrarium/core/oracle";
import {
  ALARM_TOOLS,
  type AlarmLife,
  alarmLives,
  harmShare,
  incidents as incidentsOf,
  type RunEvent,
  serviceTimeline,
  type ToolEvent,
} from "@terrarium/core/world";

export interface Spread {
  readonly min: number;
  readonly median: number;
  readonly max: number;
}

export interface OperationMetrics {
  /** World seconds the run lasted, from the agent's task to the end. */
  readonly seconds: number;
  /** 0-1; absent when the world has no service. */
  readonly availability?: number;
  readonly incidents: number;
  /** Incidents still open at the end. */
  readonly open: number;
  /** Seconds from fault to its end, over the incidents that ended. */
  readonly recovery?: Spread;
  readonly alarms: number;
  readonly missed: number;
  /** Median seconds from a fault to the agent's first look; absent without incidents. */
  readonly detectionDelayS?: number;
  readonly undetected: number;
  readonly worsened: number;
  readonly escalations: number;
  readonly calls: number;
  readonly callsPerIncident?: number;
  readonly tokensPerIncident?: number;
  /** Calls made while no alarm was up. */
  readonly quietCalls: number;
  /** An estimate: the run's tokens shared out by calls. */
  readonly quietTokens?: number;
  /** Median seconds between looks at the alarms. */
  readonly watchIntervalS?: number;
}

export interface MetricsInput {
  readonly events: readonly RunEvent[];
  readonly harms: readonly ServiceHarm[];
  readonly endedAt?: number;
  readonly tokens?: number;
}

export function median(xs: readonly number[]): number | undefined {
  if (xs.length === 0) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

const isCall = (e: RunEvent): e is ToolEvent => e.kind === "tool" && e.ok;
const isLook = (e: RunEvent): e is ToolEvent => isCall(e) && ALARM_TOOLS.has(e.tool);

/** When the agent first saw this alarm, or undefined when it never did. */
function seenAt(a: AlarmLife, calls: readonly ToolEvent[]): number | undefined {
  const hit = calls.find((c) => {
    if (c.seq < a.seq) return false;
    if (c.tool === "events_since") return true;
    if (c.seq > a.clearedSeq) return false;
    return ALARM_TOOLS.has(c.tool) || c.targets.includes(a.entity);
  });
  return hit?.t;
}

/** Availability over the span, counting a stopped service in full and a slow one at its share. */
function availabilityOf(
  events: readonly RunEvent[],
  services: number,
  from: number,
  to: number,
): number | undefined {
  if (services === 0 || to <= from) return undefined;
  const timeline = serviceTimeline(events);
  let lost = 0;
  for (const changes of timeline.values())
    changes.forEach((c, i) => {
      const a = Math.max(c.t, from);
      const b = Math.min(changes[i + 1]?.t ?? to, to);
      lost += Math.max(0, b - a) * harmShare(c.status);
    });
  return Math.max(0, Math.min(1, 1 - lost / (services * (to - from))));
}

/** How many of the calls were made while no alarm was up. */
function quietCallsOf(events: readonly RunEvent[]): number {
  let up = 0;
  let quiet = 0;
  for (const e of events) {
    if (e.kind === "world" && e.command.type === "alarm.raise") up++;
    else if (e.kind === "world" && e.command.type === "alarm.clear") up = Math.max(0, up - 1);
    else if (isCall(e) && up === 0) quiet++;
  }
  return quiet;
}

/** Looks closer than this are one look (an agent that asks three things in a row looked once). */
const SAME_LOOK_S = 10;

function gaps(times: readonly number[]): number[] {
  const looks = times.filter((t, i) => i === 0 || t - (times[i - 1] as number) > SAME_LOOK_S);
  return looks.slice(1).map((t, i) => t - (looks[i] as number));
}

function spreadOf(xs: readonly number[]): Spread | undefined {
  return xs.length === 0
    ? undefined
    : { min: Math.min(...xs), median: median(xs) as number, max: Math.max(...xs) };
}

/** Hand-overs to a team and questions to a person. */
function escalationsOf(events: readonly RunEvent[]): number {
  return events.filter(
    (e) => (isCall(e) && e.tool === "escalate") || (e.kind === "human" && e.what === "asked"),
  ).length;
}

/** For each incident, the seconds until the agent first looked at the alarms; the ones it never looked for count to the end. */
function detectionOf(
  added: readonly { readonly seq: number; readonly t: number }[],
  looks: readonly ToolEvent[],
  end: number,
): { delays: number[]; undetected: number } {
  const first = added.map((f) => looks.find((l) => l.seq > f.seq));
  return {
    delays: added.map((f, i) => (first[i]?.t ?? end) - f.t),
    undetected: first.filter((l) => l === undefined).length,
  };
}

export function operationMetrics(input: MetricsInput): OperationMetrics {
  const { events } = input;
  const start = events.find((e) => e.kind === "score" && e.what === "agent_start")?.t ?? 0;
  const end = Math.max(input.endedAt ?? 0, ...events.map((e) => e.t));
  const calls = events.filter(isCall);
  const looks = calls.filter(isLook);
  const all = alarmLives(events);
  const alarms = all.filter((a) => a.t >= start);
  const missed = alarms.filter((a) => seenAt(a, calls) === undefined).length;

  const added = incidentsOf(events, all);
  const { delays, undetected } = detectionOf(added, looks, end);
  const lasted = added.flatMap((f) => (f.endT === undefined ? [] : [f.endT - f.t]));
  const incidents = added.length;
  const recovery = spreadOf(lasted);
  const quietCalls = quietCallsOf(events);
  const escalations = escalationsOf(events);
  const watch = median(gaps(looks.map((l) => l.t)));
  const recovered = analyzeRecovery(events, input.harms, end);
  const availability = availabilityOf(events, input.harms.length, start, end);

  return {
    seconds: Math.max(0, end - start),
    ...(availability === undefined ? {} : { availability }),
    incidents,
    open: incidents - lasted.length,
    ...(recovery ? { recovery } : {}),
    alarms: alarms.length,
    missed,
    ...(delays.length ? { detectionDelayS: median(delays) as number } : {}),
    undetected,
    worsened: recovered.worsened.length,
    escalations,
    calls: calls.length,
    ...(incidents > 0 ? { callsPerIncident: calls.length / incidents } : {}),
    ...(incidents > 0 && input.tokens !== undefined
      ? { tokensPerIncident: input.tokens / incidents }
      : {}),
    quietCalls,
    ...(input.tokens !== undefined && calls.length > 0
      ? { quietTokens: Math.round((input.tokens * quietCalls) / calls.length) }
      : {}),
    ...(watch === undefined ? {} : { watchIntervalS: watch }),
  };
}
