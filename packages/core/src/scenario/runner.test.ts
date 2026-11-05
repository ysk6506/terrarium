import { Catalog } from "@terrarium/core/catalog";
import { Physics } from "@terrarium/core/physics";
import type { Diagnosis } from "@terrarium/core/tools";
import { BlueprintIndex, faultSpec, reportedInletC, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint, withChanges } from "../world/test-support/sample";
import {
  type AgentSignals,
  type Condition,
  emptyScenario,
  evaluate,
  hasErrors,
  NO_AGENT,
  SCENARIO_TEMPLATES,
  type ScenarioDoc,
  type ScenarioNode,
  ScenarioRunner,
  scenarioTemplate,
  type ToolCallRecord,
  validateScenario,
} from ".";

const catalog = new Catalog();

function boot() {
  const world = World.fromBlueprint(sampleBlueprint(), catalog);
  const physics = new Physics(world);
  physics.settle();
  physics.run(600);
  return { world, physics };
}

const node = (id: string, type: string, params: ScenarioNode["params"] = {}): ScenarioNode => ({
  id,
  type,
  params,
  position: { x: 0, y: 0 },
});

/** A scenario from a list of nodes and "from:port>to" edges. */
function scenario(nodes: ScenarioNode[], edges: string[]): ScenarioDoc {
  return {
    ...emptyScenario("t", "sample"),
    nodes: [node("start", "start"), ...nodes],
    edges: edges.map((spec, i) => {
      const [from, rest] = spec.split(":") as [string, string];
      const [port, to] = rest.split(">") as [string, string];
      return { id: `e${i}`, from, port, to };
    }),
  };
}

/** A fake agent whose tool calls and diagnosis the test controls. */
function fakeAgent() {
  const calls: ToolCallRecord[] = [];
  let diagnosis: Diagnosis | undefined;
  const signals: AgentSignals = { toolCalls: () => calls, diagnosis: () => diagnosis };
  return {
    signals,
    call: (t: number, tool: string, args: Record<string, unknown> = {}) =>
      calls.push({ t, tool, args, ok: true }),
    submit: (d: Diagnosis) => {
      diagnosis = d;
    },
  };
}

/** Runs physics in 10 s steps, ticking the runner after each, for `seconds`. */
function advance(physics: Physics, runner: ScenarioRunner, seconds: number) {
  for (let left = seconds; left > 0; left -= 10) {
    physics.step(Math.min(10, left));
    runner.tick();
  }
}

