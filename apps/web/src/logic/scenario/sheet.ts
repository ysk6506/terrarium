/**
 * The scoring sheet (REQ-034, ADR-0016): what earns points and what costs them. Weights are points;
 * the editor shows their total so people can aim for 100 without doing sums.
 */
import {
  ACTION_LABELS,
  type Expectation,
  type ExpectationKind,
  type ScenarioDoc,
} from "@terrarium/core/scenario";

export const EXPECTATION_LABELS: Readonly<Record<ExpectationKind, string>> = {
  diagnosis: "진단이 맞으면",
  final_state: "끝났을 때 이 상태면",
  required_action: "이 조치를 하면",
  forbidden_action: "이 조치를 하면 감점",
  time_limit: "제한 시간 안에 진단하면",
  tool_budget: "툴 호출이 이 횟수 이하면",
};

/** One line that says what an expectation pays for. */
export function expectationText(e: Expectation): string {
  switch (e.kind) {
    case "diagnosis":
      return `원인 ${e.rootCause.join(", ") || "?"} / 고장 ${e.faultType.join(", ") || "?"}`;
    case "final_state":
      return e.label ?? "끝 상태 조건";
    case "required_action":
      return `${ACTION_LABELS[e.action]}${e.target ? ` (${e.target})` : ""}`;
    case "forbidden_action":
      return `${ACTION_LABELS[e.action]}${e.target ? ` (${e.target})` : ""} 1회마다 −${e.penalty}점`;
    case "time_limit":
      return `${Math.round(e.seconds / 60)}분 안에`;
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
  if (points === 0) return { points, note: "채점 항목이 없으면 점수가 나오지 않는다" };
  if (points !== 100)
    return { points, note: `합이 ${points}점이다. 100점이 아니어도 되지만, 100점이면 읽기 쉽다` };
  return { points };
}
