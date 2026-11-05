/**
 * The oracle scores one run against the scenario's scoring sheet (REQ-007, REQ-037). It reads only
 * the run record (tool calls with their effects, the diagnosis, times) and the final true state of
 * the world. It never looks inside the agent or the harness, so any harness is scored the same way.
 *
 *   diagnosis        60% of its weight for the root cause, 40% for the fault type
 *   final_state      all or nothing, judged on the true state when the run ended
 *   required_action  all or nothing, judged by effect (ADR-0019)
 *   forbidden_action its penalty for every time it happened
 *   time_limit       all or nothing; only when a diagnosis was submitted
 *   tool_budget      all or nothing; only when a diagnosis was submitted
 *
 * Time and tool budget say how well the task was done, so they count in proportion to how much of it was
 * done: the share of the diagnosis points earned (or, when the sheet asks for no diagnosis, of its final-state
 * and required-action points). A quick wrong answer earns nothing for being quick (ADR-0067).
 *
 * total = 100 × max(0, earned − penalties) / possible, one decimal. Pass: total ≥ 60 and, if the
 * sheet asks for a diagnosis, a fully correct one.
 */
import { formatDuration, round, withJosa } from "@terrarium/core/kernel";
import {
  ACTION_LABELS,
  type AgentSignals,
  agentActions,
  type Diagnosis,
  describeCondition,
  type Expectation,
  evaluate,
  matchesAction,
  type ScenarioDoc,
  type ToolCallRecord,
} from "@terrarium/core/scenario";
import { diagnosisLabel, isDiagnosisType, type WorldReader } from "@terrarium/core/world";

/** Bump when scoring rules change; it is part of the benchmark key (REQ-039). */
export const ORACLE_VERSION = "2";
export const PASS_MARK = 60;
const ROOT_SHARE = 0.6;

export type EndReason =
  | "diagnosed"
  | "time_limit"
  | "tool_budget"
  | "agent_finished"
  | "agent_error"
  | "cancelled";

export const END_REASON_LABELS: Readonly<Record<EndReason, string>> = {
  diagnosed: "진단 제출",
  time_limit: "제한 시간 초과",
  tool_budget: "툴 호출 상한 도달",
  agent_finished: "진단 없이 종료",
  agent_error: "에이전트 오류",
  cancelled: "멈춤",
};

export interface RunOutcome {
  readonly doc: ScenarioDoc;
  /** The world when the run ended: true state, not sensor readings. */
  readonly world: Pick<WorldReader, "stateOf" | "alarms" | "events" | "index">;
  readonly toolCalls: readonly ToolCallRecord[];
  readonly diagnosis?: Diagnosis;
  readonly diagnosedAt?: number;
  readonly agentStartedAt?: number;
  /** When the scenario started; `event` conditions ignore what happened before it. */
  readonly scenarioStart?: number;
  readonly endReason: EndReason;
}

export type Verdict = "pass" | "partial" | "fail" | "penalty" | "clean";

export interface ScoreItem {
  readonly id: string;
  readonly kind: Expectation["kind"];
  readonly label: string;
  readonly verdict: Verdict;
  /** Points earned (negative for a penalty). */
  readonly points: number;
  /** Points possible (0 for penalties). */
  readonly max: number;
  /** What happened, for people. */
  readonly detail: string;
  /** Diagnosis items: which parts were right and what the answer was, for analysis. */
  readonly facts?: DiagnosisFacts;
}

export interface DiagnosisFacts {
  readonly root: boolean;
  readonly type: boolean;
  readonly rootCause: readonly string[];
  readonly faultType: readonly string[];
}

export interface Score {
  readonly version: string;
  /** 0..100, or null when the sheet has nothing to earn. */
  readonly total: number | null;
  readonly earned: number;
  readonly penalty: number;
  readonly possible: number;
  readonly passed: boolean;
  readonly items: readonly ScoreItem[];
  readonly summary: string;
}

const norm = (s: string) => s.trim().toLowerCase();

/** The agent may name an entity by id or by name; ids and names compare case-insensitively. */
function sameEntity(outcome: RunOutcome, submitted: string, expected: string): boolean {
  if (norm(submitted) === norm(expected)) return true;
  const entity = outcome.world.index.find(expected);
  return entity !== undefined && norm(entity.name) === norm(submitted);
}

/** A fault or mistake type by id ("cooling_unit_failure") or by its Korean label ("냉방기 정지"). */
function sameFault(submitted: string, expected: string): boolean {
  if (norm(submitted) === norm(expected)) return true;
  return isDiagnosisType(expected) && norm(diagnosisLabel(expected)) === norm(submitted);
}

