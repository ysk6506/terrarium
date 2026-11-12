/**
 * A campus whose halls are mostly light racks (REQ-049) must behave like one built out in full:
 * quiet at rest, and a lost feed or lost cooling reaches the light racks too.
 */
import { Catalog } from "@terrarium/core/catalog";
import { createFacades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import {
  FACILITY_TEMPLATES,
  hasErrors,
  NO_AGENT,
  ScenarioRunner,
  validateScenario,
} from "@terrarium/core/scenario";
import { type CampusSpec, DEFAULT_CAMPUS, generateCampus } from "@terrarium/core/sources/worldgen";
import { DEFAULT_TOOLSET, Toolbox } from "@terrarium/core/tools";
import { bulkOf, type Entity, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";

const catalog = new Catalog();

const light = (over: Partial<CampusSpec> = {}): CampusSpec => ({
  ...DEFAULT_CAMPUS,
  site: "hwaseong",
  seed: 11,
  buildings: 1,
  hallsPerFloor: 2,
  podsPerHall: 8,
  detail: 0.15,
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

const lightRacks = (world: World): Entity[] =>
  world.index.ofKind("rack").filter((r) => bulkOf(r) !== undefined);

describe("light-rack campuses at rest [REQ-049] [REQ-047]", () => {
  test.each(["air", "hybrid", "ai-liquid", "mixed"] as const)(
    "profile %s: quiet after half an hour, every light rack fed",
    (profile) => {
      const { world } = warm(light({ profile, buildings: 2 }), 1800);
      expect(world.alarms().map((a) => a.id)).toEqual([]);
      const racks = lightRacks(world);
      expect(racks.length).toBeGreaterThan(20);
      expect(racks.every((r) => world.stateAs(r.id, "rack").powered)).toBe(true);
      expect(racks.every((r) => world.stateAs(r.id, "rack").powerW > 0)).toBe(true);
    },
  );

  test("the electrical chain carries the light racks: a switchgear's load is theirs plus the rest", () => {
    const { world } = warm(light({ profile: "air" }), 300);
    const rack = lightRacks(world)[0] as Entity;
    const feeds = world.index.outgoing(rack.id, "power").map((l) => l.to);
    expect(feeds).toHaveLength(2);
    for (const id of feeds)
      expect(world.stateAs(id, "power_panel").loadW).toBeGreaterThan(
        world.stateAs(rack.id, "rack").powerW / 2,
      );
  });
});

describe("failures reach light racks [REQ-049] [REQ-046] [REQ-044]", () => {
  test("a block with no power darkens its light racks, which each raise an alarm", () => {
    const { world, physics } = warm(light({ powerRedundancy: "N", profile: "air" }), 300);
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
    const racks = lightRacks(world);
    expect(racks.every((r) => !world.stateAs(r.id, "rack").powered)).toBe(true);
    const lost = world.alarms().filter((a) => a.code === "rack_power_lost");
    expect(lost.length).toBe(racks.length);
  });

  test("losing the cooling plant warms a liquid light rack's loop", () => {
    const { world, physics } = warm(light({ profile: "ai-liquid", hallsPerFloor: 2 }), 600);
    const dlc = lightRacks(world).find(
      (r) =>
        world.stateAs(r.id, "rack").liquidW > 0 && world.index.outgoing(r.id, "cooling").length > 0,
    );
    expect(dlc).toBeDefined();
    for (const cdu of world.index.ofKind("cdu"))
      world.apply(
        {
          type: "fault.add",
          fault: { id: `f-${cdu.id}`, type: "cdu_failure", target: cdu.id, params: {} },
        },
        "scenario",
      );
    physics.run(300);
    expect(world.stateAs(dlc?.id ?? "", "rack").liquidW).toBe(0);
    expect(world.alarms().some((a) => a.code === "cdu_stopped")).toBe(true);
  });
});

describe("tools and scenarios on a light-rack campus [REQ-049] [REQ-033]", () => {
  test("get_entity tells what a light rack holds instead of listing servers", () => {
    const { world } = warm(light(), 60);
    const rack = lightRacks(world)[0] as Entity;
    const out = new Toolbox(DEFAULT_TOOLSET).call(
      "get_entity",
      { id: rack.id },
      { world, facades: createFacades(world) },
    ).data as { children: string[]; inventory: { servers: number; model: string } };
    expect(out.children).toEqual([]);
    expect(out.inventory.servers).toBe(bulkOf(rack)?.servers);
    expect(out.inventory.model.length).toBeGreaterThan(2);
  });

  test.each(FACILITY_TEMPLATES.map((t) => [t.id]))("%s: builds on servers that exist", (id) => {
    const template = FACILITY_TEMPLATES.find((t) => t.id === id);
    const { world, physics } = warm(light({ profile: "ai-liquid", hallsPerFloor: 2 }), 300);
    const why = template?.unavailable(world.index);
    // a generated campus has too many servers behind each UPS to switch off one call at a time (ADR-0178)
    if (id === "outage-generator-fails") {
      expect(why).toMatch(/UPS 뒤에 서버가/);
      return;
    }
    expect(why).toBeUndefined();
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
  });
});
