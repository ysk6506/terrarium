/**
 * The shape of a run, read from its events (REQ-078 step 2, ADR-0084 items 8 and 9): the five marks on the time
 * bar (fault, alarm, look, act, recovery) and the first line of the result ("고장 1곳 → 알람 14곳 → ..."). Pure
 * functions of the event list, so the same run always reads the same.
 */
import type { RunEvent, ToolEvent } from "@terrarium/core/world";
import { clockText } from "./replay-words";

export type MarkKind = "fault" | "alarm" | "read" | "act" | "recover";

/** The order on the bar and in the line. */
export const MARK_KINDS: readonly MarkKind[] = ["fault", "alarm", "read", "act", "recover"];

export const MARK_LABELS: Readonly<Record<MarkKind, string>> = {
  fault: "고장",
  alarm: "알람",
  read: "조회",
  act: "조치",
  recover: "회복",
};

export interface Mark {
  readonly kind: MarkKind;
  /** The first time it happened: where the mark sits. */
  readonly t: number;
  /** Every distinct time it happened, first included: the small dots when it happened more than once. */
  readonly at: readonly number[];
}

/** Which mark an event is, if any. */
function markOf(e: RunEvent): MarkKind | undefined {
  if (e.kind === "world") {
    const c = e.command;
    if (c.type === "fault.add") return "fault";
    if (c.type === "alarm.raise") return "alarm";
    if (c.type === "fault.remove" || c.type === "alarm.clear" || c.type === "breaker.reset")
      return "recover";
    return undefined;
  }
  if (e.kind !== "tool") return undefined;
  if (e.effect === "observe") return "read";
  return e.effect === "act" && e.ok ? "act" : undefined;
}

/** The marks of a run: only the kinds that happened, in the fixed order. */
export function markers(events: readonly RunEvent[]): Mark[] {
  const times = new Map<MarkKind, number[]>();
  for (const e of events) {
    const kind = markOf(e);
    if (kind) times.set(kind, [...(times.get(kind) ?? []), e.t]);
  }
  return MARK_KINDS.flatMap((kind) => {
    const at = times.get(kind);
    return at && at.length > 0 ? [{ kind, t: Math.min(...at), at: [...new Set(at)] }] : [];
  });
}

/** One link of the line: what it says, and where in the run to go when it is pressed. */
export interface StoryPart {
  readonly kind: MarkKind | "servers";
  readonly text: string;
  readonly t: number;
}

export interface Story {
  readonly parts: readonly StoryPart[];
  /** How long it took and how many calls: "9분 30초 · 툴 호출 11번". */
  readonly tail: string;
}

/** The servers in the impact range before the agent acted and after the run, which the caller works out on the board. */
export interface ServersMoved {
  readonly before: number;
  readonly after: number;
  /** When the "before" count was taken. */
  readonly at: number;
}

export interface StoryOptions {
  /** World time the run is counted from (the scenario's start); without it, from the first event. */
  readonly origin?: number;
  readonly servers?: ServersMoved;
}

const places = (events: readonly ToolEvent[]): Set<string> =>
  new Set(events.flatMap((e) => e.targets));

function distinct(events: readonly RunEvent[], pick: (e: RunEvent) => string | undefined): number {
  return new Set(events.flatMap((e) => pick(e) ?? [])).size;
}

const firstOf = (marks: readonly Mark[], kind: MarkKind): number =>
  marks.find((m) => m.kind === kind)?.t ?? 0;

function answerWords(tools: readonly ToolEvent[], events: readonly RunEvent[]): string {
  const graded = events.find((e) => e.kind === "score" && e.what === "graded");
  if (!graded || graded.kind !== "score" || graded.what !== "graded") return "";
  const looked = places(tools);
  return graded.rootCause.some((id) => looked.has(id)) ? "(정답 포함)" : "(정답은 못 짚었어요)";
}

/** The first line of the result, as links that each go to a moment of the run. */
export function storyLine(events: readonly RunEvent[], options: StoryOptions = {}): Story {
  const marks = markers(events);
  const tools = events.filter((e): e is ToolEvent => e.kind === "tool");
  const looked = tools.filter((e) => e.effect === "observe" || e.effect === "act");
  const faults = distinct(events, (e) =>
    e.kind === "world" && e.command.type === "fault.add" ? e.command.fault.target : undefined,
  );
  const alarms = distinct(events, (e) =>
    e.kind === "world" && e.command.type === "alarm.raise" ? e.command.alarm.entityId : undefined,
  );
  const acted = places(tools.filter((e) => e.effect === "act" && e.ok)).size;
  const parts: StoryPart[] = [];
  const add = (kind: StoryPart["kind"], text: string, t: number) => parts.push({ kind, text, t });
  if (faults > 0) add("fault", `고장 ${faults}곳`, firstOf(marks, "fault"));
  if (alarms > 0) add("alarm", `알람 ${alarms}곳`, firstOf(marks, "alarm"));
  if (looked.length > 0)
    add(
      "read",
      `짚은 곳 ${places(looked).size}곳${answerWords(tools, events)}`,
      firstOf(marks, "read"),
    );
  if (acted > 0) add("act", `조치 ${acted}곳`, firstOf(marks, "act"));
  const moved = options.servers;
  if (moved && (moved.before > 0 || moved.after > 0))
    add("servers", `영향 범위 서버 ${moved.before} → ${moved.after}`, moved.at);
  const span = spanOf(events);
  const origin = options.origin ?? span.origin;
  return {
    parts,
    tail: `${clockText(Math.max(0, span.end - origin))} · 툴 호출 ${tools.length}번`,
  };
}

/** Where a run starts and ends on the world's clock: from the scenario's first step to the moment it was closed. */
export function spanOf(events: readonly RunEvent[]): {
  readonly origin: number;
  readonly end: number;
} {
  const start = events.find((e) => e.kind === "score" && e.what === "agent_start");
  const closed = events.find((e) => e.kind === "score" && e.what === "closed");
  const origin =
    start?.kind === "score" && start.what === "agent_start"
      ? start.scenarioStart
      : (events[0]?.t ?? 0);
  return { origin, end: Math.max(origin, closed?.t ?? events.at(-1)?.t ?? origin) };
}
