/**
 * The event condition in a saved document, and the outdoor-air block through a whole session and the tools (REQ-073,
 * ADR-0075). The parts that stay inside the scenario layer are in packages/core/src/scenario/event-outdoor.test.ts.
 */
import { Catalog } from "@terrarium/core/catalog";
import { ScenarioDocSchema } from "@terrarium/core/contract";
import { createFacades } from "@terrarium/core/facades";
import { CONTROL_ROWS, emptyScenario, type ScenarioDoc } from "@terrarium/core/scenario";
import { Session } from "@terrarium/core/session";
import { TOOL_NAMES, Toolbox } from "@terrarium/core/tools";
import { World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { campusBlueprint } from "../../packages/core/src/world/test-support/sample-campus";

const catalog = new Catalog();

describe("the event condition is kept in the saved document [REQ-073]", () => {
  test("the saved document keeps it", () => {
    const doc = {
      ...emptyScenario("s", "sample"),
      nodes: [
        { id: "start", type: "start", params: {}, position: { x: 0, y: 0 } },
        { id: "agent", type: "agent_task", params: { prompt: "p" }, position: { x: 0, y: 1 } },
      ],
      edges: [{ id: "e", from: "start", port: "next", to: "agent" }],
      expectations: [
        {
          id: "f",
          kind: "final_state",
          condition: { kind: "event", type: "thermal.shutdown", target: "srv-a1", occurred: false },
          weight: 10,
        },
      ],
    };
    expect(ScenarioDocSchema.parse(doc)).toEqual(doc);
  });
});

describe("outdoor air reaches the tools [REQ-073]", () => {
  test("the block runs in a scenario, the BACnet weather input reads it, and a condition can test it", () => {
    const blueprint = campusBlueprint();
    const scenario: ScenarioDoc = {
      ...emptyScenario("heat", "campus-sample"),
      nodes: [
        { id: "start", type: "start", params: {}, position: { x: 0, y: 0 } },
        { id: "heat", type: "set_outdoor_temp", params: { celsius: 38 }, position: { x: 0, y: 1 } },
        { id: "agent", type: "agent_task", params: { prompt: "p" }, position: { x: 0, y: 2 } },
      ],
      edges: [
        { id: "e1", from: "start", port: "next", to: "heat" },
        { id: "e2", from: "heat", port: "next", to: "agent" },
      ],
      expectations: [
        {
          id: "hot",
          kind: "final_state",
          condition: { kind: "state", entity: "site", field: "outdoorC", op: ">=", value: 38 },
          weight: 10,
        },
      ],
    };
    const session = Session.create({ blueprint, scenario, tools: TOOL_NAMES, seed: 1 });
    session.start();
    expect(session.world.outdoorC()).toBe(38);
    for (const device of ["chiller-1", "crah-1"]) {
      const answer = session.call("bacnet_request", {
        service: "read-property",
        device,
        objectType: "analog-input",
        instance: device === "chiller-1" ? 6 : 5,
        property: "present-value",
      });
      expect(answer.ok).toBe(true);
      expect(JSON.stringify(answer.data)).toContain("38");
    }
    expect(session.finish().score.items[0]?.verdict).toBe("pass");
    // Nobody at the console can change the weather.
    const row = CONTROL_ROWS.find((r) => r.command === "outdoor.set");
    expect(row).toMatchObject({ agent: [], actions: [], blocks: ["set_outdoor_temp"] });
    expect(row?.note).toBeTruthy();
  });

  test("the weather input is on cooling units and chillers and reads the world's value", () => {
    const world = World.fromBlueprint(campusBlueprint(), catalog);
    world.apply({ type: "outdoor.set", celsius: -5 }, "scenario");
    const tools = new Toolbox(TOOL_NAMES);
    const ctx = { world, facades: createFacades(world) };
    const read = tools.call(
      "bacnet_request",
      {
        service: "read-property",
        device: "chiller-1",
        objectType: "analog-input",
        instance: 6,
        property: "object-name",
      },
      ctx,
    );
    expect(JSON.stringify(read.data)).toContain("Outdoor-Air-Temperature");
  });
});
