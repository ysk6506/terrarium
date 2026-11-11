import type { RunSummary } from "@terrarium/core/contract";
import { describe, expect, test } from "vitest";
import { DOT_LABELS, DOT_MARKS, rangeText, seedRows } from "./seed-rows";

const run = (
  seed: number,
  repeat: number,
  status: RunSummary["status"],
  score: number | null,
  passed = false,
): RunSummary => ({
  id: `r-${seed}-${repeat}`,
  index: 0,
  seed,
  repeat,
  status,
  queuedAt: "t",
  score,
  passed,
});

describe("the runs folded by seed, a dot for each time [REQ-118]", () => {
  const rows = seedRows([
    run(1, 1, "completed", 90.9, true),
    run(2, 1, "completed", 18.2),
    run(1, 2, "completed", 61.8),
    run(2, 2, "completed", 18.2),
    run(1, 3, "running", null),
  ]);

  test("one row per seed in the order they came, dots in the order they ran", () => {
    expect(rows.map((r) => [r.seed, r.dots.map((d) => d.state)])).toEqual([
      [1, ["pass", "fail", "waiting"]],
      [2, ["fail", "fail"]],
    ]);
  });

  test("a seed that passed and failed is split, and the range is of the finished runs", () => {
    expect(rows.map((r) => r.split)).toEqual([true, false]);
    expect(rangeText(rows[0]?.range)).toBe("61.8~90.9점");
    expect(rangeText(rows[1]?.range)).toBe("18.2점");
    expect(rangeText(undefined)).toBe("—");
  });

  test("every kind of dot has its own mark and its own words, so colour is never the only difference", () => {
    const states = Object.keys(DOT_LABELS) as (keyof typeof DOT_LABELS)[];
    expect(new Set(states.map((s) => DOT_MARKS[s])).size).toBe(states.length);
    expect(new Set(states.map((s) => DOT_LABELS[s])).size).toBe(states.length);
  });
});
