import { type Expectation, emptyScenario } from "@terrarium/core/scenario";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { campusBlueprint } from "../../../../../packages/core/src/world/test-support/sample-campus";
import { scenario as sc } from "..";

const index = new BlueprintIndex(campusBlueprint());
const doc = emptyScenario("s", "campus");
const said = (x: Expectation, withIndex = true) =>
  sc
    .sentenceOf(x, doc, withIndex ? index : undefined)
    .tokens.map((t) => (t.kind === "number" ? `${t.value}${t.unit}` : t.text))
    .join("");

describe("each kind of score line is a sentence [REQ-034] [REQ-071]", () => {
  test("[REQ-034] a final-state line says the label it was given, or asks for a state", () => {
    const base = { id: "x", kind: "final_state", weight: 20 } as const;
    const cond = { kind: "alarm", active: false } as never;
    expect(said({ ...base, label: " 경보가 꺼졌다 ", condition: cond } as never)).toContain(
      "끝났을 때 경보가 꺼졌다이면",
    );
    expect(said({ ...base, condition: cond } as never, false)).toContain("상태를 정해 주세요");
  });

  test("[REQ-034] a required action names the action and its target, with or without a world to look it up in", () => {
    const x = { id: "x", kind: "required_action", action: "power_off", weight: 10, target: "zzz" };
    expect(said(x as never)).toContain("zzz");
    expect(said({ ...x, target: undefined } as never, false)).toContain("이 조치를 하면");
    expect(sc.sentenceOf(x as never, doc, index).tone).toBe("earn");
  });

  test("[REQ-071] the notes name the recovery weights and count the runbook steps", () => {
    const recovery = sc.scoringNotes({ ...doc, scoring: "recovery" } as never);
    expect(recovery).toHaveLength(2);
    const withRunbook = sc.scoringNotes({
      ...doc,
      runbook: { steps: [{ id: "a", todo: "t", tools: [] }] },
    } as never);
    expect(withRunbook).toHaveLength(1);
    expect(withRunbook[0]).toContain("절차서 1단계");
  });
});
