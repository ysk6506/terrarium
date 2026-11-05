/**
 * Generated worlds must behave like real halls: quiet at rest, and their redundancy must actually
 * carry a failure. Built-in scenarios must work on them as they do on the hand-made sample.
 */
import { Catalog } from "@terrarium/core/catalog";
import { createFacades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import {
  hasErrors,
  NO_AGENT,
  SCENARIO_TEMPLATES,
  ScenarioRunner,
  validateScenario,
} from "@terrarium/core/scenario";
import {
  DEFAULT_WORLDGEN,
  generateWorld,
  SITE_PRESETS,
  type WorldgenSpec,
} from "@terrarium/core/sources/worldgen";
import { DEFAULT_TOOLSET, Toolbox } from "@terrarium/core/tools";
import { World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";

const catalog = new Catalog();
const small = (extra: Partial<WorldgenSpec> = {}): WorldgenSpec => ({
  ...DEFAULT_WORLDGEN,
  site: "giheung",
  seed: 11,
  rows: 2,
  racksPerRow: 5,
  ...extra,
});

function warm(spec: WorldgenSpec, seconds = 1800) {
  const { blueprint } = generateWorld(spec, catalog);
  const world = World.fromBlueprint(blueprint, catalog);
  const physics = new Physics(world);
  physics.settle();
  physics.run(seconds);
  return { world, physics, blueprint };
}

const serversDown = (world: World) =>
  world.index.ofKind("server").filter((s) => !world.stateAs(s.id, "server").powered).length;

describe("generated worlds at rest [REQ-009] [REQ-005]", () => {
  test.each([
    ...SITE_PRESETS.map((p) => [p.id, {}] as const),
    [
      "hot containment, single feed, N cooling",
      { containment: "hot", powerRedundancy: "N", coolingRedundancy: "N" },
    ] as const,
    ["dense GPU hall", { fill: 0.9, gpuShare: 0.5, vmsPerHost: 0 }] as const,
    ["two rooms on two floors", { floors: 2, roomsPerFloor: 2, rows: 1, racksPerRow: 4 }] as const,
    [
      "a large site of 288 racks: panels and UPS grow with the load",
      { roomsPerFloor: 2, rows: 12, racksPerRow: 12 },
    ] as const,
    [
      "a large single-feed site",
      { roomsPerFloor: 2, rows: 8, racksPerRow: 8, powerRedundancy: "N" },
    ] as const,
  ])("%s: no alarms after half an hour", (site, extra) => {
    const preset = SITE_PRESETS.find((p) => p.id === site)?.id ?? "suwon";
    const { world } = warm(small({ site: preset, ...(extra as Partial<WorldgenSpec>) }));
    expect(world.alarms().map((a) => a.id)).toEqual([]);
  });
});

describe("generated redundancy carries a failure [REQ-005]", () => {
  test("N+1 cooling: losing one CRAH keeps every server below its inlet limit", () => {
    const { world, physics } = warm(small({ coolingRedundancy: "N+1", fill: 0.8 }));
    const unit = world.index.ofKind("cooling_unit")[0]?.id as string;
    world.apply(
      {
        type: "fault.add",
        fault: { id: "c", type: "cooling_unit_failure", target: unit, params: {} },
      },
      "scenario",
    );
    physics.run(3600);
    const hot = world
      .alarms()
      .filter((a) => a.code === "inlet_high" || a.code === "thermal_shutdown");
    expect(hot).toEqual([]);
    expect(serversDown(world)).toBe(0);
  });

  test("N cooling: with no spare, losing one CRAH overheats the servers it cooled", () => {
    const { world, physics } = warm(small({ coolingRedundancy: "N", fill: 0.8 }));
    const unit = world.index.ofKind("cooling_unit")[0]?.id as string;
    world.apply(
      {
        type: "fault.add",
        fault: { id: "c", type: "cooling_unit_failure", target: unit, params: {} },
      },
      "scenario",
    );
    physics.run(3600);
    expect(world.alarms().some((a) => a.code === "inlet_high")).toBe(true);
  });

  test("2N power: a tripped A-side panel drops no server; single feed drops them all", () => {
    const trip = (powerRedundancy: WorldgenSpec["powerRedundancy"]) => {
      const { world, physics } = warm(small({ powerRedundancy }), 600);
      const panel = world.index.ofKind("power_panel").find((p) => p.id.endsWith("-pnl-a1"))
        ?.id as string;
      world.apply(
        { type: "fault.add", fault: { id: "t", type: "breaker_trip", target: panel, params: {} } },
        "scenario",
      );
      physics.run(60);
      return { down: serversDown(world), total: world.index.ofKind("server").length };
    };
    expect(trip("2N").down).toBe(0);
    const single = trip("N");
    expect(single.down).toBe(single.total);
  });
});

describe("built-in scenarios on generated worlds [REQ-033] [REQ-009]", () => {
  test.each(SCENARIO_TEMPLATES.map((t) => [t.id]))(
    "%s: builds, validates, and the root cause alarms",
    (id) => {
      const template = SCENARIO_TEMPLATES.find((t) => t.id === id);
      const { world, physics } = warm(small(), 600);
      expect(template?.unavailable(world.index)).toBeUndefined();
      const doc = template?.build(world.index, "generated");
      if (!doc) throw new Error(id);
      expect(hasErrors(validateScenario(doc, { index: world.index, catalog }))).toBe(false);
      const runner = new ScenarioRunner(doc, world, 1, NO_AGENT);
      runner.start();
      runner.tick();
      for (let i = 0; i < 400 && !runner.agentTask; i++) {
        physics.step(10);
        runner.tick();
      }
      expect(runner.agentTask).toBeDefined();
      const roots = doc.expectations.flatMap((e) => (e.kind === "diagnosis" ? e.rootCause : []));
      const alarms = new Toolbox(DEFAULT_TOOLSET).call(
        "list_alarms",
        {},
        { world, facades: createFacades(world) },
      ).data as Array<{
        entityId: string;
      }>;
      expect(alarms.some((a) => roots.includes(a.entityId))).toBe(true);
    },
  );
});
