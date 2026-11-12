import { describe, expect, it } from "vitest";
import { groupWorkers, type Worker, workersLine } from "./activity";

const worker = (n: number, over: Partial<Worker> = {}): Worker => ({
  runId: `r${n}`,
  who: {
    experimentId: "e-1",
    owner: "하늘",
    agent: "운영 (규칙 기반)",
    harness: "내장 기준 에이전트",
    experiment: "IAP 실험용 · 권장 실험",
  },
  hue: n % 8,
  calls: 0,
  trail: [],
  startedAt: 0,
  lastAt: n,
  ...over,
});

describe("지금 일하는 에이전트 [REQ-111]", () => {
  it("[REQ-111] 접힌 한 줄은 '에이전트 5개가 일하는 중'이다", () => {
    expect(workersLine(5)).toBe("에이전트 5개가 일하는 중");
  });

  it("[REQ-111] 똑같은 에이전트 다섯은 한 줄에 ×5로 묶인다", () => {
    const groups = groupWorkers(
      [1, 2, 3, 4, 5].map((n) => worker(n)),
      0,
      () => undefined,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.count).toBe(5);
    expect(groups[0]?.title).toBe("운영 (규칙 기반)");
  });

  it("[REQ-111] 다른 일을 하는 에이전트는 따로 남고, 눌렀을 때 갈 곳은 장비를 말한 가장 최근 런이다", () => {
    const groups = groupWorkers(
      [worker(1, { at: "rack-1" }), worker(2, { at: "rack-1" }), worker(3, { at: "rack-9" })],
      0,
      (id) => id,
    );
    expect(groups.map((g) => g.count).sort()).toEqual([1, 2]);
    expect(groups.find((g) => g.count === 2)?.pick).toBe("r2");
  });
});
