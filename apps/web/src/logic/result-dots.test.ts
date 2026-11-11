import type { RunSummary } from "@terrarium/core/contract";
import { PASS_MARK } from "@terrarium/core/oracle";
import { describe, expect, test } from "vitest";
import { dotCounts, dotStacks, legendItems, PASS_LINE, plotLabel, tallest } from "./result-dots";

const run = (
  n: number,
  score: number | null,
  passed: boolean,
  status: RunSummary["status"] = "completed",
): RunSummary => ({
  id: `r${n}`,
  index: n,
  seed: n,
  repeat: 1,
  status,
  queuedAt: "t",
  score,
  passed,
});

const sample = [
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => run(n, 90.9, true)),
  ...[8, 9, 10].map((n) => run(n, 61.8, false)),
  ...[11, 12, 13, 14, 15].map((n) => run(n, 47.3, false)),
];

describe("the dots of a result [REQ-037]", () => {
  test("[REQ-037] one dot for each finished run, scores that coincide piled in one column", () => {
    const stacks = dotStacks(sample);
    expect(stacks.map((s) => [Math.round(s.at * 10) / 10, s.dots.length])).toEqual([
      [47.3, 5],
      [61.8, 3],
      [90.9, 7],
    ]);
    expect(dotCounts(stacks)).toEqual({ pass: 7, fail: 8 });
    expect(tallest(stacks)).toBe(7);
  });

  test("[REQ-037] runs that are not finished, or have no score, are not dots", () => {
    const stacks = dotStacks([
      run(1, 80, true),
      run(2, null, false, "running"),
      run(3, null, false, "queued"),
      run(4, 12, false, "failed"),
      run(5, 33, false, "cancelled"),
    ]);
    expect(dotCounts(stacks)).toEqual({ pass: 1, fail: 0 });
    expect(dotStacks([])).toEqual([]);
  });

  test("[REQ-037] scores a hair apart share a column, a failed run of a column sits under a passed one", () => {
    const stacks = dotStacks([run(1, 61, true), run(2, 62.5, false), run(3, 30, false)]);
    expect(stacks).toHaveLength(2);
    expect(stacks[1]?.dots.map((d) => d.kind)).toEqual(["fail", "pass"]);
    expect(stacks[1]?.dots.map((d) => d.runId)).toEqual(["r2", "r1"]);
    expect(stacks[1]?.at).toBeCloseTo(61.75, 5);
  });

  test("[REQ-037] a score outside 0 to 100 is drawn at the end of the line", () => {
    const stacks = dotStacks([run(1, 120, true), run(2, -5, false)]);
    expect(stacks.map((s) => s.at)).toEqual([0, 100]);
  });

  test("[REQ-037] the label states the counts, the pass line and the range; the legend has three items", () => {
    const label = plotLabel(sample, dotStacks(sample));
    expect(label).toContain("실행 15번의 점수 분포");
    expect(label).toContain("합격 7번, 불합격 8번");
    expect(label).toContain(`합격선은 ${PASS_MARK}점`);
    expect(label).toContain("47.3점에서 90.9점까지");
    expect(PASS_LINE).toBe(PASS_MARK);
    const legend = legendItems({ pass: 7, fail: 8 });
    expect(legend.map((l) => l.text)).toEqual([
      "합격 7번",
      "불합격 8번",
      "점 하나가 실행 한 번이에요",
    ]);
  });
});
