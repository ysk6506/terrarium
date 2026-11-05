/**
 * The scenario editor's words (REQ-071, ADR-0071/0072): every name, label and help text a person reads in the editor follows
 * the glossary: none of the words it retired, no internal code, no JSON, no stiff "~니다" sentence.
 */
import { ACTION_LABELS, BLOCK_SPECS, CATEGORY_LABELS, paletteFor } from "@terrarium/core/scenario";
import { baselineRun } from "@terrarium/core/session";
import { BlueprintIndex, FAULT_SPECS, MISTAKE_SPECS } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { campusBlueprint } from "../../../../packages/core/src/world/test-support/sample-campus";
import { scenario as sc } from ".";

/** The glossary's 쓰지 않는 말 for the editor (docs/design-docs/glossary.md). */
const RETIRED = [
  "장애",
  "주입",
  "해제",
  "투입되",
  "도구",
  "삭제",
  "수정",
  "취소",
  "월드",
  "배점",
  "까닭",
  "경보",
  "가동",
  "한도",
  "참이 되면",
  "모두 참",
  "노출",
];

const index = new BlueprintIndex(campusBlueprint());

/** Every sentence and name of the editor that is written once, in code, for people. */
function editorWords(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const add = (where: string, text: string | undefined) => {
    if (text) out.push([where, text]);
  };
  for (const item of paletteFor(index)) {
    add(`팔레트 ${item.key} 이름`, item.label);
    add(`팔레트 ${item.key} 설명`, item.description);
    add(`팔레트 ${item.key} 이유`, item.reason);
    add(`팔레트 ${item.key} 묶음`, item.group);
  }
  for (const spec of BLOCK_SPECS) {
    add(`블록 ${spec.type} 이름`, spec.label);
    add(`블록 ${spec.type} 설명`, spec.description);
    add(`블록 ${spec.type} 못 쓰는 이유`, spec.plannedReason);
    for (const p of spec.params) {
      add(`블록 ${spec.type}.${p.name} 이름`, p.label);
      add(`블록 ${spec.type}.${p.name} 도움말`, p.help);
    }
  }
  for (const [k, v] of Object.entries(sc.EXPECTATION_LABELS)) add(`채점 항목 ${k}`, v);
  for (const [k, v] of Object.entries(CATEGORY_LABELS)) add(`묶음 ${k}`, v);
  for (const [k, v] of Object.entries(ACTION_LABELS)) add(`조치 ${k}`, v);
  for (const f of [...FAULT_SPECS, ...MISTAKE_SPECS]) {
    add(`고장 ${f.type} 이름`, f.label);
    add(`고장 ${f.type} 설명`, f.description);
    for (const p of f.params) add(`고장 ${f.type}.${p.name}`, p.label);
  }
  for (const id of ["idle", "guess", "knows"] as const) {
    const run = baselineRun(id, 0, false);
    add(`기준 에이전트 ${id} 이름`, run.label);
    add(`기준 에이전트 ${id} 설명`, run.what);
  }
  for (const [k, v] of Object.entries(sc.CONDITION_KIND_LABELS)) add(`조건 ${k}`, v);
  for (const [k, v] of Object.entries(sc.OP_LABELS)) add(`비교 ${k}`, v);
  for (const c of sc.RECOVERY_CHOICES) add(`복구 방식 ${c.value}`, c.label);
  return out;
}

describe("the editor's words follow the glossary [REQ-071]", () => {
  const words = editorWords();

  test("there is plenty to check, from the palette to the reference agents", () => {
    expect(words.length).toBeGreaterThan(150);
  });

  test("none of the words the glossary retired is left [REQ-071]", () => {
    const found = words.flatMap(([where, text]) =>
      RETIRED.filter((w) => text.includes(w)).map((w) => `${where}: '${w}' in '${text}'`),
    );
    expect(found).toEqual([]);
  });

  test("no internal code, JSON or stiff sentence shows [REQ-071]", () => {
    const found = words.flatMap(([where, text]) => {
      const bad: string[] = [];
      if (/_[a-z]/.test(text)) bad.push("영문 코드");
      if (text.includes('{"')) bad.push("JSON");
      if (/니다[.!?]?$/.test(text.trim())) bad.push("~니다");
      return bad.map((b) => `${where}: ${b} in '${text}'`);
    });
    expect(found).toEqual([]);
  });

  test("the palette starts with what happens, then settings, flow and the agent [REQ-071]", () => {
    expect(Object.values(CATEGORY_LABELS)).toEqual(["고장", "설정 바꾸기", "흐름", "에이전트"]);
    const block = (type: string) => BLOCK_SPECS.find((b) => b.type === type);
    expect(block("inject_fault")?.label).toBe("고장 발생");
    expect(block("clear_fault")?.label).toBe("고장 복구");
    expect(block("agent_task")?.params.map((p) => p.label)).toEqual([
      "상황 설명",
      "툴 호출 상한",
      "제한 시간",
    ]);
  });
});
