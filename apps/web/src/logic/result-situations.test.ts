import type { RunSummary } from "@terrarium/core/contract";
import { describe, expect, test } from "vitest";
import {
  cellOf,
  cellText,
  repeatHeaders,
  rowTag,
  shakeLine,
  situationCounts,
  situationsSentence,
  sourceOfDifference,
} from "./result-situations";
import { seedRows } from "./seed-rows";

const run = (
  seed: number,
  repeat: number,
  score: number | null,
  passed: boolean,
  status: RunSummary["status"] = "completed",
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

const rows = seedRows([
  run(1, 1, 90.9, true),
  run(1, 2, 90.9, true),
  run(2, 1, 90.9, true),
  run(2, 2, 47.3, false),
  run(3, 1, 47.3, false),
  run(3, 2, 47.3, false),
  run(4, 1, null, false, "running"),
  run(4, 2, null, false, "queued"),
]);

describe("the situations of a result [REQ-118]", () => {
  test("[REQ-118] repeats say how many situations split, counting only situations with a finished run", () => {
    expect(situationCounts(rows)).toEqual({ situations: 3, split: 1 });
    expect(situationsSentence(rows, 2)).toBe(
      "같은 상황을 2번씩 돌렸어요. 3개 중 1개에서 결과가 갈렸어요.",
    );
  });

  test("[REQ-118] one run for each situation says that, and no split is claimed", () => {
    expect(situationsSentence(seedRows([run(1, 1, 80, true), run(2, 1, 20, false)]), 1)).toBe(
      "상황마다 한 번씩 돌렸어요.",
    );
  });

  test("[REQ-118] repeats with no split say every situation came out the same; nothing finished says no count", () => {
    const same = seedRows([
      run(1, 1, 80, true),
      run(1, 2, 80, true),
      run(2, 1, 20, false),
      run(2, 2, 20, false),
    ]);
    expect(situationsSentence(same, 2)).toBe(
      "같은 상황을 2번씩 돌렸어요. 2개 모두 결과가 같았어요.",
    );
    expect(situationsSentence(seedRows([run(1, 1, null, false, "running")]), 3)).toBe(
      "같은 상황을 3번씩 돌렸어요.",
    );
  });

  test("[REQ-118] a column for each time, or one column when each ran once", () => {
    expect(repeatHeaders(rows, 2)).toEqual(["1번째", "2번째"]);
    expect(repeatHeaders(rows, 3)).toEqual(["1번째", "2번째", "3번째"]);
    expect(repeatHeaders(seedRows([run(1, 1, 80, true)]), 1)).toEqual(["결과"]);
  });

  test("[REQ-118] a cell is the score with 합격 or 불합격, or where the run is", () => {
    const first = rows[0];
    expect(first && cellOf(first, 1) && cellText(cellOf(first, 1) as never)).toBe("90.9 합격");
    const second = rows[1];
    expect(cellText(cellOf(second as never, 2) as never)).toBe("47.3 불합격");
    const going = rows[3];
    expect(cellText(cellOf(going as never, 1) as never)).toBe("기다리는 중");
    expect(cellOf(first as never, 3)).toBeUndefined();
  });

  test("[REQ-118] a split situation is tagged 갈렸어요; one that never passed in two or more runs is 늘 불합격", () => {
    expect(rows.map(rowTag)).toEqual([undefined, "갈렸어요", "늘 불합격", undefined]);
    expect(rowTag(seedRows([run(9, 1, 10, false)])[0] as never)).toBeUndefined();
  });

  test("[REQ-118] the shaking line and the source of the differences come from the core's numbers and sentences", () => {
    expect(shakeLine(4.25)).toBe("같은 상황에서도 점수가 ±4.3점 흔들려요.");
    expect(shakeLine(undefined)).toBeUndefined();
    const found = sourceOfDifference([
      "15번 중 7번 합격 (47%)",
      "점수 차이는 주로 상황이 달라서 생겨요 — 상황을 늘려 보세요",
      "실행마다 점수가 크게 달라요 (표준편차 20점)",
    ]);
    expect(found).toBe("점수 차이는 주로 상황이 달라서 생겨요 — 상황을 늘려 보세요");
    expect(sourceOfDifference(["실행마다 점수가 크게 달라요 (표준편차 20점)"])).toBeUndefined();
  });
});
