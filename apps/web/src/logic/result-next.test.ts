import type { Summary } from "@terrarium/core/analysis";
import type { RunSummary } from "@terrarium/core/contract";
import { describe, expect, test } from "vitest";
import { ENOUGH_SITUATIONS, suggestions, WIDE_INTERVAL } from "./result-next";
import { seedRows } from "./seed-rows";

const summary = (ci95: number, n = 5): Summary => ({
  n,
  mean: 70,
  median: 70,
  stdev: 10,
  min: 40,
  max: 90,
  ci95,
});

const run = (seed: number, repeat: number, passed: boolean): RunSummary => ({
  id: `r-${seed}-${repeat}`,
  index: 0,
  seed,
  repeat,
  status: "completed",
  queuedAt: "t",
  score: passed ? 90 : 40,
  passed,
});

const mixed = seedRows([run(1, 1, true), run(1, 2, true), run(2, 1, true), run(2, 2, false)]);
const stuck = seedRows([
  run(1, 1, true),
  run(1, 2, true),
  run(4, 1, false),
  run(4, 2, false),
  run(4, 3, false),
]);

const base = { experimentId: "e-1", situations: 5, rows: mixed };

describe("what to try next [REQ-037]", () => {
  test("[REQ-037] a wide interval over few situations suggests more situations, with the count in the fork's address", () => {
    const [first] = suggestions({ ...base, score: summary(19.7) });
    expect(first).toMatchObject({
      id: "more-situations",
      title: `상황을 ${ENOUGH_SITUATIONS}개로 늘려 돌리기`,
      to: { name: "newExperiment", forkOf: "e-1", runs: ENOUGH_SITUATIONS },
    });
    expect(first?.why).toBe("오차 ±19.7점은 넓어요. 상황이 늘면 좁아져요.");
  });

  test("[REQ-037] a narrow interval, enough situations, or no interval at all suggest no more situations", () => {
    const ids = (input: Parameters<typeof suggestions>[0]) => suggestions(input).map((s) => s.id);
    expect(ids({ ...base, score: summary(WIDE_INTERVAL - 0.1) })).toEqual(["swap-agent"]);
    expect(ids({ ...base, situations: ENOUGH_SITUATIONS, score: summary(30) })).toEqual([
      "swap-agent",
    ]);
    expect(ids({ ...base, score: summary(30, 1) })).toEqual(["swap-agent"]);
    expect(ids({ ...base })).toEqual(["swap-agent"]);
  });

  test("[REQ-037] a situation that failed every time is a suggestion that goes to its first run", () => {
    const found = suggestions({ ...base, rows: stuck }).find((s) => s.id === "look-at-one");
    expect(found).toMatchObject({
      title: "상황 4만 들여다보기",
      why: "3번 모두 합격하지 못했어요.",
      to: { name: "run", id: "r-4-1" },
    });
  });

  test("[REQ-037] one failed run, or runs that split, are not 'failed every time'", () => {
    const once = seedRows([run(1, 1, false), run(2, 1, true)]);
    expect(suggestions({ ...base, rows: once }).map((s) => s.id)).toEqual(["swap-agent"]);
    expect(suggestions({ ...base }).map((s) => s.id)).toEqual(["swap-agent"]);
  });

  test("[REQ-037] swapping the agent is always there, a fork of this experiment, last", () => {
    const all = suggestions({ ...base, rows: stuck, score: summary(25) });
    expect(all.map((s) => s.id)).toEqual(["more-situations", "look-at-one", "swap-agent"]);
    expect(all.length).toBeLessThanOrEqual(3);
    expect(all[2]).toMatchObject({
      to: { name: "newExperiment", forkOf: "e-1" },
      why: "같은 상황 5개로 돌려 나란히 봐요.",
    });
  });

  test("[REQ-037] an operation, which has no score, is offered only the swap", () => {
    const all = suggestions({ ...base, rows: stuck, score: summary(25), operation: true });
    expect(all.map((s) => s.id)).toEqual(["swap-agent"]);
  });
});
