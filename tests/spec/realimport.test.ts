/**
 * Reality is only ever read (REQ-011), and what is read becomes a world the simulator can run
 * (REQ-010): quiet at rest, and usable by the built-in scenarios.
 */
import { Catalog } from "@terrarium/core/catalog";
import { createFacades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { hasErrors, SCENARIO_TEMPLATES, validateScenario } from "@terrarium/core/scenario";
import { Session } from "@terrarium/core/session";
import {
  importReality,
  MemorySource,
  type RealitySource,
  sampleGraph,
} from "@terrarium/core/sources/realimport";
import { DEFAULT_TOOLSET } from "@terrarium/core/tools";
import { World } from "@terrarium/core/world";
import { describe, expect, expectTypeOf, test } from "vitest";

const catalog = new Catalog();

/** Wraps a source and records every property it is asked for. */
function watched(source: RealitySource) {
  const touched: string[] = [];
  const proxy = new Proxy(source, {
    get(target, key, receiver) {
      touched.push(String(key));
      const value = Reflect.get(target, key, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set() {
      throw new Error("an import tried to change its source");
    },
  });
  return { proxy, touched };
}

describe("reality is read, never changed [REQ-011]", () => {
  test("the source port has only reading methods", () => {
    expectTypeOf<keyof RealitySource>().toEqualTypeOf<
      "name" | "summary" | "nodes" | "relationships"
    >();
  });

  test("an import touches nothing on its source but the reading methods", async () => {
    const { proxy, touched } = watched(new MemorySource("watched", sampleGraph()));
    await importReality(proxy, { catalog });
    expect([...new Set(touched)].sort()).toEqual(["name", "nodes", "relationships", "summary"]);
  });

  test("the graph records themselves are left exactly as they were", async () => {
    const graph = sampleGraph();
    const before = JSON.stringify(graph);
    await importReality(new MemorySource("frozen", graph), { catalog });
    expect(JSON.stringify(graph)).toBe(before);
  });
});

describe("an imported world can be simulated [REQ-010]", () => {
  async function imported() {
    const { blueprint } = await importReality(new MemorySource("sample", sampleGraph()), {
      catalog,
    });
    return blueprint;
  }

  test("it is quiet after half an hour at rest", async () => {
    const world = World.fromBlueprint(await imported(), catalog);
    const physics = new Physics(world);
    physics.settle();
    physics.run(1800);
    expect(world.alarms().map((a) => a.id)).toEqual([]);
    expect(
      createFacades(world).vcenter.handle({
        method: "GET",
        path: "/api/vcenter/vm",
        query: {},
        headers: {},
      }).status,
    ).toBe(200);
  });

  test("every built-in scenario fits it and a session runs to a score", async () => {
    const blueprint = await imported();
    const index = World.fromBlueprint(blueprint, catalog).index;
    for (const template of SCENARIO_TEMPLATES) {
      expect([template.id, template.unavailable(index)]).toEqual([template.id, undefined]);
      const doc = template.build(index, blueprint.id);
      expect([template.id, hasErrors(validateScenario(doc, { index, catalog }))]).toEqual([
        template.id,
        false,
      ]);
    }
    const doc = SCENARIO_TEMPLATES.find((t) => t.id === "pdu-breaker-cascade")?.build(
      index,
      blueprint.id,
    );
    const session = Session.create({
      blueprint,
      scenario: doc as never,
      tools: DEFAULT_TOOLSET,
      seed: 1,
    });
    session.start();
    const alarms = session.call("list_alarms", { severity: "critical" });
    expect((alarms.data as unknown[]).length).toBeGreaterThan(0);
    const target = String(doc?.nodes.find((n) => n.type === "inject_fault")?.params.target);
    session.call("reset_breaker", { id: target });
    session.call("submit_diagnosis", {
      rootCause: target,
      faultType: "breaker_trip",
      summary: "PDU 차단기 트립",
    });
    expect(session.finish().score.passed).toBe(true);
  });
});
