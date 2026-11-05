import { Catalog } from "@terrarium/core/catalog";
import { ORACLE_VERSION } from "@terrarium/core/oracle";
import {
  emptyScenario,
  SCENARIO_TEMPLATES,
  type ScenarioDoc,
  type ScenarioNode,
} from "@terrarium/core/scenario";
import { DEFAULT_TOOLSET, TOOL_NAMES } from "@terrarium/core/tools";
import { BlueprintIndex, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../world/test-support/sample";
import { MetricRecorder, Session, type SessionConfig } from ".";

const template = (id: string) => {
  const t = SCENARIO_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(id);
  return t.build(new BlueprintIndex(sampleBlueprint()), "sample");
};

const config = (scenario: ScenarioDoc, extra: Partial<SessionConfig> = {}): SessionConfig => ({
  blueprint: sampleBlueprint(),
  scenario,
  tools: DEFAULT_TOOLSET,
  seed: 7,
  ...extra,
});

const node = (id: string, type: string, params: ScenarioNode["params"] = {}): ScenarioNode => ({
  id,
  type,
  params,
  position: { x: 0, y: 0 },
});

/** start → agent_task(limits) [→ extra], no expectations. */
function simple(
  params: ScenarioNode["params"] = {},
  extra: ScenarioNode[] = [],
  edges: string[] = [],
): ScenarioDoc {
  return {
    ...emptyScenario("simple", "sample"),
    nodes: [
      node("start", "start"),
      node("agent", "agent_task", { prompt: "조사하라", ...params }),
      ...extra,
    ],
    edges: [
      { id: "e0", from: "start", port: "next", to: "agent" },
      ...edges.map((spec, i) => {
        const [from, to] = spec.split(">") as [string, string];
        return { id: `x${i}`, from, port: "next", to };
      }),
    ],
  };
}

describe("session lifecycle [REQ-007] [REQ-030]", () => {
  test("a full run: warm-up, scenario, agent calls, diagnosis, scoring", () => {
    const session = Session.create(config(template("cooling-failure")));
    expect(session.status).toBe("ready");
    const task = session.start();
    expect(task).toMatchObject({
      startedAt: 900,
      maxToolCalls: 40,
      prompt: expect.stringContaining("hall"),
    });
    expect(session.status).toBe("running");
    expect(session.toolSpecs().map((t) => t.name)).toEqual(DEFAULT_TOOLSET);
    const alarms = session.call("list_alarms", { severity: "critical" });
    expect(alarms).toMatchObject({ ok: true, t: 900 });
    expect(session.call("get_impact", { id: "crah-1" }).t).toBe(930);
    const done = session.call("submit_diagnosis", {
      rootCause: "crah-1",
      faultType: "cooling_unit_failure",
      summary: "CRAH-1 정지",
    });
    expect(done).toMatchObject({ ok: true, t: 960, ended: "diagnosed" });
    expect(session.status).toBe("ended");
    const result = session.finish();
    expect(result.score).toMatchObject({ total: 90.9, passed: true });
    expect(result).toMatchObject({
      endReason: "diagnosed",
      diagnosedAt: 960,
      seed: 7,
      simTime: { scenarioStart: 600, agentStart: 900, end: 960 },
      digests: { oracle: ORACLE_VERSION },
    });
    expect(result.toolCalls.map((c) => c.tool)).toEqual([
      "list_alarms",
      "get_impact",
      "submit_diagnosis",
    ]);
    expect(session.world.time()).toBe(1020); // 60 s of aftermath before scoring
  });

  test("the same seed and the same calls give the same result", () => {
    const run = () => {
      const s = Session.create(config(template("vm-cpu-spike-escalation")));
      s.start();
      s.call("list_alarms", {});
      s.call("wait", { seconds: 900 });
      s.call("get_entity", { id: "vm-db" });
      return JSON.stringify(s.finish("agent_finished"));
    };
    expect(run()).toBe(run());
  });

  test("calls before the start or after the end are refused with the reason", () => {
    const session = Session.create(config(simple()));
    expect(session.call("list_alarms", {})).toMatchObject({
      ok: false,
      error: "the run has not started",
    });
    expect(() => session.finish()).toThrow(/not started/);
    session.start();
    expect(() => session.start()).toThrow(/already started/);
    session.finish("cancelled");
    expect(session.call("list_alarms", {})).toMatchObject({
      ok: false,
      error: "the run has ended (cancelled)",
    });
    expect(session.finish("diagnosed").endReason).toBe("cancelled");
  });

  test("an invalid scenario is refused before anything runs, with the reasons in Korean", () => {
    const broken = { ...simple(), nodes: simple().nodes.filter((n) => n.type !== "agent_task") };
    expect(() => Session.create(config(broken))).toThrow(
      /시나리오를 실행할 수 없어요: 「에이전트 투입」 블록이 필요해요/,
    );
  });

  test("submit_diagnosis is always available, whatever tools were selected", () => {
    const session = Session.create(config(simple(), { tools: ["list_alarms"] }));
    expect(session.toolSpecs().map((t) => t.name)).toEqual(["list_alarms", "submit_diagnosis"]);
  });

  test("a scenario that never hands over the task is reported", () => {
    const late = simple({}, [], []);
    const delayed: ScenarioDoc = {
      ...late,
      nodes: [...late.nodes, node("w", "wait", { seconds: 7200 })],
      edges: [
        { id: "a", from: "start", port: "next", to: "w" },
        { id: "b", from: "w", port: "next", to: "agent" },
      ],
    };
    expect(() => Session.create(config(delayed, { maxPreAgentSeconds: 600 })).start()).toThrow(
      /did not hand the task/,
    );
    expect(Session.create(config(delayed)).start().startedAt).toBe(7800);
  });
});

describe("session time and limits [REQ-001] [REQ-007]", () => {
  test("lockstep: each call costs simulated seconds; wait costs exactly what it asks", () => {
    const session = Session.create(
      config(simple(), { time: { kind: "lockstep", secondsPerCall: 45 } }),
    );
    session.start();
    session.call("list_alarms", {});
    expect(session.world.time()).toBe(645);
    session.call("wait", { seconds: 100 });
    expect(session.world.time()).toBe(745);
    session.call("get_entity", { id: "nope" });
    expect(session.world.time()).toBe(790); // failed calls cost time too
  });

  test("the time limit ends the run, and wait cannot jump past it", () => {
    const session = Session.create(config(simple({ timeLimitSeconds: 300 })));
    session.start();
    const result = session.call("wait", { seconds: 3600 });
    expect(result).toMatchObject({
      ok: true,
      ended: "time_limit",
      data: { waited: 3600, now: 900 },
    });
    expect(session.finish().endReason).toBe("time_limit");
  });

  test("the tool budget ends the run, but the answer can still be submitted at the limit", () => {
    const session = Session.create(config(simple({ maxToolCalls: 2 })));
    session.start();
    session.call("list_alarms", {});
    session.call("list_entities", { kind: "server" });
    const over = session.call("get_entity", { id: "srv-a1" });
    expect(over).toMatchObject({
      ok: false,
      ended: "tool_budget",
      error: expect.stringContaining("2 tool calls"),
    });
    const atLimit = Session.create(config(simple({ maxToolCalls: 1 })));
    atLimit.start();
    atLimit.call("list_alarms", {});
    expect(
      atLimit.call("submit_diagnosis", { rootCause: "x", faultType: "y", summary: "z" }).ended,
    ).toBe("diagnosed");
  });

  test("realtime: simulated time follows the wall clock the host reports", () => {
    const session = Session.create(
      config(simple({ timeLimitSeconds: 600 }), { time: { kind: "realtime", speed: 10 } }),
    );
    session.start();
    expect(session.sync(12)).toBeUndefined();
    expect(session.world.time()).toBe(720);
    session.call("list_alarms", {});
    expect(session.world.time()).toBe(720); // calls do not move time in realtime mode
    expect(session.sync(5)).toBeUndefined(); // never backwards
    expect(session.world.time()).toBe(720);
    expect(session.sync(100)).toBe("time_limit");
    expect(session.sync(200)).toBeUndefined();
    const lockstep = Session.create(config(simple()));
    lockstep.start();
    expect(lockstep.sync(100)).toBeUndefined();
    expect(lockstep.world.time()).toBe(600);
  });

  test("a cancelled run is not advanced further before scoring", () => {
    const session = Session.create(config(simple()));
    session.start();
    session.finish("cancelled");
    expect(session.world.time()).toBe(600);
  });
});

describe("session records [REQ-037] [REQ-039]", () => {
  test("effects are recorded per call, whichever tool caused them, and scored", () => {
    const doc = template("sensor-drift");
    const session = Session.create(config(doc, { tools: TOOL_NAMES }));
    session.start();
    const server = String(doc.nodes.find((n) => n.type === "inject_fault")?.params.target);
    const path = "/redfish/v1/Systems/System.Embedded.1/Actions/ComputerSystem.Reset";
    session.call("redfish_request", {
      server,
      method: "POST",
      path,
      body: { ResetType: "ForceOff" },
    });
    session.call("set_cooling_setpoint", { unitId: "crah-1", celsius: 18 });
    session.call("wait", { seconds: 60 });
    const result = session.finish();
    expect(result.toolCalls.map((c) => c.effects)).toEqual([
      [{ action: "power_off", target: server }],
      [{ action: "setpoint_change", target: "crah-1" }],
      [],
    ]);
    const penalties = result.score.items.filter((i) => i.verdict === "penalty").map((i) => i.id);
    expect(penalties).toEqual(["no-setpoint", "no-poweroff"]);
  });

  test("the timeline puts scenario steps, alarms and agent calls on one axis", () => {
    const session = Session.create(config(template("pdu-breaker-cascade")));
    session.start();
    session.call("reset_breaker", { id: "pdu-a" });
    session.call("get_entity", { id: "ghost" });
    const { timeline } = session.finish();
    expect(timeline[0]).toEqual({ t: 600, source: "scenario", text: "시작", nodeId: "start" });
    expect(timeline).toContainEqual({
      t: 600,
      source: "scenario",
      text: "차단기 트립 발생 (pdu-a)",
      nodeId: "fault",
    });
    expect(timeline).toContainEqual(
      expect.objectContaining({
        source: "alarm",
        severity: "critical",
        entityId: "pdu-a",
        text: "pdu-a 차단기 트립",
      }),
    );
    expect(timeline).toContainEqual({
      t: 660,
      source: "agent",
      text: 'reset_breaker {"id":"pdu-a"} → pdu-a 차단기 리셋',
    });
    expect(timeline).toContainEqual({
      t: 690,
      source: "agent",
      text: expect.stringMatching(/^get_entity \{"id":"ghost"\} — 실패: .*ghost/),
    });
    expect(
      timeline.some((e) => e.source === "alarm" && e.text.startsWith("복구: pdu-a 차단기 트립")),
    ).toBe(true);
    const times = timeline.map((e) => e.t);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  test("result series cover the answer, what the agent touched and what alarmed", () => {
    const session = Session.create(config(template("cooling-failure")));
    session.start();
    session.call("set_cooling_setpoint", { unitId: "crah-2", celsius: 18 });
    const { series, recorderBytes } = session.finish();
    const keys = series.map((s) => `${s.entityId}.${s.metric}`);
    expect(keys).toEqual(expect.arrayContaining(["crah-1.supplyC", "crah-2.loadKw"]));
    expect(series.length).toBeLessThanOrEqual(24);
    const supply = series.find((s) => s.entityId === "crah-1" && s.metric === "supplyC");
    expect(supply?.points[0]?.[0]).toBe(600);
    expect(recorderBytes).toBeGreaterThan(0);
  });

  test("query_metrics reads the session's own recording", () => {
    const session = Session.create(config(template("fan-failure-throttle")));
    session.start();
    const server = "srv-a1";
    const result = session.call("query_metrics", { id: server, metric: "cpuC", lastSeconds: 600 });
    expect(result.ok).toBe(true);
    const points = (result.data as { points: Array<[number, number]> }).points;
    expect(points.length).toBeGreaterThan(5);
    expect(points.at(-1)?.[1]).toBeGreaterThan(points[0]?.[1] ?? 0);
  });
});

describe("metric recorder [REQ-037] [REQ-032]", () => {
  test("samples on a fixed grid into a bounded ring, recording sensor readings", () => {
    const world = World.fromBlueprint(sampleBlueprint(), new Catalog());
    const recorder = new MetricRecorder(world, { sampleSeconds: 30, retentionSeconds: 90 });
    world.apply(
      {
        type: "fault.add",
        fault: { id: "d", type: "sensor_drift", target: "srv-a1", params: { deltaC: 5 } },
      },
      "scenario",
    );
    for (let t = 0; t < 300; t += 10) {
      recorder.sampleIfDue();
      world.advance(10);
    }
    expect(recorder.samples).toBe(10);
    const inlet = recorder.series("srv-a1", "inletC", 0);
    expect(inlet.map(([t]) => t)).toEqual([180, 210, 240, 270]);
    expect(inlet[0]?.[1]).toBeCloseTo(world.stateAs("srv-a1", "server").inletC + 5, 4);
    expect(recorder.series("srv-a1", "inletC", 250).map(([t]) => t)).toEqual([270]);
    expect(recorder.series("srv-a1", "nope", 0)).toEqual([]);
    expect(recorder.metricsOf("srv-a1")).toEqual(["inletC", "cpuC", "cpuUtil", "powerW"]);
    expect(recorder.metricsOf("site")).toEqual([]);
    expect(recorder.bytes).toBe(4 * 8 + recorder.seriesCount * 4 * 4); // ceil(90 / 30) + 1 slots
  });

  test("a powered-off server records zero CPU utilisation", () => {
    const world = World.fromBlueprint(sampleBlueprint(), new Catalog());
    const recorder = new MetricRecorder(world);
    world.patch("srv-b1", "server", { adminOn: false });
    recorder.sampleIfDue();
    expect(recorder.series("srv-b1", "cpuUtil", 0)).toEqual([[0, 0]]);
    expect(recorder.series("srv-a1", "cpuUtil", 0)[0]?.[1]).toBeGreaterThan(0);
  });
});