type Scored = Pick<ScoreItem, "verdict" | "points" | "detail" | "facts"> & { label?: string };
type Scorer<K extends Expectation["kind"]> = (
  e: Extract<Expectation, { kind: K }>,
  outcome: RunOutcome,
) => Scored;

function scoreDiagnosis(e: Extract<Expectation, { kind: "diagnosis" }>, o: RunOutcome): Scored {
  const d = o.diagnosis;
  const answer = `정답: ${e.rootCause.join(" 또는 ")} / ${e.faultType.join(" 또는 ")}`;
  if (!d)
    return {
      verdict: "fail",
      points: 0,
      detail: `진단을 제출하지 않았어요 (${answer})`,
      facts: { root: false, type: false, rootCause: e.rootCause, faultType: e.faultType },
    };
  const root = e.rootCause.some((r) => sameEntity(o, d.rootCause, r));
  const type = e.faultType.some((t) => sameFault(d.faultType, t));
  const points = round(e.weight * ((root ? ROOT_SHARE : 0) + (type ? 1 - ROOT_SHARE : 0)), 2);
  const mark = (ok: boolean) => (ok ? "맞음" : "틀림");
  const detail = `제출: ${d.rootCause} / ${d.faultType} — 원인 ${mark(root)}, 종류 ${mark(type)}${root && type ? "" : ` (${answer})`}`;
  const verdict = root && type ? "pass" : root || type ? "partial" : "fail";
  return {
    verdict,
    points,
    detail,
    facts: { root, type, rootCause: e.rootCause, faultType: e.faultType },
  };
}

function signals(o: RunOutcome): AgentSignals {
  return {
    toolCalls: () => o.toolCalls,
    diagnosis: () => o.diagnosis,
    scenarioStart: () => o.scenarioStart ?? 0,
  };
}

const scoreFinalState: Scorer<"final_state"> = (e, o) => {
  const holds = evaluate(e.condition, o.world, signals(o));
  const text = describeCondition(e.condition, o.world.index);
  return {
    verdict: holds ? "pass" : "fail",
    points: holds ? e.weight : 0,
    detail: holds ? `끝났을 때 참: ${text}` : `끝났을 때 거짓: ${text}`,
    label: e.label ?? text,
  };
};

const actionText = (action: keyof typeof ACTION_LABELS, target?: string) =>
  `${target ? `${target} ` : ""}${ACTION_LABELS[action]}`;

const scoreRequired: Scorer<"required_action"> = (e, o) => {
  const call = o.toolCalls.find((c) =>
    (c.effects ?? []).some((a) => matchesAction(a, e.action, e.target)),
  );
  const what = actionText(e.action, e.target);
  return call
    ? {
        verdict: "pass",
        points: e.weight,
        detail: `${withJosa(what, "을")} 했어요 (${call.tool})`,
        label: e.label ?? what,
      }
    : {
        verdict: "fail",
        points: 0,
        detail: `${withJosa(what, "을")} 하지 않았어요`,
        label: e.label ?? what,
      };
};

const scoreForbidden: Scorer<"forbidden_action"> = (e, o) => {
  const times = agentActions(o.toolCalls).filter((a) =>
    matchesAction(a, e.action, e.target),
  ).length;
  const what = actionText(e.action, e.target);
  return times > 0
    ? {
        verdict: "penalty",
        points: -e.penalty * times,
        detail: `${times}회 했어요 (−${e.penalty * times}점)`,
        label: e.label ?? what,
      }
    : { verdict: "clean", points: 0, detail: "하지 않았어요", label: e.label ?? what };
};

const scoreTime: Scorer<"time_limit"> = (e, o) => {
  if (o.diagnosedAt === undefined || o.agentStartedAt === undefined)
    return { verdict: "fail", points: 0, detail: "진단을 제출하지 않아 시간 점수가 없어요" };
  const took = o.diagnosedAt - o.agentStartedAt;
  const ok = took <= e.seconds;
  return {
    verdict: ok ? "pass" : "fail",
    points: ok ? e.weight : 0,
    detail: `진단까지 ${formatDuration(took)} (제한 ${formatDuration(e.seconds)})`,
  };
};

/** Tool calls spent on the investigation (submitting the answer is free). */
export const investigationCalls = (calls: readonly ToolCallRecord[]) =>
  calls.filter((c) => c.tool !== "submit_diagnosis").length;

const scoreBudget: Scorer<"tool_budget"> = (e, o) => {
  const used = investigationCalls(o.toolCalls);
  if (!o.diagnosis)
    return {
      verdict: "fail",
      points: 0,
      detail: `진단을 제출하지 않아 효율 점수가 없어요 (툴 호출 ${used}회)`,
    };
  const ok = used <= e.maxCalls;
  return {
    verdict: ok ? "pass" : "fail",
    points: ok ? e.weight : 0,
    detail: `툴 호출 ${used}회 (상한 ${e.maxCalls}회)`,
  };
};

