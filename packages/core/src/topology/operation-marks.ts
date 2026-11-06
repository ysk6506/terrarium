/**
 * The time bar of an operation (REQ-090, ADR-0094 item 7): the marks of an ordinary run, with the agent's looks at the
 * alarms ("봤다") instead of every look, a mark for each time a person was asked or stepped in, and a bar for each
 * incident from the fault to its end. Pure functions of the event list.
 */
import { ALARM_TOOLS, GENERATOR_CAUSE, incidents, type RunEvent } from "@terrarium/core/world";
import { type Mark, type MarkKind, markers } from "./story";

/** Whether the events are an operation's (the generator made faults in them). */
export const isOperation = (events: readonly RunEvent[]): boolean =>
  events.some((e) => e.kind === "world" && e.cause === GENERATOR_CAUSE);

const ORDER: readonly MarkKind[] = [
  "fault",
  "alarm",
  "look",
  "act",
  "human",
  "link",
  "partner",
  "recover",
];

/** The marks of an operation, in the order of the bar. */
export function operationMarks(events: readonly RunEvent[]): Mark[] {
  const kept = markers(events).filter((m) => m.kind !== "read");
  const times = (pick: (e: RunEvent) => boolean) => [
    ...new Set(events.filter(pick).map((e) => e.t)),
  ];
  const extra = (kind: MarkKind, at: number[]): Mark[] =>
    at.length > 0 ? [{ kind, t: Math.min(...at), at }] : [];
  const all = [
    ...kept,
    ...extra(
      "look",
      times((e) => e.kind === "tool" && e.ok && ALARM_TOOLS.has(e.tool)),
    ),
    ...extra(
      "link",
      times((e) => e.kind === "link" && e.what === "lost"),
    ),
    ...extra(
      "human",
      times((e) => e.kind === "human" && (e.what === "asked" || e.what === "acted")),
    ),
  ];
  return ORDER.flatMap((k) => all.filter((m) => m.kind === k));
}

/** One incident on the bar: from the fault to its end; open while it has none. */
export interface IncidentSpan {
  readonly from: number;
  /** Absent while the incident is open at the end of the run. */
  readonly to?: number;
  readonly target: string;
}

export function incidentSpans(events: readonly RunEvent[]): IncidentSpan[] {
  return incidents(events).map((i) => ({
    from: i.t,
    ...(i.endT === undefined ? {} : { to: i.endT }),
    target: i.target,
  }));
}
