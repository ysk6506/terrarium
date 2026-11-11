import type { CriterionRate } from "@terrarium/core/analysis";
import { describe, expect, test } from "vitest";
import { lossRows, lossSentence } from "./result-loss";

const crit = (
  id: string,
  label: string,
  meanPoints: number,
  max: number,
  rate: number,
): CriterionRate => ({
  id,
  label,
  kind: "x",
  rate,
  meanPoints,
  max,
});

const sheet = [
  crit("a", "영향권 서버 지키기", 20, 20, 1),
  crit("b", "진단", 42.7, 60, 0.5),
  crit("c", "설정 온도 낮추기", 0, 10, 0),
  crit("d", "진단 시간", 7.5, 10, 0.75),
];

describe("where the points went [REQ-037]", () => {
  test("[REQ-037] the criteria come most lost first, and each track is as long as its points", () => {
    const rows = lossRows(sheet);
    expect(rows.map((r) => r.label)).toEqual([
      "진단",
      "설정 온도 낮추기",
      "진단 시간",
      "영향권 서버 지키기",
    ]);
    const diag = rows[0];
    expect(diag?.track).toBe(1);
    expect(diag?.fill).toBeCloseTo(42.7 / 60, 5);
    expect(diag?.text).toBe("42.7 / 60");
    expect(rows[1]?.track).toBeCloseTo(10 / 60, 5);
    expect(rows[1]?.text).toBe("0 / 10");
    expect(rows[3]?.lost).toBe(0);
  });

  test("[REQ-037] the sentence names the criterion that lost the most and its share of what was lost", () => {
    const rows = lossRows(sheet);
    // lost: 17.3 + 10 + 2.5 = 29.8; the top one is 17.3 of it
    expect(lossSentence(rows, 15)).toBe(
      "가장 많이 잃은 곳은 진단이에요. 잃은 점수의 58%가 여기서 나왔어요.",
    );
  });

  test("[REQ-037] a criterion missed in every run says so with the number of runs", () => {
    const rows = lossRows([crit("c", "설정 온도 낮추기", 0, 10, 0), crit("a", "진단", 55, 60, 1)]);
    expect(lossSentence(rows, 15)).toBe(
      "가장 많이 잃은 곳은 설정 온도 낮추기예요. 잃은 점수의 67%가 여기서 나왔어요. 15번 모두 점수를 받지 못했어요.",
    );
  });

  test("[REQ-037] when only one criterion lost points, all of the loss is said to be there", () => {
    const rows = lossRows([crit("a", "진단", 50, 60, 0.8), crit("b", "시간", 10, 10, 1)]);
    expect(lossSentence(rows, 5)).toBe(
      "가장 많이 잃은 곳은 진단이에요. 잃은 점수가 모두 여기서 나왔어요.",
    );
  });

  test("[REQ-037] nothing is invented when nothing was lost, or when there is nothing to read", () => {
    const rows = lossRows([crit("a", "진단", 60, 60, 1), crit("b", "시간", 9.99, 10, 1)]);
    expect(lossSentence(rows, 5)).toBe("잃은 점수가 없어요. 모든 항목에서 만점을 받았어요.");
    expect(lossSentence([], 0)).toBe("");
  });

  test("[REQ-037] a penalty takes points away and has no track; one every run suffered says so", () => {
    const rows = lossRows([
      crit("a", "진단", 60, 60, 1),
      crit("p", "건드리면 안 되는 장비", -5, 0, 0),
    ]);
    const penalty = rows[0];
    expect(penalty?.label).toBe("건드리면 안 되는 장비");
    expect(penalty).toMatchObject({ penalty: true, track: 0, lost: 5, missedAll: true });
    expect(penalty?.text).toBe("−5점");
    expect(lossSentence(rows, 4)).toContain("4번 모두 감점됐어요.");
    expect(lossRows([crit("p", "건드리면 안 되는 장비", 0, 0, 1)])[0]?.text).toBe("감점 없음");
  });
});
