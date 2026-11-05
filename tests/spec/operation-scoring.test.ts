/**
 * Operation scoring (REQ-073, ADR-0075): the built-in scenarios that the physics rewards an operator for score what
 * the operator does, and the sheets say only what is true. Each case drives a real session through the tools an
 * agent has (power_server, vcenter_request, bacnet_request) and reads the score the oracle gives.
 */
import { ALL_SCENARIO_TEMPLATES, type ScenarioDoc } from "@terrarium/core/scenario";
import { Session } from "@terrarium/core/session";
import { TOOL_NAMES } from "@terrarium/core/tools";
import { type Blueprint, BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { campusBlueprint } from "../../packages/core/src/world/test-support/sample-campus";

type Step = readonly [tool: string, args: Record<string, unknown>];

const power = (id: string, action: "on" | "off"): Step => ["power_server", { id, action }];
const vmStop = (vm: string): Step => [
  "vcenter_request",
  { method: "POST", path: `/api/vcenter/vm/${vm}/power`, query: { action: "stop" } },
];
const bacnet = (device: string, objectType: string, instance: number, value: number): Step => [
  "bacnet_request",
  {
    service: "write-property",
    device,
    objectType,
    instance,
    property: "present-value",
    value,
    priority: 8,
  },
];

function build(id: string, blueprint: Blueprint = campusBlueprint()) {
  const template = ALL_SCENARIO_TEMPLATES.find((t) => t.id === id);
  if (!template) throw new Error(`no template ${id}`);
  return { blueprint, scenario: template.build(new BlueprintIndex(blueprint), "lab") };
}

const answerOf = (scenario: ScenarioDoc) => {
  const d = scenario.expectations.find((e) => e.kind === "diagnosis");
  if (d?.kind !== "diagnosis") throw new Error("no diagnosis");
  return { rootCause: d.rootCause[0], faultType: d.faultType[0], summary: "x" };
};

/** Run the scenario, take the steps (each must work), give the right answer, and return the session and its score. */
function operate(id: string, steps: readonly Step[], diagnose = true) {
  const { blueprint, scenario } = build(id);
  const session = Session.create({ blueprint, scenario, tools: TOOL_NAMES, seed: 1 });
  session.start();
  for (const [tool, args] of steps) {
    const result = session.call(tool, args);
    expect(result.ok, `${tool} ${JSON.stringify(args)}: ${result.error}`).toBe(true);
  }
  if (diagnose) session.call("submit_diagnosis", answerOf(scenario));
  const result = session.finish();
  return { session, scenario, score: result.score };
}

const points = (score: ReturnType<typeof operate>["score"], id: string) =>
  score.items.find((i) => i.id === id)?.points;

describe("the operation scenarios tell an operator from a reader [REQ-073]", () => {
  const CASES: ReadonlyArray<{
    readonly id: string;
    readonly fix: readonly Step[];
    readonly earned: readonly string[];
  }> = [
    {
      id: "outage-generator-fails",
      fix: [power("srv-l1", "off"), power("srv-t1", "off")],
      earned: ["battery-holds", "shed-load"],
    },
    {
      id: "vm-cpu-spike-escalation",
      fix: [vmStop("vm-db")],
      earned: ["vm-calm", "stop-vm"],
    },
    {
      id: "cdu-failure",
      fix: [power("srv-l1", "off")],
      earned: ["cpu-cool", "shed-srv-l1"],
    },
  ];

  test.each(CASES.map((c) => [c.id, c] as const))(
    "%s: knowing the answer is not enough, acting on it is",
    (id, c) => {
      const reader = operate(id, []).score;
      const operator = operate(id, c.fix).score;
      expect(reader.total, "diagnosis only").toBeLessThan(70);
      expect(operator.total, "diagnosis and the fix").toBeGreaterThanOrEqual(90);
      expect((operator.total ?? 0) - (reader.total ?? 0)).toBeGreaterThanOrEqual(25);
      for (const item of c.earned) {
        expect(points(reader, item), `${item} for the reader`).toBe(0);
        expect(points(operator, item), `${item} for the operator`).toBeGreaterThan(0);
      }
    },
  );

  test("doing the fix without the answer earns the fix and not the diagnosis", () => {
    const { score } = operate("vm-cpu-spike-escalation", [vmStop("vm-db")], false);
    expect(points(score, "vm-calm")).toBe(25);
    expect(points(score, "diagnosis")).toBe(0);
    expect(score.passed).toBe(false);
  });

  test("the outage gets a worn battery, so that the minutes count", () => {
    const { scenario } = build("outage-generator-fails");
    const worn = scenario.nodes.filter(
      (n) => n.type === "inject_fault" && n.params.faultType === "ups_battery_degraded",
    );
    expect(worn.map((n) => [n.params.target, n.params.faultParams])).toEqual([
      ["ups-2", { factor: 0.1 }],
    ]);
  });

  test("cooling failure: the other unit's setpoint is the one thing to do, and the sample campus does not need it", () => {
    const { scenario } = build("cooling-failure");
    const wanted = scenario.expectations.find((e) => e.kind === "required_action");
    expect(wanted).toMatchObject({ action: "setpoint_change", weight: 10 });
    const target = (wanted as { target: string }).target;
    const knows = operate("cooling-failure", []).score;
    const acts = operate("cooling-failure", [bacnet(target, "analog-value", 1, 17)]).score;
    expect(knows.total).toBeLessThan(100);
    expect(acts.total).toBe(100);
    // Nothing overheats either way: two 100 kW units carry a few kW of load. The sheet says so; it does not pretend.
    expect(points(knows, "servers-alive")).toBe(20);
  });
});

describe("the sheets say only what is true [REQ-073]", () => {
  test("a server an agent switched off is not alive, one heat switched off never was", () => {
    const { scenario } = build("cooling-failure");
    const alive = scenario.expectations.find((e) => e.id === "servers-alive");
    expect(JSON.stringify(alive)).toContain('"adminOn"');
    expect(JSON.stringify(alive)).toContain('"thermal.shutdown"');
    expect(JSON.stringify(alive)).not.toContain('"powered"');
    const shed = operate("cooling-failure", [power("srv-a1", "off")]).score;
    expect(points(shed, "servers-alive")).toBe(0);
  });

  test("plant loop down: shedding load is not punished, there is no such prohibition", () => {
    const { scenario } = build("plant-loop-down");
    expect(scenario.expectations.some((e) => e.kind === "forbidden_action")).toBe(false);
    const shed = operate("plant-loop-down", [power("srv-a1", "off")]).score;
    expect(shed.penalty + 0).toBe(0);
  });

  test("CDU failure: starting the CDU again is allowed, starting the overheated server again is not", () => {
    const restart = operate("cdu-failure", [bacnet("cdu-1", "binary-output", 1, 1)]).score;
    expect(restart.penalty + 0).toBe(0);
    const { scenario } = build("cdu-failure");
    const forbidden = scenario.expectations.filter((e) => e.kind === "forbidden_action");
    expect(forbidden.map((e) => (e as { target?: string }).target)).toEqual(["srv-l1"]);
    const again = operate("cdu-failure", [power("srv-l1", "off"), power("srv-l1", "on")]).score;
    expect(again.penalty).toBe(10);
  });

  test("fan failure: switching the server off costs points, because the VMs on it go with it", () => {
    const calm = operate("fan-failure-throttle", []).score;
    const off = operate("fan-failure-throttle", [power(busiest(), "off")]).score;
    expect(calm.penalty + 0).toBe(0);
    expect(off.penalty).toBe(15);
  });

  test("prompts of plant loop and CDU describe only what happens in that world", () => {
    const prompt = (id: string) =>
      String(build(id).scenario.nodes.find((n) => n.type === "agent_task")?.params.prompt);
    expect(prompt("plant-loop-down")).not.toMatch(/흡기|열 보호/);
    expect(prompt("plant-loop-down")).toMatch(/공급 온도/);
    expect(prompt("cdu-failure")).not.toMatch(/열 보호|스로틀링/);
    expect(prompt("cdu-failure")).toMatch(/CPU 온도/);
  });
});

function busiest(): string {
  const { scenario } = build("fan-failure-throttle");
  const forbidden = scenario.expectations.find((e) => e.kind === "forbidden_action");
  return (forbidden as { target: string }).target;
}

describe("the spread to the host waits for a VM that is still running [REQ-073]", () => {
  const spread = (steps: readonly Step[], diagnose: boolean) => {
    const { session } = operate("vm-cpu-spike-escalation", steps, diagnose);
    return session.world.faults().some((f) => f.type === "cpu_runaway");
  };

  test("stopping the VM, or answering, keeps the host out of it; doing neither does not", () => {
    const { blueprint, scenario } = build("vm-cpu-spike-escalation");
    const idle = Session.create({ blueprint, scenario, tools: TOOL_NAMES, seed: 1 });
    idle.start();
    idle.call("wait", { seconds: 1200 });
    expect(idle.world.faults().some((f) => f.type === "cpu_runaway")).toBe(true);
    expect(spread([vmStop("vm-db")], false)).toBe(false);
    expect(spread([], true)).toBe(false);
  });
});
