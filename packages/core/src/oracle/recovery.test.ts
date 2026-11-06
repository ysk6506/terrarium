import type { RunEvent } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { analyzeRecovery } from "./recovery";
import {
  FULL_ORDER_S,
  FULL_RECOVERY_S,
  RECOVERY_WEIGHTS,
  ramp,
  recoveryAxes,
  ZERO_ORDER_S,
  ZERO_RECOVERY_S,
} from "./recovery-score";

type WithoutSeq = RunEvent extends infer E ? (E extends RunEvent ? Omit<E, "seq"> : never) : never;

/** A small builder of run events: services raise and clear their alarms, the agent looks and acts. */
class Log {
  readonly events: RunEvent[] = [];
  private push(e: WithoutSeq): this {
    this.events.push({ ...e, seq: this.events.length } as RunEvent);
    return this;
  }
  start(t: number): this {
    return this.push({ kind: "score", what: "agent_start", t, scenarioStart: 0 });
  }
  raise(t: number, id: string, status: "down" | "degraded"): this {
    const code = status === "down" ? "service_down" : "service_degraded";
    return this.push({
      kind: "world",
      t,
      cause: "physics",
      command: {
        type: "alarm.raise",
        alarm: {
          id: `${code}:${id}`,
          entityId: id,
          code,
          kind: "service",
          severity: status === "down" ? "critical" : "warning",
          message: "x",
          since: t,
        },
      },
    });
  }
  clear(t: number, id: string, status: "down" | "degraded"): this {
    const code = status === "down" ? "service_down" : "service_degraded";
    return this.push({
      kind: "world",
      t,
      cause: "physics",
      command: { type: "alarm.clear", alarmId: `${code}:${id}` },
    });
  }
  call(t: number, effect: "observe" | "act" | "wait" | "answer", ok = true): this {
    return this.push({
      kind: "tool",
      t,
      tool: effect === "act" ? "failover_service" : "list_alarms",
      args: {},
      ok,
      effect,
      targets: [],
      summary: "",
    });
  }
  end(t: number): this {
    return this.push({
      kind: "score",
      what: "graded",
      t,
      total: 0,
      passed: false,
      rootCause: [],
    });
  }
}

const PORTAL = { id: "portal", perHourKrw: 3_600_000 };
const QUEUE = { id: "queue", delayHours: 2 };

describe("the report of a run is read from its events [REQ-088]", () => {
  test("the time a service was stopped, and what it cost, from the alarms alone", () => {
    const log = new Log()
      .raise(100, "portal", "down")
      .start(160)
      .call(160, "act")
      .clear(400, "portal", "down")
      .end(460);
    const r = analyzeRecovery(log.events, [PORTAL]);
    expect(r.impairedAt).toBe(100);
    expect(r.recoveredAt).toBe(400);
    expect(r.recovered).toBe(true);
    expect(r.seconds).toBe(300);
    // counted from the moment the agent had the task
    expect(r.agentSeconds).toBe(240);
    // 300 s stopped at 3,600,000 won an hour is 300,000 won
    expect(r.costKrw).toBe(300_000);
    expect(r.services).toEqual(["portal"]);
  });

  test("a slow service costs 30% of a stopped one, and a batch service counts delay and not money", () => {
    const log = new Log()
      .raise(0, "portal", "degraded")
      .raise(0, "queue", "down")
      .start(0)
      .call(0, "act")
      .clear(100, "portal", "degraded")
      .clear(1800, "queue", "down")
      .end(1900);
    const r = analyzeRecovery(log.events, [PORTAL, QUEUE]);
    // 100 s slow: 0.3 × 100 s × 1,000 won a second
    expect(r.costKrw).toBe(30_000);
    // 1,800 s stopped is half an hour; a stop delays by 2 hours for each hour
    expect(r.delayHours).toBe(1);
  });

  test("a slow service that then stops is one trouble, and it is over when the last service is well", () => {
    const log = new Log()
      .raise(10, "portal", "degraded")
      .clear(70, "portal", "degraded")
      .raise(70, "portal", "down")
      .start(80)
      .call(90, "act")
      .clear(150, "portal", "down")
      .end(200);
    const r = analyzeRecovery(log.events, [PORTAL]);
    expect(r.impairedAt).toBe(10);
    expect(r.recoveredAt).toBe(150);
    // 60 s slow (18 s of loss) and 80 s stopped
    expect(r.costKrw).toBe(Math.round(60 * 0.3 * 1000 + 80 * 1000));
  });

  test("when a service never comes back the time and the cost run to the end", () => {
    const log = new Log().raise(100, "portal", "down").start(160).call(160, "act").end(1060);
    const r = analyzeRecovery(log.events, [PORTAL]);
    expect(r.recovered).toBe(false);
    expect(r.recoveredAt).toBeUndefined();
    expect(r.seconds).toBe(960);
    expect(r.byAgent).toBe(false);
    expect(r.costKrw).toBe(960_000);
  });

  test("a service that comes back by itself, with nothing done, is not the agent's recovery", () => {
    const log = new Log()
      .raise(100, "portal", "down")
      .start(160)
      .clear(300, "portal", "down")
      .end(400);
    const r = analyzeRecovery(log.events, [PORTAL]);
    expect(r.recovered).toBe(true);
    expect(r.byAgent).toBe(false);
    const withAct = new Log()
      .raise(100, "portal", "down")
      .start(160)
      .call(200, "act")
      .clear(300, "portal", "down")
      .end(400);
    expect(analyzeRecovery(withAct.events, [PORTAL])).toMatchObject({ byAgent: true });
    // the change that did it, and when it was made
    expect(analyzeRecovery(withAct.events, [PORTAL]).fixAfterSeconds).toBe(40);
  });

  test("looking is not a change, and a failed change is not one either", () => {
    const log = new Log()
      .raise(100, "portal", "down")
      .start(160)
      .call(160, "observe")
      .call(190, "act", false)
      .clear(300, "portal", "down")
      .end(400);
    expect(analyzeRecovery(log.events, [PORTAL])).toMatchObject({ byAgent: false, acts: 0 });
  });

  test("a service that was well and stops right after a change of the agent's is made worse", () => {
    const log = new Log()
      .raise(100, "portal", "down")
      .start(160)
      .call(200, "act")
      .raise(230, "queue", "down")
      .clear(260, "portal", "down")
      .clear(500, "queue", "down")
      .end(560);
    const r = analyzeRecovery(log.events, [PORTAL, QUEUE]);
    expect(r.worsened).toEqual(["queue"]);
  });

  test("a service that was already in trouble, or that stops long after, is not blamed on the change", () => {
    const log = new Log()
      .raise(100, "portal", "down")
      .raise(100, "queue", "degraded")
      .start(160)
      .call(200, "act")
      .raise(210, "queue", "down")
      .clear(260, "portal", "down")
      .clear(300, "queue", "down")
      .raise(900, "queue", "down")
      .clear(950, "queue", "down")
      .end(1000);
    expect(analyzeRecovery(log.events, [PORTAL, QUEUE]).worsened).toEqual([]);
  });

  test("the same events read the same, with or without the events that close the run", () => {
    const base = new Log()
      .raise(100, "portal", "down")
      .start(160)
      .call(200, "act")
      .clear(300, "portal", "down");
    const closed = new Log()
      .raise(100, "portal", "down")
      .start(160)
      .call(200, "act")
      .clear(300, "portal", "down")
      .end(400);
    expect(analyzeRecovery(base.events, [PORTAL], 400)).toEqual(
      analyzeRecovery(closed.events, [PORTAL]),
    );
    expect(analyzeRecovery(closed.events, [PORTAL])).toEqual(
      analyzeRecovery(closed.events, [PORTAL]),
    );
  });

  test("a run in which no service was ever in trouble has nothing to recover", () => {
    const r = analyzeRecovery(new Log().start(0).call(10, "act").end(100).events, [PORTAL]);
    expect(r).toMatchObject({ recovered: false, byAgent: false, seconds: 0, costKrw: 0 });
    expect(r.impairedAt).toBeUndefined();
  });
});

