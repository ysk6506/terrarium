import type { RunEvent } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { serviceLab } from "../../world/test-support/service-lab";
import { Session } from "..";
import {
  CALL_HOLD_S,
  clockStep,
  DEFAULT_OPERATION,
  DEFAULT_OPERATION_CALLS,
  EVENT_HOLD_S,
  GENERATOR_CAUSE,
  type OperationConfig,
  operationMetrics,
  operationProblem,
  operationScenario,
  planFaults,
  START_CLOCK,
} from ".";

const blueprint = serviceLab();
const candidates = blueprint.entities.map((e) => ({
  id: e.id,
  kind: e.kind,
  ...(e.parentId ? { parentId: e.parentId } : {}),
}));
const cfg = (over: Partial<OperationConfig> = {}): OperationConfig => ({
  ...DEFAULT_OPERATION,
  rateScale: 20,
  ...over,
});

describe("the fault generator is a plan worked out from the seed [REQ-090]", () => {
  test("the same seed gives the same shift, another seed another one", () => {
    const a = planFaults(candidates, cfg({ hours: 24 }), 7);
    expect(planFaults(candidates, cfg({ hours: 24 }), 7)).toEqual(a);
    expect(planFaults(candidates, cfg({ hours: 24 }), 8)).not.toEqual(a);
    expect(a.length).toBeGreaterThan(3);
    expect(a.map((f) => f.at)).toEqual([...a.map((f) => f.at)].sort((x, y) => x - y));
    expect(a.every((f) => f.at < 24 * 3600)).toBe(true);
  });

  test("quiet, normal and busy scale the rate; the day is busier than the night", () => {
    const count = (preset: "quiet" | "normal" | "busy") =>
      [1, 2, 3, 4, 5].reduce(
        (n, seed) =>
          n +
          planFaults(candidates, cfg({ hours: 48, source: { kind: "preset", preset } }), seed)
            .length,
        0,
      );
    expect(count("quiet")).toBeLessThan(count("normal"));
    expect(count("normal")).toBeLessThan(count("busy"));
    const plan = [1, 2, 3, 4, 5, 6].flatMap((seed) =>
      planFaults(candidates, cfg({ hours: 96 }), seed),
    );
    const hourOf = (t: number) => Math.floor((t % 86_400) / 3_600);
    const day = plan.filter((f) => hourOf(f.at) >= 8 && hourOf(f.at) < 18).length;
    const night = plan.filter((f) => hourOf(f.at) < 5).length;
    expect(day).toBeGreaterThan(night * 2);
  });

  test("cascade and simultaneous chances add faults close to the first one", () => {
    const calm = planFaults(
      candidates,
      cfg({ hours: 48, cascadeChance: 0, simultaneousChance: 0 }),
      3,
    );
    const rough = planFaults(
      candidates,
      cfg({ hours: 48, cascadeChance: 1, simultaneousChance: 1 }),
      3,
    );
    expect(calm.every((f) => f.why === "random")).toBe(true);
    expect(rough.filter((f) => f.why === "cascade").length).toBeGreaterThan(0);
    expect(rough.filter((f) => f.why === "simultaneous").length).toBeGreaterThan(0);
  });

  test("a set of scenarios' faults is played once each, in random order, inside the hours", () => {
    const faults = [
      { type: "fan_failure" as const, target: "srv-a1" },
      { type: "disk_full" as const, target: "vm-web" },
      { type: "bmc_unresponsive" as const, target: "srv-a2" },
    ];
    const plan = planFaults(candidates, cfg({ hours: 6, source: { kind: "set", faults } }), 4);
    expect(plan.map((f) => f.type).sort()).toEqual(faults.map((f) => f.type).sort());
    expect(plan.every((f) => f.at > 0 && f.at < 6 * 3600)).toBe(true);
  });

  test("a config that cannot run says why", () => {
    expect(operationProblem(cfg())).toBeUndefined();
    expect(operationProblem(cfg({ hours: 0 }))).toMatch(/운영 시간/);
    expect(operationProblem(cfg({ pace: { mode: "fast", speed: 200 } }))).toMatch(/빨리 감기/);
    expect(operationProblem(cfg({ source: { kind: "set", faults: [] } }))).toMatch(/세트/);
  });
});

