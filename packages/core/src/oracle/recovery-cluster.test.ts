import type { RunEvent } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { analyzeRecovery } from "./recovery";
import { recoveryAxes } from "./recovery-score";

const raise = (t: number, seq: number): RunEvent => ({
  kind: "world",
  seq,
  t,
  cause: "physics",
  command: {
    type: "alarm.raise",
    alarm: {
      id: "service_down:svc",
      entityId: "svc",
      code: "service_down",
      kind: "service",
      severity: "critical",
      message: "x",
      since: t,
    },
  },
});
const clear = (t: number, seq: number): RunEvent => ({
  kind: "world",
  seq,
  t,
  cause: "physics",
  command: { type: "alarm.clear", alarmId: "service_down:svc" },
});
const promote = (t: number, seq: number, cause = "cluster"): RunEvent => ({
  kind: "world",
  seq,
  t,
  cause,
  command: { type: "db.promote", target: "db-2" },
});
const start = (t: number, seq: number): RunEvent => ({
  kind: "score",
  seq,
  t,
  what: "agent_start",
  scenarioStart: 0,
});
const act = (t: number, seq: number): RunEvent => ({
  kind: "tool",
  seq,
  t,
  tool: "db_promote",
  args: {},
  ok: true,
  effect: "act",
  targets: [],
  summary: "",
});

const HARMS = [{ id: "svc", perHourKrw: 1_000_000 }];

describe("a recovery the cluster made is told apart from the agent's [REQ-095] [REQ-088]", () => {
  test("a promotion with the cause cluster between the trouble and the recovery is the cluster's", () => {
    const events = [start(0, 0), raise(10, 1), promote(40, 2), clear(40, 3)];
    const r = analyzeRecovery(events, HARMS, 100);
    expect(r).toMatchObject({ recovered: true, byAgent: false, byCluster: true });
    expect(r.clusterAfterSeconds).toBe(30);
  });

  test("the agent's own promotion is the agent's, whatever the cause field of other events says", () => {
    const events = [
      start(0, 0),
      raise(10, 1),
      act(20, 2),
      promote(20, 3, "tool:db_promote"),
      clear(20, 4),
    ];
    const r = analyzeRecovery(events, HARMS, 100);
    expect(r).toMatchObject({ byAgent: true, byCluster: false });
  });

  test("an agent that acts and then the cluster heals later does not get the recovery", () => {
    const events = [start(0, 0), raise(10, 1), act(15, 2), promote(40, 3), clear(40, 4)];
    expect(analyzeRecovery(events, HARMS, 100)).toMatchObject({ byAgent: false, byCluster: true });
  });

  test("the cluster's recovery earns no points on time and order, and the sheet says why", () => {
    const events = [start(0, 0), raise(10, 1), promote(40, 2), clear(40, 3)];
    const r = analyzeRecovery(events, HARMS, 100);
    const axes = recoveryAxes(r, true, () => "svc");
    expect(axes.map((a) => a.points)).toEqual([0, 0, 0]);
    expect(axes[0]?.detail).toContain("클러스터가 알아서");
    expect(axes[1]?.detail).toContain("클러스터가 알아서");
  });

  test("a service that was never in trouble is nobody's recovery", () => {
    const r = analyzeRecovery([start(0, 0), promote(5, 1)], HARMS, 100);
    expect(r).toMatchObject({ byAgent: false, byCluster: false, recovered: false });
  });
});
