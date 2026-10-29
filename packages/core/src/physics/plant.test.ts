import { Catalog } from "@terrarium/core/catalog";
import { type Blueprint, type Entity, type Link, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { campusBlueprint } from "../world/test-support/sample-campus";
import { Physics } from ".";

const catalog = new Catalog();
const MINUTE = 60;

const server = (id: string, rack: string, u: number, modelId: string): Entity => ({
  id,
  kind: "server",
  name: id,
  parentId: rack,
  modelId,
  placement: { type: "unit", u },
  props: { cpuUtil: 1 },
});
const feed = (id: string): Link => ({
  id: `lp-${id}`,
  kind: "power",
  from: id,
  to: "ups-2",
  props: {},
});

/** The campus sample with a full 48U DLC rack (9 GPU servers) and a well-stocked immersion tank (10 servers). */
function loaded(): Blueprint {
  const bp = campusBlueprint();
  const dlc = Array.from({ length: 8 }, (_, i) =>
    server(`srv-l${i + 2}`, "rack-l", 14 + i * 4, "ax-4u-8gpu-dlc"),
  );
  const imm = Array.from({ length: 9 }, (_, i) =>
    server(`srv-t${i + 2}`, "tank-1", 6 + i * 2, "sm-2u-imm"),
  );
  return {
    ...bp,
    entities: [...bp.entities, ...dlc, ...imm],
    links: [...bp.links, ...[...dlc, ...imm].map((s) => feed(s.id))],
  };
}

function boot(bp: Blueprint = campusBlueprint(), minutes = 30) {
  const world = World.fromBlueprint(bp, catalog);
  const physics = new Physics(world);
  physics.settle();
  physics.run(minutes * MINUTE);
  return { world, physics };
}

const inject = (
  world: World,
  id: string,
  type: string,
  target: string,
  params: Record<string, number> = {},
) =>
  world.apply(
    { type: "fault.add", fault: { id, type: type as never, target, params } },
    "scenario",
  );
const clear = (world: World, id: string) =>
  world.apply({ type: "fault.remove", faultId: id }, "scenario");
const codes = (world: World) =>
  world
    .alarms()
    .map((a) => `${a.code}@${a.entityId}`)
    .sort();

describe("power chain: utility, transfer switch, generator, UPS [REQ-046]", () => {
  test("a utility outage is bridged by the UPS until the generator takes over, then handed back", () => {
    const { world, physics } = boot();
    expect(world.alarms()).toEqual([]);
    expect(world.stateAs("gen-1", "generator").phase).toBe("standby");

    inject(world, "u1", "utility_outage", "ats-1");
    physics.run(10);
    // The switch has lost its utility side: the UPS is on battery, the generator is cranking.
    expect(world.stateAs("ats-1", "power_panel").powered).toBe(false);
    expect(world.stateAs("ups-2", "ups")).toMatchObject({ inputOk: false, onBattery: true });
    expect(world.stateAs("gen-1", "generator").phase).toBe("starting");
    expect(world.stateAs("srv-l1", "server").powered).toBe(true);
    expect(codes(world)).toContain("ups_on_battery@ups-2");

    physics.run(60);
    const gen = world.stateAs("gen-1", "generator");
    expect(gen.phase).toBe("running");
    expect(gen.loadKw).toBeGreaterThan(10);
    expect(world.stateAs("ups-2", "ups")).toMatchObject({ inputOk: true, onBattery: false });
    expect(world.stateAs("srv-l1", "server").powered).toBe(true);
    expect(codes(world)).toContain("generator_running@gen-1");
    // The UPS held the load while the engine started, so its battery barely moved.
    expect(world.stateAs("ups-2", "ups").batteryPct).toBeGreaterThan(98);

    physics.run(10 * MINUTE);
    expect(world.stateAs("gen-1", "generator").fuelPct).toBeLessThan(100);

    clear(world, "u1");
    physics.run(30);
    expect(world.stateAs("gen-1", "generator")).toMatchObject({ phase: "standby", loadKw: 0 });
    expect(world.alarms()).toEqual([]);
  });

  test("if the generator will not start the UPS runs down and the servers lose power", () => {
    const { world, physics } = boot();
    inject(world, "g1", "generator_start_failure", "gen-1");
    inject(world, "u1", "utility_outage", "ats-1");
    physics.run(2 * MINUTE);
    expect(world.stateAs("gen-1", "generator").phase).toBe("failed");
    expect(codes(world)).toContain("generator_failed@gen-1");
    expect(world.stateAs("srv-l1", "server").powered).toBe(true);
    physics.run(4 * 60 * MINUTE);
    expect(world.stateAs("ups-2", "ups").batteryPct).toBe(0);
    expect(world.stateAs("srv-l1", "server").powered).toBe(false);
    expect(codes(world)).toContain("server_power_lost@srv-l1");
  });

  test("a stuck transfer switch stays on the dead utility even though the generator runs", () => {
    const { world, physics } = boot();
    inject(world, "s1", "ats_stuck", "ats-1");
    inject(world, "u1", "utility_outage", "ats-1");
    physics.run(3 * MINUTE);
    expect(world.stateAs("gen-1", "generator").phase).toBe("running");
    expect(world.stateAs("ats-1", "power_panel").powered).toBe(false);
    expect(world.stateAs("ups-2", "ups").onBattery).toBe(true);
    expect(world.stateAs("gen-1", "generator").loadKw).toBe(0);
  });

  test("plant equipment on the transfer switch stops with it and restarts on the generator", () => {
    const { world, physics } = boot();
    inject(world, "u1", "utility_outage", "ats-1");
    physics.run(10);
    expect(world.stateAs("chiller-1", "chiller").running).toBe(false);
    physics.run(MINUTE);
    expect(world.stateAs("chiller-1", "chiller").running).toBe(true);
  });
});

describe("liquid cooling: CDU, chiller, direct-to-chip racks, immersion tanks [REQ-044]", () => {
  test("a direct-liquid rack sends most of its heat to the loop, and the room feels the rest", () => {
    const { world } = boot(loaded());
    const rack = world.stateAs("rack-l", "rack");
    expect(rack.powerW).toBeGreaterThan(30_000);
    expect(rack.liquidW / rack.powerW).toBeCloseTo(0.8, 1);
    expect(rack.coolantC).toBeCloseTo(32, 0);
    const cdu = world.stateAs("cdu-1", "cdu");
    expect(cdu.loadKw * 1000).toBeGreaterThan(rack.liquidW);
    expect(cdu.supplyC).toBeCloseTo(cdu.supplyC > 0 ? 32 : 0, 0);
    expect(world.stateAs("chiller-1", "chiller").loadKw).toBeCloseTo(cdu.loadKw, 0);
    expect(world.stateAs("srv-l2", "server").cpuC).toBeLessThan(80);
    expect(world.alarms().filter((a) => a.severity === "critical")).toEqual([]);
  });

  test("an immersion tank holds its heat in the fluid and hands it to the loop", () => {
    const { world } = boot(loaded());
    const tank = world.stateAs("tank-1", "rack");
    expect(tank.bathC).toBeGreaterThan(world.stateAs("cdu-1", "cdu").supplyC);
    expect(tank.bathC).toBeLessThan(45);
    expect(tank.liquidW).toBeGreaterThan(0.9 * tank.powerW);
    expect(world.stateAs("srv-t2", "server").fanRpm).toEqual([]);
  });

  test("losing the CDU leaves liquid-cooled servers to their fans and they shut down hot", () => {
    const { world, physics } = boot(loaded());
    inject(world, "c1", "cdu_failure", "cdu-1");
    physics.run(MINUTE);
    expect(codes(world)).toContain("cdu_stopped@cdu-1");
    expect(world.stateAs("rack-l", "rack").liquidW).toBe(0);
    // The fans were built for the share of heat the cold plates took, so the CPUs run away within a minute...
    expect(world.stateAs("srv-l2", "server")).toMatchObject({ throttled: true });
    expect(world.stateAs("srv-l2", "server").cpuC).toBeGreaterThan(90);
    physics.run(2 * MINUTE);
    // ...and the machine protects itself.
    expect(world.stateAs("srv-l2", "server").adminOn).toBe(false);
    expect(codes(world)).toContain("thermal_shutdown@srv-l2");
    // With nothing left to heat it the standing coolant stops warming towards the plate temperature.
    const standing = world.stateAs("rack-l", "rack").coolantC;
    physics.run(10 * MINUTE);
    expect(world.stateAs("rack-l", "rack").coolantC).toBeLessThan(standing + 15);
    clear(world, "c1");
    physics.run(10 * MINUTE);
    expect(world.stateAs("cdu-1", "cdu").running).toBe(true);
    expect(world.stateAs("rack-l", "rack").coolantC).toBeLessThan(35);
  });

  test("a CDU keeps its capacity through one pump failure and loses it with two", () => {
    const { world, physics } = boot();
    inject(world, "p1", "cdu_pump_failure", "cdu-1", { pumps: 1 });
    physics.run(MINUTE);
    expect(world.stateAs("cdu-1", "cdu").capacityKw).toBe(500);
    expect(codes(world)).toContain("cdu_pump_failed@cdu-1");
    clear(world, "p1");
    inject(world, "p2", "cdu_pump_failure", "cdu-1", { pumps: 2 });
    physics.run(MINUTE);
    expect(world.stateAs("cdu-1", "cdu").capacityKw).toBe(250);
  });

  test("when the CDU cannot keep up its coolant warms in proportion to the shortfall", () => {
    const { world, physics } = boot(loaded());
    inject(world, "p3", "cdu_pump_failure", "cdu-1", { pumps: 3 });
    physics.run(10);
    // No pumps: the CDU stops moving coolant.
    expect(world.stateAs("cdu-1", "cdu").running).toBe(true);
    expect(world.stateAs("cdu-1", "cdu").capacityKw).toBe(0);
    const before = world.stateAs("cdu-1", "cdu").supplyC;
    physics.run(10 * MINUTE);
    expect(world.stateAs("cdu-1", "cdu").supplyC).toBeGreaterThan(before + 3);
    expect(codes(world)).toContain("cdu_supply_high@cdu-1");
  });

  test("losing the chiller is ridden through on the buffer, then the whole chain warms", () => {
    const { world, physics } = boot(loaded());
    inject(world, "k1", "chiller_failure", "chiller-1");
    physics.run(MINUTE);
    expect(codes(world)).toContain("chiller_stopped@chiller-1");
    const early = { ...world.stateAs("cdu-1", "cdu") };
    expect(early.capacityKw).toBeGreaterThan(300);
    physics.run(30 * MINUTE);
    const late = world.stateAs("cdu-1", "cdu");
    expect(late.capacityKw).toBeLessThan(early.capacityKw);
    expect(world.stateAs("chiller-1", "chiller").supplyC).toBeGreaterThan(14);
    // The CDU still has more capacity than the racks need, so the racks notice nothing yet...
    expect(late.supplyC).toBeCloseTo(early.supplyC, 0);
    // ...until the plant water is too warm to take their heat, hours later.
    physics.run(4 * 60 * MINUTE);
    expect(world.stateAs("cdu-1", "cdu").supplyC).toBeGreaterThan(early.supplyC + 3);
    expect(codes(world)).toContain("cdu_supply_high@cdu-1");
  });

  test("a degraded chiller still serves a light load; a CDU leak shuts that rack's supply off after the delay", () => {
    const { world, physics } = boot(loaded());
    inject(world, "d1", "chiller_degraded", "chiller-1", { factor: 0.5 });
    physics.run(5 * MINUTE);
    expect(world.stateAs("chiller-1", "chiller").capacityKw).toBe(500);
    expect(world.stateAs("rack-l", "rack").liquidW).toBeGreaterThan(0);
    inject(world, "l1", "coolant_leak", "rack-l", { shutoffSeconds: 60 });
    physics.run(30);
    expect(codes(world)).toContain("coolant_leak@rack-l");
    expect(world.stateAs("rack-l", "rack").liquidW).toBeGreaterThan(0);
    physics.run(2 * MINUTE);
    expect(world.stateAs("rack-l", "rack").liquidW).toBe(0);
    expect(world.stateAs("tank-1", "rack").liquidW).toBeGreaterThan(0);
  });

  test("a tank whose fluid stops circulating warms until its servers are in trouble", () => {
    const { world, physics } = boot(loaded());
    const steady = world.stateAs("tank-1", "rack").bathC;
    inject(world, "i1", "immersion_circulation_failure", "tank-1");
    physics.run(20 * MINUTE);
    const warm = world.stateAs("tank-1", "rack").bathC;
    expect(warm).toBeGreaterThan(steady + 5);
    expect(world.stateAs("srv-t2", "server").cpuC).toBeGreaterThan(warm);
    physics.run(60 * MINUTE);
    expect(codes(world)).toContain("bath_temp_high@tank-1");
  });
});
