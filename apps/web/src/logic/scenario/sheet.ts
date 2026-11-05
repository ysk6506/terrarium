/**
 * The scoring sheet (REQ-034, ADR-0016): what earns points and what costs them. Weights are points;
 * the editor shows their total so people can aim for 100 without doing sums.
 */
import {
  ACTION_LABELS,
  CONTROL_ROWS,
  describeCondition,
  type Expectation,
  type ExpectationKind,
  FAULT_RESPONSES,
  minutesText,
  type ScenarioDoc,
} from "@terrarium/core/scenario";
import {
  type BlueprintIndex,
  diagnosisLabel,
  isDiagnosisType,
  isFaultType,
} from "@terrarium/core/world";
import { conditionLine } from "./group";

export const EXPECTATION_LABELS: Readonly<Record<ExpectationKind, string>> = {
  diagnosis: "진단이 맞으면",
  final_state: "끝났을 때 이 상태면",
  required_action: "이 조치를 하면",
  forbidden_action: "이 조치를 하면 감점",
  time_limit: "제한 시간 안에 진단하면",
  tool_budget: "툴 호출이 이 횟수 이하면",
};

const faultLabel = (type: string) => (isDiagnosisType(type) ? diagnosisLabel(type) : type);

/** One line that says what an expectation pays for, with equipment by name and faults by their label. */
export function expectationText(e: Expectation, index?: BlueprintIndex): string {
  const name = (id: string) => index?.find(id)?.name ?? id;
  const act = (a: { action: keyof typeof ACTION_LABELS; target?: string }) =>
    `${ACTION_LABELS[a.action]}${a.target ? ` (${name(a.target)})` : ""}`;
  switch (e.kind) {
    case "diagnosis":
      return `원인 ${e.rootCause.map(name).join(", ") || "?"} / 고장 ${e.faultType.map(faultLabel).join(", ") || "?"}`;
    case "final_state":
      return index ? conditionLine(e.condition, index) : describeCondition(e.condition);
    case "required_action":
      return act(e);
    case "forbidden_action":
      return `${act(e)} 1회마다 −${e.penalty}점`;
    case "time_limit":
      return `${minutesText(e.seconds)} 안에`;
    case "tool_budget":
      return `${e.maxCalls}회 이하`;
  }
}

function nextId(doc: ScenarioDoc): string {
  let top = 0;
  for (const e of doc.expectations) {
    const m = /^x(\d+)$/.exec(e.id);
    if (m) top = Math.max(top, Number(m[1]));
  }
  return `x${top + 1}`;
}

const DEFAULTS: {
  readonly [K in ExpectationKind]: (id: string) => Extract<Expectation, { kind: K }>;
} = {
  diagnosis: (id) => ({ id, kind: "diagnosis", rootCause: [], faultType: [], weight: 60 }),
  final_state: (id) => ({
    id,
    kind: "final_state",
    condition: { kind: "alarm", active: false, severity: "critical" },
    weight: 20,
  }),
  required_action: (id) => ({ id, kind: "required_action", action: "restart", weight: 10 }),
  forbidden_action: (id) => ({ id, kind: "forbidden_action", action: "power_off", penalty: 20 }),
  time_limit: (id) => ({ id, kind: "time_limit", seconds: 1800, weight: 10 }),
  tool_budget: (id) => ({ id, kind: "tool_budget", maxCalls: 20, weight: 10 }),
};

export function addExpectation(
  doc: ScenarioDoc,
  kind: ExpectationKind,
): { doc: ScenarioDoc; id: string } {
  const id = nextId(doc);
  return { doc: { ...doc, expectations: [...doc.expectations, DEFAULTS[kind](id)] }, id };
}

export function updateExpectation(
  doc: ScenarioDoc,
  id: string,
  change: Partial<Expectation>,
): ScenarioDoc {
  return {
    ...doc,
    expectations: doc.expectations.map((e) =>
      e.id === id ? ({ ...e, ...change, id, kind: e.kind } as Expectation) : e,
    ),
  };
}

export const removeExpectation = (doc: ScenarioDoc, id: string): ScenarioDoc => ({
  ...doc,
  expectations: doc.expectations.filter((e) => e.id !== id),
});

/** Points on offer (penalties are not counted) and how far from 100 that is. */
export function sheetTotal(doc: ScenarioDoc): { readonly points: number; readonly note?: string } {
  const points = doc.expectations.reduce((sum, e) => sum + ("weight" in e ? e.weight : 0), 0);
  if (points === 0) return { points, note: "채점 항목이 없으면 점수가 나오지 않아요" };
  if (points !== 100)
    return {
      points,
      note: `합이 ${points}점이에요. 100점이 아니어도 되지만, 100점이면 읽기 쉬워요`,
    };
  return { points };
}

/** The action card for the scenario's fault, or nothing when no fault, or no remote action, fits. */
function actionCard(
  doc: ScenarioDoc,
  index: BlueprintIndex,
  id: string,
): Extract<Expectation, { kind: "required_action" }> | undefined {
  const fault = doc.nodes.find(
    (n) => n.type === "inject_fault" && isFaultType(String(n.params.faultType)),
  );
  const type = String(fault?.params.faultType);
  const response = isFaultType(type) ? FAULT_RESPONSES[type] : undefined;
  if (!fault || !response || response.remedy === "diagnose") return undefined;
  const row = response.via
    .map((rowId) => CONTROL_ROWS.find((r) => r.id === rowId))
    .find((r) => (r?.actions.length ?? 0) > 0);
  const action = row?.actions[0];
  if (!row || !action) return undefined;
  const target = typeof fault.params.target === "string" ? fault.params.target : undefined;
  const kind = target ? index.find(target)?.kind : undefined;
  const fits = target !== undefined && kind !== undefined && row.targets.includes(kind);
  return { id, kind: "required_action", action, ...(fits ? { target } : {}), weight: 20 };
}

/**
 * The "조치 항목 더하기" the check on the exam paper offers when an agent that only knows the answer gets full marks:
 * a card for the action an agent could take about the scenario's fault, from the controllability table. The action is
 * the first one of the first control row that has one; it names the fault's target when that is something the action
 * can act on. A fault nothing remote can fix (`diagnose`) gets an empty end-state card to describe instead.
 */
export function suggestedAction(
  doc: ScenarioDoc,
  index: BlueprintIndex,
): { doc: ScenarioDoc; id: string; kind: "required_action" | "final_state" } {
  const card = actionCard(doc, index, nextId(doc));
  if (!card) return { ...addExpectation(doc, "final_state"), kind: "final_state" };
  return {
    doc: { ...doc, expectations: [...doc.expectations, card] },
    id: card.id,
    kind: card.kind,
  };
}
