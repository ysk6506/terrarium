/**
 * Generated campuses must behave like real ones: quiet at rest, redundancy that really carries a
 * failure, and facility incidents (plant, liquid loop, generator) that raise the alarms they should.
 */
import { Catalog } from "@terrarium/core/catalog";
import { createFacades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import {
  ALL_SCENARIO_TEMPLATES,
  FACILITY_TEMPLATES,
  hasErrors,
  NO_AGENT,
  ScenarioRunner,
  validateScenario,
} from "@terrarium/core/scenario";
import {
  type CampusProfile,
  type CampusSpec,
  DEFAULT_CAMPUS,
  generateCampus,
} from "@terrarium/core/sources/worldgen";
import { DEFAULT_TOOLSET, Toolbox } from "@terrarium/core/tools";
import { World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";

const catalog = new Catalog();

const small = (over: Partial<CampusSpec> = {}): CampusSpec => ({
  ...DEFAULT_CAMPUS,
  site: "giheung",
  seed: 7,
  buildings: 1,
  hallsPerFloor: 2,
  podsPerHall: 2,
  ...over,
});

function warm(spec: CampusSpec, seconds = 600) {
  const { blueprint } = generateCampus(spec, catalog);
  const world = World.fromBlueprint(blueprint, catalog);
  const physics = new Physics(world);
  physics.settle();
  physics.run(seconds);
  return { world, physics, blueprint };
}

describe("generated campuses at rest [REQ-047] [REQ-005]", () => {
  test.each(["air", "hybrid", "ai-liquid", "mixed"] as CampusProfile[])(
    "profile %s: no alarms after half an hour, every server powered",
    (profile) => {
      const { world } = warm(small({ profile, buildings: 2 }), 1800);
      expect(world.alarms().map((a) => a.id)).toEqual([]);
      const servers = world.index.ofKind("server");
      expect(servers.length).toBeGreaterThan(20);
      expect(servers.every((s) => world.stateAs(s.id, "server").powered)).toBe(true);
    },
  );

  test("old halls without containment and hot-sealed halls both stay within limits", () => {
    for (const seed of [1, 2, 3]) {
      const { world } = warm(small({ seed, buildings: 2, profile: "mixed" }), 900);
      expect(world.alarms().map((a) => a.id)).toEqual([]);
    }
  });
});

describe("the power chain carries a failure [REQ-046]", () => {
  test("losing one generator leaves the building running on its spare", () => {
    const { world, physics } = warm(small({ profile: "ai-liquid", hallsPerFloor: 2 }), 300);
    const gens = world.index.ofKind("generator").filter((g) => g.props.side === "a");
    world.apply(
      {
        type: "fault.add",
        fault: {
          id: "f-gen",
          type: "generator_start_failure",
          target: gens[0]?.id ?? "",
          params: {},
        },
      },
      "scenario",
    );
    for (const t of world.index
      .ofKind("power_panel")
      .filter((p) => p.modelId === "sy-transformer-2500kva" && p.props.side === "a"))
      world.apply(
        {
          type: "fault.add",
          fault: { id: `f-${t.id}`, type: "utility_outage", target: t.id, params: {} },
        },
        "scenario",
      );
    physics.run(600);
    expect(world.index.ofKind("server").every((s) => world.stateAs(s.id, "server").powered)).toBe(
      true,
    );
  });

  test("with every generator of a switch failing, the UPS bridge runs out and servers lose power", () => {
    const { world, physics } = warm(
      small({ profile: "ai-liquid", hallsPerFloor: 2, powerRedundancy: "N" }),
      300,
    );
    for (const g of world.index.ofKind("generator"))
      world.apply(
        {
          type: "fault.add",
          fault: { id: `f-${g.id}`, type: "generator_start_failure", target: g.id, params: {} },
        },
        "scenario",
      );
    for (const t of world.index
      .ofKind("power_panel")
      .filter((p) => p.modelId === "sy-transformer-2500kva"))
      world.apply(
        {
          type: "fault.add",
          fault: { id: `f-${t.id}`, type: "utility_outage", target: t.id, params: {} },
        },
        "scenario",
      );
    physics.run(3 * 3600);
    const down = world.index.ofKind("server").filter((s) => !world.stateAs(s.id, "server").powered);
    expect(down.length).toBe(world.index.ofKind("server").length);
  });
});

describe("facility scenarios on a generated campus [REQ-033] [REQ-044] [REQ-046]", () => {
  test("the plain sample hall cannot use them, and they say why", () => {
    const { world } = warm(small({ profile: "air" }), 60);
    expect(FACILITY_TEMPLATES.length).toBe(3);
    expect(ALL_SCENARIO_TEMPLATES.length).toBeGreaterThan(FACILITY_TEMPLATES.length);
    // An air campus has chillers and generators but no CDU: only the CDU scenario is out.
    expect(
      FACILITY_TEMPLATES.find((t) => t.id === "cdu-failure")?.unavailable(world.index),
    ).toMatch(/필요한 장비/);
  });

  test.each(FACILITY_TEMPLATES.map((t) => [t.id]))(
    "%s: builds, validates, and the root cause alarms",
    (id) => {
      const template = FACILITY_TEMPLATES.find((t) => t.id === id);
      const { world, physics } = warm(small({ profile: "ai-liquid", hallsPerFloor: 2 }), 300);
      expect(template?.unavailable(world.index)).toBeUndefined();
      const doc = template?.build(world.index, "generated");
      if (!doc) throw new Error(id);
      expect(hasErrors(validateScenario(doc, { index: world.index, catalog }))).toBe(false);
      const runner = new ScenarioRunner(doc, world, 1, NO_AGENT);
      runner.start();
      runner.tick();
      for (let i = 0; i < 600 && !runner.agentTask; i++) {
        physics.step(10);
        runner.tick();
      }
      expect(runner.agentTask).toBeDefined();
      const roots = doc.expectations.flatMap((e) => (e.kind === "diagnosis" ? e.rootCause : []));
      const alarms = new Toolbox(DEFAULT_TOOLSET).call(
        "list_alarms",
        {},
        { world, facades: createFacades(world) },
      ).data as Array<{ entityId: string }>;
      expect(alarms.some((a) => roots.includes(a.entityId))).toBe(true);
    },
  );
});