describe("scenario runner [REQ-034] [REQ-001]", () => {
  test("blocks run in order in simulated time and leave a readable trace", () => {
    const { world, physics } = boot();
    const doc = scenario(
      [
        node("w", "wait", { seconds: 60 }),
        node("f", "inject_fault", { faultType: "fan_failure", target: "srv-a1" }),
      ],
      ["start:next>w", "w:next>f"],
    );
    const runner = new ScenarioRunner(doc, world, 1, NO_AGENT);
    runner.start();
    runner.tick();
    expect(runner.nextWakeAt()).toBe(660);
    advance(physics, runner, 50);
    expect(world.faultsOn("srv-a1")).toEqual([]);
    advance(physics, runner, 10);
    expect(world.faultsOn("srv-a1")).toMatchObject([
      { id: "scn:f", type: "fan_failure", since: 660 },
    ]);
    expect(world.events().at(-1)?.cause).toBe("scenario:f");
    expect(runner.trace()).toEqual([
      { t: 600, nodeId: "start", what: "ran" },
      { t: 600, nodeId: "w", what: "waiting" },
      { t: 660, nodeId: "w", what: "resumed" },
      { t: 660, nodeId: "f", what: "ran" },
    ]);
    expect(runner.active).toBe(false);
  });

  test("several edges from one output run in parallel", () => {
    const { world, physics } = boot();
    const doc = scenario(
      [
        node("a", "wait", { seconds: 30 }),
        node("b", "wait", { seconds: 20 }),
        node("fa", "power", { target: "srv-a1", on: false }),
        node("fb", "power", { target: "srv-b1", on: false }),
      ],
      ["start:next>a", "start:next>b", "a:next>fa", "b:next>fb"],
    );
    const runner = new ScenarioRunner(doc, world, 1, NO_AGENT);
    runner.start();
    runner.tick();
    advance(physics, runner, 20);
    expect(world.stateAs("srv-b1", "server").adminOn).toBe(false);
    expect(world.stateAs("srv-a1", "server").adminOn).toBe(true);
    advance(physics, runner, 10);
    expect(world.stateAs("srv-a1", "server").adminOn).toBe(false);
  });

  test("a branch reads the world at the moment it runs", () => {
    const { world, physics } = boot();
    const hot: Condition = {
      kind: "state",
      entity: "crah-1",
      field: "running",
      op: "==",
      value: false,
    };
    const doc = scenario(
      [
        node("stop", "inject_fault", { faultType: "cooling_unit_failure", target: "crah-1" }),
        node("w", "wait", { seconds: 10 }),
        node("b", "branch", { condition: hot }),
        node("yes", "set_load", { target: "srv-a1", value: 0.9 }),
        node("no", "set_load", { target: "srv-a1", value: 0.1 }),
      ],
      ["start:next>stop", "stop:next>w", "w:next>b", "b:yes>yes", "b:no>no"],
    );
    const runner = new ScenarioRunner(doc, world, 1, NO_AGENT);
    runner.start();
    runner.tick();
    advance(physics, runner, 10);
    expect(world.stateAs("srv-a1", "server").cpuUtil).toBe(0.9);
    expect(runner.trace()).toContainEqual({ t: 610, nodeId: "b", what: "chose", detail: "yes" });
  });

  test("wait-until continues as soon as the agent acts, or on timeout", () => {
    const run = (act: boolean) => {
      const { world, physics } = boot();
      const agent = fakeAgent();
      const doc = scenario(
        [
          node("until", "wait_until", {
            condition: { kind: "tool_called", tool: "reset_breaker", target: "pdu-a" },
            timeoutSeconds: 120,
          }),
          node("met", "note", { text: "조치함" }),
          node("late", "inject_fault", { faultType: "breaker_trip", target: "pdu-b" }),
        ],
        ["start:next>until", "until:met>met", "until:timeout>late"],
      );
      const runner = new ScenarioRunner(doc, world, 1, agent.signals);
      runner.start();
      runner.tick();
      advance(physics, runner, 40);
      if (act) agent.call(640, "reset_breaker", { id: "pdu-a" });
      advance(physics, runner, 200);
      return { world, runner };
    };
    const acted = run(true);
    expect(acted.runner.trace()).toContainEqual({ t: 650, nodeId: "until", what: "met" });
    expect(acted.world.faultsOn("pdu-b")).toEqual([]);
    const idle = run(false);
    expect(idle.runner.trace()).toContainEqual({ t: 720, nodeId: "until", what: "timeout" });
    expect(idle.world.faultsOn("pdu-b")).toHaveLength(1);
  });

  test("random choices are reproducible per seed and vary across seeds", () => {
    const chosen = (seed: number) => {
      const { world } = boot();
      const doc = scenario([node("r", "random", { branches: 3 })], ["start:next>r"]);
      const runner = new ScenarioRunner(doc, world, seed, NO_AGENT);
      runner.start();
      runner.tick();
      return runner.trace().find((e) => e.what === "chose")?.detail;
    };
    expect(chosen(7)).toBe(chosen(7));
    const seen = new Set(Array.from({ length: 30 }, (_, i) => chosen(i)));
    expect([...seen].sort()).toEqual(["1", "2", "3"]);
  });

  test("faults with a duration expire; clear blocks remove them earlier", () => {
    const { world, physics } = boot();
    const doc = scenario(
      [
        node("f1", "inject_fault", {
          faultType: "fan_failure",
          target: "srv-a1",
          durationSeconds: 30,
        }),
        node("f2", "inject_fault", {
          faultType: "fan_failure",
          target: "srv-b1",
          durationSeconds: 300,
        }),
        node("w", "wait", { seconds: 60 }),
        node("c", "clear_fault", { ref: "f2" }),
      ],
      ["start:next>f1", "f1:next>f2", "f2:next>w", "w:next>c"],
    );
    const runner = new ScenarioRunner(doc, world, 1, NO_AGENT);
    runner.start();
    runner.tick();
    expect(world.faults().map((f) => f.id)).toEqual(["scn:f1", "scn:f2"]);
    advance(physics, runner, 30);
    expect(world.faults().map((f) => f.id)).toEqual(["scn:f2"]);
    expect(runner.trace()).toContainEqual({
      t: 630,
      nodeId: "f1",
      what: "expired",
      detail: "scn:f1",
    });
    advance(physics, runner, 30);
    expect(world.faults()).toEqual([]);
    advance(physics, runner, 300);
    expect(runner.trace().filter((e) => e.what === "expired")).toHaveLength(1);
    expect(runner.active).toBe(false);
  });

  test("operations change the world; the agent task is handed over once", () => {
    const { world } = boot();
    const doc = scenario(
      [
        node("load", "set_load", { target: "vm-web", value: 0.8 }),
        node("sp", "set_setpoint", { target: "crah-2", celsius: 20 }),
        node("agent", "agent_task", { prompt: "조사하라" }),
      ],
      ["start:next>load", "load:next>sp", "sp:next>agent"],
    );
    const runner = new ScenarioRunner(doc, world, 1, NO_AGENT);
    runner.start();
    const handed = runner.tick();
    expect(handed).toEqual([
      {
        nodeId: "agent",
        prompt: "조사하라",
        maxToolCalls: 40,
        timeLimitSeconds: 3600,
        startedAt: 600,
      },
    ]);
    expect(runner.agentTask).toEqual(handed[0]);
    expect(runner.tick()).toEqual([]);
    expect(world.stateAs("crah-2", "cooling_unit").setpointC).toBe(20);
    expect(world.stateAs("vm-web", "vm").cpuDemand).toBe(0.8);
  });

  test("a block that cannot act is recorded and the flow goes on", () => {
    const { world } = boot();
    const doc = scenario(
      [
        node("sp", "set_setpoint", { target: "crah-1", celsius: 99 }),
        node("p", "power", { target: "srv-a1", on: false }),
      ],
      ["start:next>sp", "sp:next>p"],
    );
    const runner = new ScenarioRunner(doc, world, 1, NO_AGENT);
    runner.start();
    runner.tick();
    expect(runner.trace()).toContainEqual({
      t: 600,
      nodeId: "sp",
      what: "error",
      detail: expect.stringContaining("between 16 and 27"),
    });
    expect(world.stateAs("srv-a1", "server").adminOn).toBe(false);
  });

  test("a block reached twice injects its fault twice under distinct ids", () => {
    const { world } = boot();
    const doc = scenario(
      [node("f", "inject_fault", { faultType: "fan_failure", target: "srv-a1" })],
      ["start:next>f", "start:next>f"],
    );
    const runner = new ScenarioRunner(doc, world, 1, NO_AGENT);
    runner.start();
    runner.tick();
    expect(world.faults().map((f) => f.id)).toEqual(["scn:f", "scn:f#2"]);
  });

  test("a scenario without a start block cannot start", () => {
    const { world } = boot();
    const runner = new ScenarioRunner(
      { ...emptyScenario("x", "sample"), nodes: [] },
      world,
      1,
      NO_AGENT,
    );
    expect(() => runner.start()).toThrow(/no start block/);
  });

  test("conditions see alarms, tool calls and the diagnosis", () => {
    const { world, physics } = boot();
    const agent = fakeAgent();
    world.apply(
      { type: "fault.add", fault: { id: "t", type: "breaker_trip", target: "pdu-b", params: {} } },
      "scenario",
    );
    physics.run(10);
    const yes = (c: Condition) => evaluate(c, world, agent.signals);
    expect(
      yes({
        kind: "alarm",
        active: true,
        entity: "pdu-b",
        code: "breaker_tripped",
        severity: "critical",
      }),
    ).toBe(true);
    expect(yes({ kind: "alarm", active: false, entity: "pdu-a" })).toBe(true);
    expect(yes({ kind: "tool_called", tool: "reset_breaker" })).toBe(false);
    agent.call(610, "reset_breaker", { id: "pdu-b" });
    expect(yes({ kind: "tool_called", tool: "reset_breaker", target: "pdu-b" })).toBe(true);
    expect(yes({ kind: "tool_called", tool: "reset_breaker", target: "pdu-a" })).toBe(false);
    expect(yes({ kind: "diagnosis_submitted" })).toBe(false);
    agent.submit({ rootCause: "pdu-b", faultType: "breaker_trip", summary: "", actions: [] });
    expect(
      yes({
        kind: "all",
        of: [
          { kind: "diagnosis_submitted" },
          { kind: "state", entity: "srv-b1", field: "cpuUtil", op: "<=", value: 1 },
        ],
      }),
    ).toBe(true);
    expect(
      yes({
        kind: "any",
        of: [
          { kind: "state", entity: "srv-b1", field: "health", op: "==", value: "ok" },
          { kind: "state", entity: "pdu-b", field: "tripped", op: "!=", value: true },
        ],
      }),
    ).toBe(false);
  });
});