const SCORERS: { readonly [K in Expectation["kind"]]: Scorer<K> } = {
  diagnosis: scoreDiagnosis,
  final_state: scoreFinalState,
  required_action: scoreRequired,
  forbidden_action: scoreForbidden,
  time_limit: scoreTime,
  tool_budget: scoreBudget,
};

const DEFAULT_LABELS: Readonly<Record<Expectation["kind"], string>> = {
  diagnosis: "진단",
  final_state: "최종 상태",
  required_action: "필수 조치",
  forbidden_action: "금지 행동",
  time_limit: "진단 시간",
  tool_budget: "툴 사용 효율",
};

function possibleOf(e: Expectation): number {
  return e.kind === "forbidden_action" ? 0 : e.weight;
}

const EFFICIENCY: ReadonlySet<Expectation["kind"]> = new Set(["time_limit", "tool_budget"]);

/**
 * How much of the task was done, 0 to 1: the points earned over the points possible among the diagnosis
 * items, or among the final-state and required-action items when the sheet asks for no diagnosis. A sheet with
 * only efficiency and prohibitions has nothing to be done, so nothing to scale.
 */
export function taskShare(items: readonly ScoreItem[]): number {
  const diagnosis = items.filter((i) => i.kind === "diagnosis");
  const task =
    diagnosis.length > 0
      ? diagnosis
      : items.filter((i) => i.kind === "final_state" || i.kind === "required_action");
  const possible = task.reduce((sum, i) => sum + i.max, 0);
  if (possible === 0) return 1;
  return task.reduce((sum, i) => sum + Math.max(0, i.points), 0) / possible;
}

/** Efficiency counts as much as the task was done; what it loses, the detail says. */
function scaleEfficiency(item: ScoreItem, share: number): ScoreItem {
  if (!EFFICIENCY.has(item.kind) || item.points <= 0 || share >= 1) return item;
  const percent = Math.round(share * 100);
  return {
    ...item,
    points: round(item.points * share, 2),
    verdict: share > 0 ? "partial" : "fail",
    detail: `${item.detail} — 과제를 푼 만큼(${percent}%)만 인정해요`,
  };
}

export function score(outcome: RunOutcome): Score {
  const raw: ScoreItem[] = outcome.doc.expectations.map((e) => {
    const scored = (SCORERS[e.kind] as Scorer<typeof e.kind>)(e as never, outcome);
    return {
      id: e.id,
      kind: e.kind,
      label: e.label ?? scored.label ?? DEFAULT_LABELS[e.kind],
      verdict: scored.verdict,
      points: scored.points,
      max: possibleOf(e),
      detail: scored.detail,
      ...(scored.facts ? { facts: scored.facts } : {}),
    };
  });
  const share = taskShare(raw);
  const items = raw.map((i) => scaleEfficiency(i, share));
  const possible = items.reduce((sum, i) => sum + i.max, 0);
  const earned = round(
    items.reduce((sum, i) => sum + Math.max(0, i.points), 0),
    2,
  );
  const penalty = round(-items.reduce((sum, i) => sum + Math.min(0, i.points), 0), 2);
  const total = possible > 0 ? round((100 * Math.max(0, earned - penalty)) / possible, 1) : null;
  const diagnosis = items.filter((i) => i.kind === "diagnosis");
  const diagnosed = diagnosis.length === 0 || diagnosis.every((i) => i.verdict === "pass");
  const passed = total !== null && total >= PASS_MARK && diagnosed;
  return {
    version: ORACLE_VERSION,
    total,
    earned,
    penalty,
    possible,
    passed,
    items,
    summary: summarize(total, passed, items, outcome),
  };
}

function summarize(
  total: number | null,
  passed: boolean,
  items: readonly ScoreItem[],
  o: RunOutcome,
): string {
  if (total === null) return `채점표 없음 · ${END_REASON_LABELS[o.endReason]}`;
  const parts = [`${total}점 ${passed ? "합격" : "불합격"}`];
  const diagnosis = items.find((i) => i.kind === "diagnosis");
  if (diagnosis)
    parts.push(
      diagnosis.verdict === "pass"
        ? "진단 정답"
        : diagnosis.verdict === "partial"
          ? "진단 일부 정답"
          : "진단 오답",
    );
  const penalties = items.filter((i) => i.verdict === "penalty").length;
  if (penalties > 0) parts.push(`금지 행동 ${penalties}종`);
  parts.push(END_REASON_LABELS[o.endReason]);
  return parts.join(" · ");
}
