import type { Score } from "@terrarium/core/oracle";
import { describe, expect, test } from "vitest";
import { recoveryFigures } from "./recovery";

const scored = (over: Record<string, unknown>): Score =>
  ({
    version: "3",
    scoring: "recovery",
    recovery: {
      services: ["portal"],
      impairedAt: 600,
      recoveredAt: 640,
      endAt: 900,
      recovered: true,
      byAgent: false,
      seconds: 40,
      agentSeconds: 40,
      worsened: [],
      acts: 0,
      costKrw: 0,
      delayHours: 0,
      ...over,
    },
    total: 30,
    earned: 30,
    penalty: 0,
    possible: 100,
    passed: false,
    items: [],
    summary: "",
  }) as unknown as Score;

describe("클러스터가 알아서 한 복구는 결과 화면에서 따로 말한다 [REQ-095] [REQ-088]", () => {
  test("에이전트가 한 복구가 아니고 클러스터가 승격한 것이라고 적는다", () => {
    const figure = recoveryFigures(scored({ byCluster: true, clusterAfterSeconds: 30 }))[1];
    expect(figure?.value).toBe("클러스터가 알아서 복구");
    expect(figure?.hint).toContain("30초 만에 스스로 승격");
    expect(figure?.hint).toContain("에이전트가 한 복구가 아니라서");
  });

  test("누구의 복구도 아니면 안 됨, 에이전트의 복구면 복구됨이다", () => {
    expect(recoveryFigures(scored({}))[1]?.value).toBe("안 됨");
    expect(recoveryFigures(scored({ byAgent: true }))[1]?.value).toBe("복구됨");
  });
});