/** Runs a template on the sample hall until the agent is handed the task. */
function untilAgent(id: string) {
  const template = scenarioTemplate(id);
  if (!template) throw new Error(id);
  const { world, physics } = boot();
  const doc = template.build(world.index, "sample");
  const runner = new ScenarioRunner(doc, world, 1, NO_AGENT);
  runner.start();
  runner.tick();
  for (let i = 0; i < 200 && !runner.agentTask; i++) advance(physics, runner, 10);
  return { world, physics, runner, doc };
}

describe("built-in scenarios [REQ-033]", () => {
  test("every template builds a valid scenario for the sample hall, without warnings", () => {
    const index = new BlueprintIndex(sampleBlueprint());
    for (const template of SCENARIO_TEMPLATES) {
      expect(template.unavailable(index)).toBeUndefined();
      const doc = template.build(index, "sample");
      expect([template.id, validateScenario(doc, { index, catalog })]).toEqual([template.id, []]);
      expect(doc).toMatchObject({ id: template.id, template: template.id, worldId: "sample" });
    }
  });

  test("prompts describe symptoms, never the answer", () => {
    const index = new BlueprintIndex(sampleBlueprint());
    for (const template of SCENARIO_TEMPLATES) {
      const doc = template.build(index, "sample");
      const prompt = String(doc.nodes.find((n) => n.type === "agent_task")?.params.prompt);
      for (const type of template.faultTypes) {
        expect(prompt).not.toContain(type);
        expect(prompt).not.toContain(faultSpec(type).label);
      }
      expect(prompt).toContain("submit_diagnosis");
    }
  });

  test("templates say why they cannot be built for a world that lacks their equipment", () => {
    const bare = new BlueprintIndex(
      withChanges(sampleBlueprint(), { remove: ["crah-1", "crah-2", "vm-web", "vm-db"] }),
    );
    expect(scenarioTemplate("cooling-failure")?.unavailable(bare)).toBe(
      "이 세계에 필요한 장비(냉방기·서버)가 없어요",
    );
    expect(scenarioTemplate("vm-cpu-spike-escalation")?.unavailable(bare)).toBe(
      "호스트에 올라간 VM이 없어요",
    );
    expect(scenarioTemplate("fan-failure-throttle")?.unavailable(bare)).toBeUndefined();
    expect(scenarioTemplate("nope")).toBeUndefined();
  });

  test("cooling failure: the unit stops and the hall warms before the agent arrives", () => {
    const { world, runner } = untilAgent("cooling-failure");
    expect(runner.agentTask?.startedAt).toBe(900);
    expect(world.alarms().map((a) => a.id)).toContain("cooling_stopped:crah-1");
    expect(world.stateAs("hall", "room").ambientC).toBeGreaterThan(
      boot().world.stateAs("hall", "room").ambientC,
    );
  });

  test("breaker cascade: the PDU feeding the ToR trips and a server on the other PDU loses its link", () => {
    const { world, doc } = untilAgent("pdu-breaker-cascade");
    expect(doc.nodes.find((n) => n.id === "fault")?.params.target).toBe("pdu-a");
    const ids = world.alarms().map((a) => a.id);
    expect(ids).toEqual(
      expect.arrayContaining(["breaker_tripped:pdu-a", "server_power_lost:srv-a1"]),
    );
    expect(ids.some((id) => id.startsWith("link_down.") && id.endsWith(":srv-b1"))).toBe(true);
  });

  test("sensor drift: monitoring raises an inlet alarm while the real inlet is normal", () => {
    const { world, doc } = untilAgent("sensor-drift");
    const server = String(doc.nodes.find((n) => n.id === "fault")?.params.target);
    const alarm = world.alarms().find((a) => a.id === `inlet_high:${server}`);
    expect(alarm?.message).toContain(`${reportedInletC(world, server).toFixed(1)}°C`);
    expect(world.stateAs(server, "server").inletC).toBeLessThan(27);
    expect(reportedInletC(world, server) - world.stateAs(server, "server").inletC).toBe(12);
  });

  test("fan failure: the busy server reports stopped fans and runs hot", () => {
    const { world, doc } = untilAgent("fan-failure-throttle");
    const server = String(doc.nodes.find((n) => n.id === "fan1")?.params.target);
    expect(world.alarms().map((a) => a.id)).toContain(`fan_failed:${server}`);
    expect(world.stateAs(server, "server").cpuC).toBeGreaterThan(
      boot().world.stateAs(server, "server").cpuC + 10,
    );
  });

  test("CPU spike escalates to the host only if the agent has not diagnosed in time", () => {
    const late = untilAgent("vm-cpu-spike-escalation");
    const vm = String(late.doc.nodes.find((n) => n.id === "spike")?.params.target);
    expect(late.world.stateAs(vm, "vm").cpuUsage).toBe(1);
    expect(late.world.stateAs(vm, "vm").cpuDemand).toBeLessThan(1); // the workload itself did not change
    advance(late.physics, late.runner, 900);
    expect(
      late.world
        .faults()
        .map((f) => f.type)
        .sort(),
    ).toEqual(["cpu_runaway", "vm_cpu_spike"]);

    const template = scenarioTemplate("vm-cpu-spike-escalation");
    const { world, physics } = boot();
    const agent = fakeAgent();
    const runner = new ScenarioRunner(
      template?.build(world.index, "sample") as ScenarioDoc,
      world,
      1,
      agent.signals,
    );
    runner.start();
    advance(physics, runner, 400);
    agent.submit({ rootCause: vm, faultType: "vm_cpu_spike", summary: "", actions: [] });
    advance(physics, runner, 1200);
    expect(world.faults().map((f) => f.type)).toEqual(["vm_cpu_spike"]);
    expect(
      hasErrors(
        validateScenario(template?.build(world.index, "sample") as ScenarioDoc, {
          index: world.index,
          catalog,
        }),
      ),
    ).toBe(false);
  });
});

