/**
 * One run read as a process of steps (REQ-112, ADR-0135): the record of a run folded into the rows a person would count
 * for "task A": what the agent did becomes one row ("에이전트"), and everything that needed somebody else stays a row of
 * its own. The fold is plain code over the run's events, never a model's reading:
 *
 *   tool calls of the agent              → one "agent" row for a stretch of them (the stretch ends at the next other row)
 *   `escalate` and its hand-off          → "handoff" row (or "physical" when somebody comes to the equipment), with the lead time
 *   `ask_human`                          → "approve" row
 *
 * Times are simulated seconds counted from the moment the agent was given the task.
 */
import { formatDuration, withJosa } from "@terrarium/core/kernel";
import {
  type CounterpartEvent,
  type FaultType,
  faultSpec,
  type HandedFault,
  type HumanEvent,
  type RunEvent,
  type ToolEvent,
} from "@terrarium/core/world";

export type LedgerTag = "agent" | "physical" | "approve" | "handoff";

export const AGENT_WHO = "에이전트";
export const HUMAN_WHO = "운영자";

export interface LedgerRow {
  readonly tag: LedgerTag;
  readonly who: string;
  /** One sentence in 해요체: "서버 팀이 디스크 고장을 현장에서 처리했어요". */
  readonly text: string;
  /** What the row is made of in the protocol's words: "넘기기 · 리드타임 1시간 4분", "ask_human". */
  readonly note?: string;
  /** Seconds from the agent's start. */
  readonly from: number;
  readonly to: number;
  /** For an agent row: how many tools it folds. */
  readonly tools?: number;
}

export interface RunProcess {
  readonly rows: readonly LedgerRow[];
  /** Rows an agent did not do: the steps that remain. */
  readonly steps: number;
  /** Distinct people (teams, roles) in those steps. */
  readonly people: number;
  /** Seconds from the agent's start to the end of the last row. */
  readonly seconds: number;
  /** Tools the agent called, all rows together. */
  readonly tools: number;
}

export interface FoldInput {
  readonly events: readonly RunEvent[];
  /** The world time the agent was given the task: the process's first second. */
  readonly origin: number;
  /** The world time the run ended. */
  readonly end: number;
}

/** Calls that only wait for somebody else; while a hand-off is open they belong to it. */
const WAITING_TOOLS: ReadonlySet<string> = new Set([
  "events_since",
  "create_ticket",
  "update_ticket",
  "list_tickets",
]);

const labelOf = (type: string): string => {
  try {
    return faultSpec(type as FaultType).label;
  } catch {
    return type;
  }
};

interface Span {
  readonly from: number;
  readonly to: number;
}

interface Other extends Span {
  readonly row: Omit<LedgerRow, "from" | "to">;
}

function handoffRow(
  e: Extract<CounterpartEvent, { what: "handed" }>,
  input: FoldInput,
  done: ReadonlyMap<string, number>,
): Other {
  const doneAt = (f: HandedFault): number => done.get(f.faultId) ?? f.doneAt;
  const finished = e.faults.length > 0 && e.faults.every((f) => doneAt(f) <= input.end);
  const last = Math.max(e.t, ...e.faults.map(doneAt));
  const to = Math.min(last, input.end);
  const onSite = e.faults.some((f) => f.onSite);
  const labels = [...new Set(e.faults.map((f) => labelOf(f.faultType)))].join(", ") || e.domain;
  const where = onSite ? "현장에서" : "원격으로";
  const verb = finished ? "처리했어요" : "처리하는 중에 실행이 끝났어요";
  return {
    from: e.t - input.origin,
    to: to - input.origin,
    row: {
      tag: onSite ? "physical" : "handoff",
      who: e.team,
      text: `${withJosa(e.team, "이")} ${withJosa(labels, "을")} ${where} ${verb}`,
      note: `넘기기 · 리드타임 ${formatDuration(to - e.t)}${finished ? "" : " (끝나기 전)"}`,
    },
  };
}

function handoffRows(events: readonly RunEvent[], input: FoldInput): Other[] {
  const done = new Map<string, number>();
  for (const e of events)
    if (e.kind === "counterpart" && e.what === "done") done.set(e.fault.faultId, e.t);
  return events.flatMap((e) =>
    e.kind === "counterpart" && e.what === "handed" ? [handoffRow(e, input, done)] : [],
  );
}

type Asked = Extract<HumanEvent, { what: "asked" }>;