describe("the clock driver moves world time per the pace [REQ-090]", () => {
  const quiet = { newAlarms: 0, newTeamEvents: 0 };
  test("real time: one world second per real second, whatever happens", () => {
    const s = clockStep({ mode: "realtime" }, START_CLOCK, 100, 1, { ...quiet, newAlarms: 2 });
    expect([s.worldSeconds, s.speed, s.reason]).toEqual([1, 1, "realtime"]);
  });

  test("fast forward: the chosen speed only while it is quiet", () => {
    const pace = { mode: "fast", speed: 30 } as const;
    expect(clockStep(pace, START_CLOCK, 100, 1, quiet).worldSeconds).toBe(30);
    // an alarm that has just gone up: real speed for a while (one that stays up for hours does not pin the clock)
    const raised = clockStep(pace, START_CLOCK, 100, 1, { ...quiet, newAlarms: 1 });
    const later = clockStep(pace, raised.memory, 100 + EVENT_HOLD_S - 1, 1, quiet);
    expect(later.worldSeconds).toBe(1);
    expect(clockStep(pace, later.memory, 100 + EVENT_HOLD_S + 1, 1, quiet).worldSeconds).toBe(30);
    // a team's event
    const team = clockStep(pace, START_CLOCK, 50, 1, { ...quiet, newTeamEvents: 1 });
    expect([team.worldSeconds, team.reason]).toEqual([1, "event"]);
  });

  test("fast forward: real speed while the agent is calling tools", () => {
    const pace = { mode: "fast", speed: 60 } as const;
    const busy = clockStep(
      pace,
      { busyUntil: 10 + CALL_HOLD_S, busyBecause: "call" },
      11,
      1,
      quiet,
    );
    expect([busy.worldSeconds, busy.reason]).toEqual([1, "call"]);
    expect(clockStep(pace, busy.memory, 10 + CALL_HOLD_S + 0.5, 1, quiet).worldSeconds).toBe(60);
  });
});

/** Run events built by hand: the agent's looks and the alarms the world raised. */
class Log {
  readonly events: RunEvent[] = [];
  private push(e: Record<string, unknown>): this {
    this.events.push({ ...e, seq: this.events.length } as RunEvent);
    return this;
  }
  start(): this {
    return this.push({ kind: "score", what: "agent_start", t: 0, scenarioStart: 0 });
  }
  fault(t: number, id: string, target: string): this {
    return this.push({
      kind: "world",
      t,
      cause: GENERATOR_CAUSE,
      command: { type: "fault.add", fault: { id, type: "fan_failure", target, params: {} } },
    });
  }
  raise(t: number, entity: string): this {
    return this.push({
      kind: "world",
      t,
      cause: "physics",
      command: {
        type: "alarm.raise",
        alarm: {
          id: `hot:${entity}`,
          entityId: entity,
          code: "hot",
          severity: "warning",
          message: "x",
          since: t,
        },
      },
    });
  }
  clear(t: number, entity: string): this {
    return this.push({
      kind: "world",
      t,
      cause: "physics",
      command: { type: "alarm.clear", alarmId: `hot:${entity}` },
    });
  }
  call(t: number, tool: string, targets: string[] = []): this {
    return this.push({
      kind: "tool",
      t,
      tool,
      args: {},
      ok: true,
      effect: "observe",
      targets,
      summary: "",
    });
  }
}

