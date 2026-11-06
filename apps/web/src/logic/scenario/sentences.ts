/**
 * The scoring sheet as sentences (REQ-034, REQ-071, beta feedback 21). A line is not a form with a points box but a
 * sentence — "+60점 · 원인 CRAH-1, 고장 냉방기 정지를 맞히면" — whose numbers and words are what a person presses to
 * change it. This file only builds the sentences; the screen turns each token into a text, a number box or a button.
 */

import { RECOVERY_WEIGHTS } from "@terrarium/core/oracle";
import {
  ACTION_LABELS,
  type Expectation,
  type ScenarioDoc,
  type ScenarioNode,
} from "@terrarium/core/scenario";
import {
  type BlueprintIndex,
  diagnosisLabel,
  isDiagnosisType,
  isFaultType,
} from "@terrarium/core/world";
import { PASS_RULE_TEXT } from "../format";
import { conditionLine } from "./group";

export type NumberField = "weight" | "penalty" | "minutes" | "maxCalls";

export type Token =
  | { readonly kind: "text"; readonly text: string }
  /** A word to press: it opens what the sentence is about (the equipment, the action, the condition). */
  | { readonly kind: "word"; readonly text: string }
  | {
      readonly kind: "number";
      readonly field: NumberField;
      readonly value: number;
      readonly unit: string;
      readonly min: number;
      readonly max: number;
      readonly label: string;
    };

export interface Sentence {
  readonly id: string;
  /** "earn" lines add points, "lose" lines take them away, "limit" lines only set a cap. */
  readonly tone: "earn" | "lose";
  readonly tokens: readonly Token[];
  /** Where the line came from, when it was not typed by a person: "고장 블록에서 저절로". */
  readonly source?: string;
}

const text = (t: string): Token => ({ kind: "text", text: t });
const word = (t: string): Token => ({ kind: "word", text: t });
const num = (
  field: NumberField,
  value: number,
  unit: string,
  min: number,
  max: number,
  label: string,
): Token => ({ kind: "number", field, value, unit, min, max, label });

const faultLabel = (type: string) => (isDiagnosisType(type) ? diagnosisLabel(type) : type);

/** What the fault blocks say the answer is: the equipment they break, and what kind of break. */
export function answerFromFaults(doc: ScenarioDoc): {
  readonly rootCause: string[];
  readonly faultType: string[];
} {
  const faults = doc.nodes.filter(
    (n): n is ScenarioNode => n.type === "inject_fault" && isFaultType(String(n.params.faultType)),
  );
  const unique = (xs: readonly string[]) => [...new Set(xs)];
  return {
    rootCause: unique(
      faults.map((n) => n.params.target).filter((t): t is string => typeof t === "string"),
    ),
    faultType: unique(faults.map((n) => String(n.params.faultType))),
  };
}

/** True when a diagnosis line already says what the fault blocks say, so the line is "저절로" and needs no hand. */
export function followsFaults(
  x: Extract<Expectation, { kind: "diagnosis" }>,
  doc: ScenarioDoc,
): boolean {
  const a = answerFromFaults(doc);
  const same = (p: readonly string[], q: readonly string[]) =>
    p.length === q.length && p.every((v) => q.includes(v));
  return a.faultType.length > 0 && same(x.rootCause, a.rootCause) && same(x.faultType, a.faultType);
}

const names = (ids: readonly string[], index?: BlueprintIndex) =>
  ids.map((id) => index?.find(id)?.name ?? id).join(", ");

function actionTokens(
  x: Extract<Expectation, { kind: "required_action" | "forbidden_action" }>,
  index?: BlueprintIndex,
): Token[] {
  const target = x.target ? ` (${index?.find(x.target)?.name ?? x.target})` : "";
  return [word(`${ACTION_LABELS[x.action]}${target}`)];
}

const pointsOf = (x: Expectation): Token =>
  "weight" in x
    ? num("weight", x.weight, "점", 0, 100, "점수")
    : num("penalty", x.penalty, "점", 0, 100, "한 번마다 깎는 점수");

/** The tokens after the points, for the kinds whose sentence needs no document: time and tool limits. */
function limitTokens(x: Extract<Expectation, { kind: "time_limit" | "tool_budget" }>): Token[] {
  return x.kind === "time_limit"
    ? [
        text(" · "),
        num("minutes", Math.round(x.seconds / 60), "분", 1, 600, "제한 시간"),
        text(" 안에 진단하면"),
      ]
    : [
        text(" · 툴 호출이 "),
        num("maxCalls", x.maxCalls, "번", 1, 500, "툴 호출 상한"),
        text(" 이하면"),
      ];
}

function diagnosisSentence(
  x: Extract<Expectation, { kind: "diagnosis" }>,
  doc: ScenarioDoc,
  index?: BlueprintIndex,
): Sentence {
  return {
    id: x.id,
    tone: "earn",
    tokens: [
      pointsOf(x),
      text(" · 원인이 "),
      word(names(x.rootCause, index) || "장비를 골라 주세요"),
      text(", 고장이 "),
      word(x.faultType.map(faultLabel).join(", ") || "종류를 골라 주세요"),
      text("라고 진단하면"),
    ],
    ...(followsFaults(x, doc) ? { source: "고장 블록에서 저절로" } : {}),
  };
}

/** One expectation as a sentence. The points are the first token for lines that earn or lose them. */
export function sentenceOf(x: Expectation, doc: ScenarioDoc, index?: BlueprintIndex): Sentence {
  switch (x.kind) {
    case "diagnosis":
      return diagnosisSentence(x, doc, index);
    case "final_state": {
      const said = x.label?.trim() || (index ? conditionLine(x.condition, index) : "");
      return {
        id: x.id,
        tone: "earn",
        tokens: [
          pointsOf(x),
          text(" · 끝났을 때 "),
          word(said || "상태를 정해 주세요"),
          text("이면"),
        ],
      };
    }
    case "required_action":
      return {
        id: x.id,
        tone: "earn",
        tokens: [pointsOf(x), text(" · 이 조치를 하면 — "), ...actionTokens(x, index)],
      };
    case "forbidden_action":
      return {
        id: x.id,
        tone: "lose",
        tokens: [
          text("−"),
          pointsOf(x),
          text(" · 이 조치를 하면 한 번마다 — "),
          ...actionTokens(x, index),
        ],
      };
    case "time_limit":
    case "tool_budget":
      return { id: x.id, tone: "earn", tokens: [pointsOf(x), ...limitTokens(x)] };
  }
}

/** The sentences that are not lines of the sheet but how the whole sheet is read: recovery first, the runbook. */
export function scoringNotes(doc: ScenarioDoc): string[] {
  const out: string[] = [];
  if (doc.scoring === "recovery") {
    const w = RECOVERY_WEIGHTS;
    out.push(
      `서비스를 얼마나 빨리 되살렸는지로 채점해요 — 복구 시간 ${w.time}점, 복구 순서 ${w.order}점, 복구 중 악화 없음 ${w.worsen}점, 진단과 보고 ${w.report}점. 아래 줄은 진단과 하면 안 되는 일, 복구가 이어지는지를 정해요.`,
    );
  }
  const steps = doc.runbook?.steps.length ?? 0;
  if (steps > 0)
    out.push(
      `절차서 ${steps}단계를 순서대로 따랐는지도 봐요 — 점수에는 섞이지 않고 결과에 "절차서 준수"로 따로 나와요.`,
    );
  return out;
}

/** The sentence at the head of the sheet: what a pass takes, then what the lines add up to. */
export function passSentence(): string {
  return PASS_RULE_TEXT;
}
