import type { ScenarioDoc } from "@terrarium/core/scenario";
import { describe, expect, test } from "vitest";
import { type BaselineId, baselineRun, FLOOR_LIMIT, judge, knownAnswer } from ".";

const runs = (scores: Partial<Record<BaselineId, [number | null, boolean]>>) =>
  (Object.entries(scores) as Array<[BaselineId, [number | null, boolean]]>).map(
    ([id, [total, passed]]) => baselineRun(id, total, passed),
  );

const docWith = (expectations: unknown[]) => ({ expectations }) as unknown as ScenarioDoc;

describe("the sheet's own answer is what the agent that knows says [REQ-070]", () => {
  test("the first accepted root cause and fault type", () => {
    const sheet = docWith([
      {
        id: "d",
        kind: "diagnosis",
        rootCause: ["pdu-a", "pdu-b"],
        faultType: ["breaker_trip"],
        weight: 40,
      },
    ]);
    expect(knownAnswer(sheet)).toEqual({ rootCause: "pdu-a", faultType: "breaker_trip" });
  });

  test("a sheet that lists nothing accepted gives empty words, and one without a diagnosis gives none", () => {
    expect(
      knownAnswer(
        docWith([{ id: "d", kind: "diagnosis", rootCause: [], faultType: [], weight: 1 }]),
      ),
    ).toEqual({
      rootCause: "",
      faultType: "",
    });
    expect(knownAnswer(docWith([]))).toBeUndefined();
  });
});

describe("three scores become a plain verdict on the scenario [REQ-070]", () => {
  test("a scenario that tells agents apart has nothing to warn about", () => {
    const verdict = judge(runs({ idle: [0, false], guess: [0, false], knows: [60, true] }), true);
    expect(verdict.warnings).toEqual([]);
    expect(verdict).toMatchObject({ floor: 0, diagnosisOnly: 60 });
  });

  test("without a diagnosis on the sheet the agent that knows cannot run, and that is all it says", () => {
    const verdict = judge(runs({ idle: [0, false], guess: [0, false] }), false);
    expect(verdict.warnings).toEqual([
      "진단 채점 항목이 없어서 정답만 아는 기준 에이전트를 돌리지 못했어요",
    ]);
    expect(verdict.diagnosisOnly).toBe(0);
  });

  test("doing nothing and guessing are each told apart", () => {
    const idleScores = judge(
      runs({ idle: [FLOOR_LIMIT + 5, false], guess: [0, false], knows: [90, true] }),
      true,
    );
    expect(idleScores.warnings.join("\n")).toContain(
      `아무것도 안 해도 ${FLOOR_LIMIT + 5}점을 받아요`,
    );
    expect(idleScores.warnings.join("\n")).not.toContain("찍어도");
    const guessScores = judge(
      runs({ idle: [0, false], guess: [FLOOR_LIMIT + 1, false], knows: [90, true] }),
      true,
    );
    expect(guessScores.warnings.join("\n")).toContain(
      `아무 답이나 찍어도 ${FLOOR_LIMIT + 1}점을 받아요`,
    );
    expect(guessScores.floor).toBe(FLOOR_LIMIT + 1);
  });

  test("an agent that knows nothing and still passes is a warning", () => {
    expect(
      judge(runs({ idle: [0, true], guess: [0, false], knows: [90, true] }), true).warnings,
    ).toContain("아무것도 모르는 에이전트가 합격해요");
    expect(
      judge(runs({ idle: [0, false], guess: [0, true], knows: [90, true] }), true).warnings,
    ).toContain("아무것도 모르는 에이전트가 합격해요");
  });

  test("full marks for the answer alone mean the scenario measures diagnosis and not operation", () => {
    const verdict = judge(runs({ idle: [0, false], guess: [0, false], knows: [100, true] }), true);
    expect(verdict.warnings.some((w) => w.startsWith("정답만 말하면 만점이에요"))).toBe(true);
  });

  test("knowing the answer must be worth clearly more than not knowing", () => {
    const verdict = judge(runs({ idle: [20, false], guess: [5, false], knows: [28, false] }), true);
    expect(verdict.warnings).toContain("정답을 알아도 28점뿐이라 모르는 쪽(20점)과 차이가 작아요");
  });

  test("a run that has no score yet counts as zero", () => {
    const verdict = judge(
      runs({ idle: [null, false], guess: [null, false], knows: [null, false] }),
      true,
    );
    expect(verdict.floor).toBe(0);
    expect(verdict.diagnosisOnly).toBe(0);
  });
});