function humanRows(
  events: readonly RunEvent[],
  tools: readonly ToolEvent[],
  input: FoldInput,
): Other[] {
  const asked = events.filter((e): e is Asked => e.kind === "human" && e.what === "asked");
  const answers = events.filter(
    (e): e is Extract<HumanEvent, { what: "answered" }> =>
      e.kind === "human" && e.what === "answered",
  );
  const rows = asked.map((a): Other => {
    const answer = answers.find((x) => x.seq > a.seq);
    const to = Math.min(answer?.t ?? input.end, input.end);
    const none = answer?.answer === "end" || answer?.by === "none";
    return {
      from: a.t - input.origin,
      to: Math.max(to, a.t) - input.origin,
      row: {
        tag: "approve",
        who: HUMAN_WHO,
        text: none
          ? `${HUMAN_WHO}가 답하지 않았어요`
          : `${withJosa(HUMAN_WHO, "이")} 확인하고 승인했어요`,
        note: "ask_human",
      },
    };
  });
  // a call without a record of the person's side (a run saved before events) is still one step
  const bare = tools
    .filter((c) => c.tool === "ask_human" && !asked.some((a) => Math.abs(a.t - c.t) < 1))
    .map(
      (c): Other => ({
        from: c.t - input.origin,
        to: c.t - input.origin,
        row: {
          tag: "approve",
          who: HUMAN_WHO,
          text: `${withJosa(HUMAN_WHO, "이")} 확인하고 승인했어요`,
          note: "ask_human",
        },
      }),
    );
  return [...rows, ...bare];
}

const isOwnRow = (c: ToolEvent): boolean => c.tool === "escalate" || c.tool === "ask_human";

const inside = (c: ToolEvent, spans: readonly Span[], origin: number): boolean =>
  (c.effect === "wait" || WAITING_TOOLS.has(c.tool)) &&
  spans.some((s) => c.t - origin >= s.from && c.t - origin <= s.to);

function agentText(calls: readonly ToolEvent[]): string {
  const has = (effect: ToolEvent["effect"]) => calls.some((c) => c.effect === effect);
  const parts = [
    has("observe") ? "확인" : "",
    has("act") ? "조치" : "",
    has("answer") ? "진단" : "",
  ].filter(Boolean);
  return parts.length > 0
    ? `${AGENT_WHO}가 ${parts.join(" · ")}까지 했어요`
    : `${AGENT_WHO}가 기다렸어요`;
}

/** Stretches of agent calls cut at every other row: a call after another row starts a new stretch. */
function agentRows(
  calls: readonly ToolEvent[],
  others: readonly Other[],
  input: FoldInput,
): LedgerRow[] {
  const rows: LedgerRow[] = [];
  let stretch: ToolEvent[] = [];
  const flush = (cutAt: number | undefined) => {
    const first = stretch[0];
    const last = stretch[stretch.length - 1];
    if (!first || !last) return;
    const from = first.t - input.origin;
    const to = Math.max(last.t - input.origin, cutAt ?? 0);
    rows.push({
      tag: "agent",
      who: AGENT_WHO,
      text: agentText(stretch),
      from,
      to,
      tools: stretch.length,
    });
    stretch = [];
  };
  const starts = others.map((o) => o.from).sort((a, b) => a - b);
  let next = 0;
  for (const c of calls) {
    const at = c.t - input.origin;
    while (next < starts.length && (starts[next] as number) <= at) {
      flush(starts[next]);
      next++;
    }
    stretch.push(c);
  }
  flush(undefined);
  return rows;
}

const byStart = (a: LedgerRow, b: LedgerRow): number => a.from - b.from || a.to - b.to;

/** Fold one run's events into rows and the three numbers the company counts: steps, people, time. */
export function foldRun(input: FoldInput): RunProcess {
  const tools = input.events.filter((e): e is ToolEvent => e.kind === "tool");
  const others = [...handoffRows(input.events, input), ...humanRows(input.events, tools, input)];
  const otherRows = others.map((o): LedgerRow => ({ ...o.row, from: o.from, to: o.to }));
  const spans = others.filter((o) => o.row.tag !== "approve");
  const calls = tools.filter((c) => !isOwnRow(c) && !inside(c, spans, input.origin));
  const agent = agentRows(calls, others, input);
  const rows = [...agent, ...otherRows].sort(byStart);
  const remaining = rows.filter((r) => r.tag !== "agent");
  return {
    rows,
    steps: remaining.length,
    people: new Set(remaining.map((r) => r.who)).size,
    seconds: Math.max(0, ...rows.map((r) => r.to)),
    tools: calls.length,
  };
}