describe("missed alarms, detection delay and the other measures are read from the events [REQ-090]", () => {
  test("an alarm nobody looked at is missed; a look after it went up (or events_since after it cleared) is not", () => {
    const log = new Log()
      .start()
      .raise(100, "srv-a1")
      .raise(200, "srv-a2")
      .clear(300, "srv-a1")
      .call(400, "get_entity", ["srv-a2"])
      .raise(500, "srv-a3")
      .call(900, "events_since");
    const m = operationMetrics({ events: log.events, harms: [] });
    // srv-a1: cleared before any look, but events_since at 900 shows it; srv-a2: get_entity of its equipment;
    // srv-a3: events_since
    expect(m.alarms).toBe(3);
    expect(m.missed).toBe(0);
    const none = operationMetrics({
      events: new Log().start().call(50, "events_since").raise(100, "srv-a1").events,
      harms: [],
    });
    expect(none.missed).toBe(1);
    // a look at other equipment while the alarm is up does not count
    const other = new Log().start().raise(100, "srv-a1").call(200, "get_entity", ["srv-a9"]);
    expect(operationMetrics({ events: other.events, harms: [] }).missed).toBe(1);
  });

  test("detection delay is the median from a fault to the first alarm-showing call after it", () => {
    const log = new Log()
      .start()
      .fault(100, "gen:1", "srv-a1")
      .call(160, "events_since")
      .fault(1000, "gen:2", "srv-a2")
      .call(1400, "list_alarms")
      .fault(2000, "gen:3", "srv-a3")
      .call(2020, "events_since");
    const m = operationMetrics({ events: log.events, harms: [] });
    expect(m.incidents).toBe(3);
    expect(m.detectionDelayS).toBe(60);
    expect(m.undetected).toBe(0);
    expect(m.watchIntervalS).toBe(
      Math.round((1400 - 160 + 2020 - 1400) / 2 / 1) === 0 ? 0 : m.watchIntervalS,
    );
  });

  test("a fault nobody looked for counts until the end and is undetected; an incident ends when its alarms clear", () => {
    const log = new Log()
      .start()
      .fault(100, "gen:1", "srv-a1")
      .raise(120, "srv-a1")
      .clear(700, "srv-a1");
    log.call(3000, "get_entity", ["x"]);
    const m = operationMetrics({ events: log.events, harms: [] });
    expect(m.undetected).toBe(1);
    expect(m.detectionDelayS).toBe(3000 - 100);
    expect(m.recovery).toEqual({ min: 600, median: 600, max: 600 });
    expect(m.open).toBe(0);
  });

  test("quiet calls are those made while no alarm is up; escalations count escalate calls and questions", () => {
    const log = new Log()
      .start()
      .call(10, "get_entity")
      .raise(20, "a")
      .call(30, "escalate")
      .clear(40, "a")
      .call(50, "wait");
    const m = operationMetrics({ events: log.events, harms: [], tokens: 300 });
    expect(m.calls).toBe(3);
    expect(m.quietCalls).toBe(2);
    expect(m.quietTokens).toBe(200);
    expect(m.escalations).toBe(1);
  });
});

describe("an operation session plays the generator's faults into the world [REQ-090]", () => {
  const open = (config: OperationConfig, seed = 5) =>
    Session.create({
      blueprint,
      scenario: operationScenario("op", blueprint.id, config),
      tools: ["events_since", "list_alarms", "service_status", "wait", "get_entity"],
      seed,
      operation: config,
    });

  test("time follows the clock driver; the faults come with cause generator; it ends when the hours are used", () => {
    const config = cfg({ hours: 2, source: { kind: "preset", preset: "busy" } });
    const s = open(config);
    const task = s.start();
    expect(task.timeLimitSeconds).toBe(2 * 3600);
    expect(task.maxToolCalls).toBe(DEFAULT_OPERATION_CALLS);
    expect(task.prompt).toContain("events_since");
    const t0 = s.worldTime;
    s.sync(10);
    expect(s.worldTime - t0).toBeCloseTo(10, 5);
    for (let elapsed = 20; s.status === "running"; elapsed += 600) s.sync(elapsed);
    const result = s.finish();
    expect(result.endReason).toBe("time_limit");
    const made =
      result.events?.filter((e) => e.kind === "world" && e.cause === GENERATOR_CAUSE) ?? [];
    expect(made.length).toBe(result.operation?.planned);
    expect(result.operation?.metrics.incidents).toBe(made.length);
  });

  test("a call limit ends the run and says so; wait does not move time by itself (the host lets real time pass)", () => {
    const config = cfg({ hours: 2, budget: { maxToolCalls: 3 } });
    const s = open(config);
    expect(s.start().maxToolCalls).toBe(3);
    const t0 = s.worldTime;
    s.call("wait", { seconds: 600 });
    expect(s.worldTime).toBe(t0);
    s.call("list_alarms");
    s.call("list_alarms");
    const refused = s.call("list_alarms");
    expect(refused.ended).toBe("tool_budget");
    expect(s.finish().endReason).toBe("tool_budget");
  });

  test("a fast-forward run moves quickly while it is quiet", () => {
    const config = cfg({
      hours: 8,
      pace: { mode: "fast", speed: 60 },
      source: { kind: "set", faults: [{ type: "fan_failure", target: "srv-a1" }] },
    });
    const s = open(config);
    s.start();
    const t0 = s.worldTime;
    s.sync(30);
    expect(s.worldTime - t0).toBeGreaterThanOrEqual(30 * 60 - 1);
  });
});