describe("the axes of recovery-first scoring [REQ-088]", () => {
  const quick = (over: Partial<ReturnType<typeof analyzeRecovery>> = {}) => ({
    services: ["portal"],
    impairedAt: 0,
    recoveredAt: 60,
    endAt: 120,
    recovered: true,
    byAgent: true,
    seconds: 60,
    agentSeconds: 30,
    fixAfterSeconds: 0,
    worsened: [],
    acts: 1,
    costKrw: 0,
    delayHours: 0,
    ...over,
  });
  const names = (id: string) => id;

  test("time, order and no harm are 70 of the 100 points", () => {
    const { time, order, worsen, report } = RECOVERY_WEIGHTS;
    expect(time + order + worsen).toBeGreaterThanOrEqual(70);
    expect(time + order + worsen + report).toBe(100);
  });

  test("a straight line from full points to none", () => {
    expect(ramp(FULL_RECOVERY_S, FULL_RECOVERY_S, ZERO_RECOVERY_S)).toBe(1);
    expect(ramp(ZERO_RECOVERY_S, FULL_RECOVERY_S, ZERO_RECOVERY_S)).toBe(0);
    expect(ramp((FULL_ORDER_S + ZERO_ORDER_S) / 2, FULL_ORDER_S, ZERO_ORDER_S)).toBeCloseTo(0.5);
  });

  test("recovering at once earns every axis; recovering late earns less of time and order", () => {
    const fast = recoveryAxes(quick(), true, names);
    expect(fast.map((a) => a.points)).toEqual([35, 15, 20]);
    const slow = recoveryAxes(quick({ agentSeconds: 700, fixAfterSeconds: 340 }), true, names);
    expect(slow[0]?.points).toBeGreaterThan(0);
    expect(slow[0]?.points).toBeLessThan(35);
    expect(slow[1]?.points).toBeLessThan(15);
    const none = recoveryAxes(quick({ agentSeconds: 2000, fixAfterSeconds: 2000 }), true, names);
    expect(none.map((a) => a.points)).toEqual([0, 0, 20]);
  });

  test("a recovery that does not last keeps half of time and order", () => {
    const half = recoveryAxes(quick(), false, names);
    expect(half.map((a) => a.points)).toEqual([17.5, 7.5, 20]);
  });

  test("no recovery by the agent earns nothing on any axis, not even for harming nothing", () => {
    const lost = recoveryAxes(quick({ recovered: false, byAgent: false }), true, names);
    expect(lost.map((a) => a.points)).toEqual([0, 0, 0]);
    const idle = recoveryAxes(quick({ recovered: false, byAgent: false, acts: 0 }), true, names);
    expect(idle.map((a) => a.points)).toEqual([0, 0, 0]);
  });

  test("every service a change stops takes the points back, below zero", () => {
    const worse = recoveryAxes(quick({ worsened: ["queue", "gateway"] }), true, names);
    expect(worse[2]?.points).toBe(-40);
    expect(worse[2]?.verdict).toBe("penalty");
    expect(worse[2]?.detail).toContain("queue, gateway");
  });
});