describe("scenario runner edge cases [REQ-034]", () => {
  test("a branch whose condition is false takes 'no'", () => {
    const { world } = boot();
    const doc = scenario(
      [
        node("b", "branch", { condition: { kind: "diagnosis_submitted" } }),
        node("no", "power", { target: "srv-a1", on: false }),
      ],
      ["start:next>b", "b:no>no"],
    );
    const runner = new ScenarioRunner(doc, world, 1, NO_AGENT);
    runner.start();
    runner.tick();
    expect(world.stateAs("srv-a1", "server").adminOn).toBe(false);
    expect(runner.nextWakeAt()).toBeUndefined();
  });

  test("an unvalidated flow that loops forever is stopped instead of hanging the session", () => {
    const { world } = boot();
    const doc = scenario(
      [node("a", "note"), node("b", "note")],
      ["start:next>a", "a:next>b", "b:next>a"],
    );
    const runner = new ScenarioRunner(doc, world, 1, NO_AGENT);
    runner.start();
    expect(() => runner.tick()).toThrow(/did not settle/);
  });

  test("an agent task without a prompt hands over an empty prompt", () => {
    const { world } = boot();
    const runner = new ScenarioRunner(
      scenario([node("agent", "agent_task")], ["start:next>agent"]),
      world,
      1,
      NO_AGENT,
    );
    runner.start();
    expect(runner.tick()[0]?.prompt).toBe("");
  });
});

