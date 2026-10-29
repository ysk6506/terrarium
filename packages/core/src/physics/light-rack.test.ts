import { Catalog } from "@terrarium/core/catalog";
import {
  type Blueprint,
  bulkPowerW,
  bulkProps,
  type Entity,
  type Link,
  World,
} from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { campusBlueprint } from "../world/test-support/sample-campus";
import { Physics } from ".";

const catalog = new Catalog();
const MINUTE = 60;

const rack = (id: string, modelId: string, x: number, load: object): Entity => ({
  id,
  kind: "rack",
  name: id,
  parentId: "hall",
  modelId,
  placement: { type: "spot", x, y: 8, rotation: 0 },
  props: bulkProps({ servers: 8, modelId: "srv-2u-compute", util: 0.5, overheadW: 400, ...load }),
});
const link = (kind: Link["kind"], from: string, to: string): Link => ({
  id: `l-${kind}-${from}-${to}`,
  kind,
  from,
  to,
  props: {},
});

/** The campus sample with an air light rack and a direct-liquid light rack. */
function withLightRacks(): Blueprint {
  const bp = campusBlueprint();
  return {
    ...bp,
    entities: [
      ...bp.entities,
      rack("lr-air", "rack-42u-std", 3, {}),
      rack("lr-dlc", "aq-48u-dlc", 5.5, { servers: 6, modelId: "ax-4u-8gpu-dlc", util: 0.6 }),
    ],
    links: [
      ...bp.links,
      link("power", "lr-air", "ups-2"),
      link("power", "lr-dlc", "ups-2"),
      link("cooling", "lr-air", "crah-1"),
      link("cooling", "lr-dlc", "cdu-1"),
    ],
  };
}

function boot(bp: Blueprint = withLightRacks()) {
  const world = World.fromBlueprint(bp, catalog);
  const physics = new Physics(world);
  physics.settle();
  physics.run(30 * MINUTE);
  return { world, physics };
}
const codes = (world: World) =>
  world
    .alarms()
    .map((a) => `${a.code}@${a.entityId}`)
    .sort();

describe("light racks in the physics [REQ-049]", () => {
  test("a light rack draws what its servers add up to, and its feed carries that", () => {
    const { world } = boot();
    const model = catalog.getOf("srv-2u-compute", "server");
    const expected = bulkPowerW(
      { servers: 8, modelId: model.id, util: 0.5, overheadW: 400 },
      model,
    );
    const state = world.stateAs("lr-air", "rack");
    expect(state.powered).toBe(true);
    expect(state.powerW).toBeCloseTo(expected, 0);
    // The UPS carries the racks and everything else standing on it.
    expect(world.stateAs("ups-2", "ups").loadW).toBeGreaterThan(expected);
    expect(world.alarms()).toEqual([]);
  });

  test("its heat warms the room and its inlet follows the cooling that reaches it", () => {
    const { world } = boot();
    const air = world.stateAs("lr-air", "rack");
    expect(air.inletC).toBeGreaterThan(18);
    expect(air.inletC).toBeLessThan(27);
    expect(air.outletC).toBeGreaterThan(air.inletC);
    expect(air.liquidW).toBe(0);
  });

  test("a direct-liquid light rack sends the liquid share of its servers to the CDU", () => {
    const { world } = boot();
    const model = catalog.getOf("ax-4u-8gpu-dlc", "server");
    const dlc = world.stateAs("lr-dlc", "rack");
    expect(dlc.liquidW).toBeCloseTo((dlc.powerW - 400) * model.liquidShare, 0);
    expect(dlc.coolantC).toBeGreaterThan(20);
    expect(world.stateAs("cdu-1", "cdu").loadKw * 1000).toBeGreaterThan(dlc.liquidW);
  });

  test("setting the load of a light rack changes its draw and heat", () => {
    const { world, physics } = boot();
    const before = world.stateAs("lr-air", "rack").powerW;
    world.apply({ type: "load.set", target: "lr-air", value: 1 }, "scenario");
    physics.run(10 * MINUTE);
    expect(world.stateAs("lr-air", "rack").powerW).toBeGreaterThan(before * 1.2);
  });

  test("losing the feed darkens the whole rack and raises one alarm for it", () => {
    const { world, physics } = boot();
    world.apply(
      {
        type: "fault.add",
        fault: { id: "u1", type: "utility_outage", target: "ats-1", params: {} },
      },
      "scenario",
    );
    world.apply(
      {
        type: "fault.add",
        fault: { id: "g1", type: "generator_start_failure", target: "gen-1", params: {} },
      },
      "scenario",
    );
    physics.run(6 * 60 * MINUTE);
    expect(world.stateAs("lr-air", "rack")).toMatchObject({ powered: false, powerW: 0 });
    expect(codes(world)).toContain("rack_power_lost@lr-air");
    expect(codes(world)).toContain("rack_power_lost@lr-dlc");
  });

  test("a liquid light rack with no flow warms its coolant and loses the loop's share", () => {
    const { world, physics } = boot();
    world.apply(
      { type: "fault.add", fault: { id: "c1", type: "cdu_failure", target: "cdu-1", params: {} } },
      "scenario",
    );
    physics.run(2 * MINUTE);
    expect(world.stateAs("lr-dlc", "rack").liquidW).toBe(0);
    expect(codes(world)).toContain("cdu_stopped@cdu-1");
  });
});
