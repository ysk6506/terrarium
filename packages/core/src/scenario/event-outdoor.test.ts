/** The `event` condition and the outdoor-temperature block (REQ-073, ADR-0075). */
import { Catalog } from "@terrarium/core/catalog";
import { ambientDerate, Physics } from "@terrarium/core/physics";
import { BlueprintIndex, DEFAULT_OUTDOOR_C, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../world/test-support/sample";
import { campusBlueprint } from "../world/test-support/sample-campus";
import {
  CONDITION_FIELDS,
  type Condition,
  describeCondition,
  EVENT_LABELS,
  emptyScenario,
  evaluate,
  hasErrors,
  NO_AGENT,
  paletteFor,
  type ScenarioDoc,
  validateScenario,
} from ".";

const catalog = new Catalog();

function shutdownWorld() {
  const world = World.fromBlueprint(sampleBlueprint(), catalog);
  world.apply({ type: "thermal.shutdown", target: "srv-a1" }, "physics");
  return world;
}

const event = (c: Partial<Extract<Condition, { kind: "event" }>> = {}): Condition => ({
  kind: "event",
  type: "thermal.shutdown",
  ...c,
});

const withCondition = (condition: Condition): ScenarioDoc => ({
  ...emptyScenario("s", "sample"),
  nodes: [
    { id: "start", type: "start", params: {}, position: { x: 0, y: 0 } },
    { id: "agent", type: "agent_task", params: { prompt: "p" }, position: { x: 0, y: 1 } },
  ],
  edges: [{ id: "e", from: "start", port: "next", to: "agent" }],
  expectations: [{ id: "f", kind: "final_state", condition, weight: 10 }],
});

describe("the event condition asks whether something ever happened [REQ-073]", () => {
  test("it sees an event in the history, narrows by target, and can ask for never", () => {
    const world = shutdownWorld();
    expect(evaluate(event(), world, NO_AGENT)).toBe(true);
    expect(evaluate(event({ target: "srv-a1" }), world, NO_AGENT)).toBe(true);
    expect(evaluate(event({ target: "srv-a2" }), world, NO_AGENT)).toBe(false);
    expect(evaluate(event({ occurred: false }), world, NO_AGENT)).toBe(false);
    expect(evaluate(event({ occurred: false, target: "srv-a2" }), world, NO_AGENT)).toBe(true);
    expect(evaluate(event({ type: "breaker.reset" }), world, NO_AGENT)).toBe(false);
  });

  test("a fault is about its target, an alarm about its entity", () => {
    const world = World.fromBlueprint(sampleBlueprint(), catalog);
    world.apply(
      {
        type: "fault.add",
        fault: { id: "f1", type: "cooling_unit_failure", target: "crah-1", params: {} },
      },
      "scenario",
    );
    expect(evaluate(event({ type: "fault.add", target: "crah-1" }), world, NO_AGENT)).toBe(true);
    expect(evaluate(event({ type: "fault.add", target: "crah-2" }), world, NO_AGENT)).toBe(false);
  });

  test("what happened before the scenario started does not count", () => {
    const world = shutdownWorld();
    world.advance(100);
    const later = { ...NO_AGENT, scenarioStart: () => 50 };
    expect(evaluate(event(), world, later)).toBe(false);
    expect(evaluate(event(), world, { ...NO_AGENT, scenarioStart: () => 0 })).toBe(true);
  });

  test("it is described in words and checked like any other condition", () => {
    const index = new BlueprintIndex(sampleBlueprint());
    expect(describeCondition(event({ occurred: false }), index)).toBe(
      "어느 장비든 열 보호로 꺼진 적이 없어요",
    );
    expect(describeCondition(event({ target: "srv-a1" }), index)).toBe(
      "srv-a1 열 보호로 꺼진 적이 있어요",
    );
    const env = { index, catalog };
    expect(hasErrors(validateScenario(withCondition(event()), env))).toBe(false);
    const unknownType = validateScenario(withCondition(event({ type: "teleport" })), env);
    expect(unknownType[0]).toMatchObject({ code: "SC014" });
    expect(unknownType[0]?.message).toContain("알 수 없는 사건");
    const unknownTarget = validateScenario(withCondition(event({ target: "nope" })), env);
    expect(unknownTarget[0]?.message).toContain("이 세계에 'nope'가 없어요");
    expect(Object.keys(EVENT_LABELS)).toContain("thermal.shutdown");
  });
});

describe("outdoor air is a value of the world [REQ-073]", () => {
  test("it is 25 until a scenario changes it, and is not written into the state until then", () => {
    const world = World.fromBlueprint(campusBlueprint(), catalog);
    expect(world.outdoorC()).toBe(DEFAULT_OUTDOOR_C);
    expect(world.snapshot().state).not.toHaveProperty("outdoorC");
    expect(world.stateOf("site")).toMatchObject({ outdoorC: 25 });
    world.apply({ type: "outdoor.set", celsius: 38 }, "scenario");
    expect(world.outdoorC()).toBe(38);
    expect(world.stateOf("site")).toMatchObject({ outdoorC: 38 });
    const copy = World.fromBlueprint(campusBlueprint(), catalog);
    copy.adopt(world.checkpoint());
    expect(copy.outdoorC()).toBe(38);
    expect(() => world.apply({ type: "outdoor.set", celsius: 80 }, "x")).toThrow(/-30 and 50/);
    expect(() => world.apply({ type: "outdoor.set", celsius: -31 }, "x")).toThrow();
    expect(CONDITION_FIELDS.site.outdoorC?.unit).toBe("°C");
  });

  test("plants lose capacity as it warms: the chiller 15% between 25 and 40 °C, dry cooler and tower as before", () => {
    expect(ambientDerate("chiller", 25)).toBe(1);
    expect(ambientDerate("chiller", 10)).toBe(1);
    expect(ambientDerate("chiller", 32.5)).toBeCloseTo(0.925, 10);
    expect(ambientDerate("chiller", 40)).toBeCloseTo(0.85, 10);
    expect(ambientDerate("chiller", 48)).toBe(0.85);
    expect(ambientDerate("dry_cooler", 25)).toBeCloseTo(1, 10);
    expect(ambientDerate("dry_cooler", 40)).toBeCloseTo(0.85, 10);
    expect(ambientDerate("cooling_tower", 25)).toBeCloseTo(1, 10);
    expect(ambientDerate("cooling_tower", 40)).toBeCloseTo(0.94, 10);
  });

  test("a heat wave cuts what the chiller can carry, and the room's envelope follows", () => {
    const world = World.fromBlueprint(campusBlueprint(), catalog);
    const physics = new Physics(world);
    physics.settle();
    physics.run(300);
    const rated = world.stateAs("chiller-1", "chiller").capacityKw;
    world.apply({ type: "outdoor.set", celsius: 40 }, "scenario");
    physics.run(60);
    const hot = world.stateAs("chiller-1", "chiller").capacityKw;
    expect(hot / rated).toBeCloseTo(0.85, 6);
  });

  test("the block is in the palette wherever there is a site or a room, and refused out of range", () => {
    const item = paletteFor(new BlueprintIndex(sampleBlueprint())).find(
      (p) => p.key === "set_outdoor_temp",
    );
    expect(item).toMatchObject({ available: true, params: { celsius: 35 } });
    const doc = withCondition(event());
    const bad: ScenarioDoc = {
      ...doc,
      nodes: [
        ...doc.nodes,
        { id: "x", type: "set_outdoor_temp", params: { celsius: 90 }, position: { x: 0, y: 3 } },
      ],
      edges: [...doc.edges, { id: "ex", from: "agent", port: "next", to: "x" }],
    };
    const issues = validateScenario(bad, { index: new BlueprintIndex(sampleBlueprint()), catalog });
    expect(issues.find((i) => i.nodeId === "x")).toMatchObject({ code: "SC011" });
  });
});