describe("built-in scenarios adapt to the world [REQ-033]", () => {
  const build = (
    id: string,
    change: (bp: ReturnType<typeof sampleBlueprint>) => ReturnType<typeof sampleBlueprint>,
  ) => {
    const index = new BlueprintIndex(change(sampleBlueprint()));
    const doc = scenarioTemplate(id)?.build(index, "x") as ScenarioDoc;
    return { doc, issues: validateScenario(doc, { index, catalog }) };
  };

  test("without cooling links the cooling scenario still builds, without the servers-alive check", () => {
    const { doc, issues } = build("cooling-failure", (bp) => ({
      ...bp,
      links: bp.links.filter((l) => l.kind !== "cooling"),
    }));
    expect(doc.expectations.map((e) => e.id)).toEqual(["diagnosis", "time", "budget"]);
    expect(issues).toEqual([]);
  });

  test("without a switch on any PDU the cascade scenario scores the budget instead", () => {
    const { doc, issues } = build("pdu-breaker-cascade", (bp) =>
      withChanges(bp, { remove: ["tor-a"] }),
    );
    expect(doc.expectations.find((e) => e.id === "budget")).toMatchObject({ weight: 30 });
    expect(doc.expectations.some((e) => e.id.startsWith("restored-"))).toBe(false);
    expect(issues).toEqual([]);
  });

  test("without a cluster the CPU spike prompt names the virtual environment", () => {
    const { doc, issues } = build("vm-cpu-spike-escalation", (bp) =>
      withChanges(bp, { remove: ["cl1"] }),
    );
    expect(String(doc.nodes.find((n) => n.type === "agent_task")?.params.prompt)).toContain(
      "가상화 환경",
    );
    expect(issues).toEqual([]);
  });
});
