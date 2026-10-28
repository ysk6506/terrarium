import { Catalog } from "@terrarium/core/catalog";
import { type Blueprint, type Entity, World, type WorldEvent } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint, withChanges } from "../world/test-support/sample";
import { DEFAULT_PHYSICS, effectiveUtil, Physics, roomHeatW } from ".";

const catalog = new Catalog();
const MINUTE = 60;

function boot(bp: Blueprint = sampleBlueprint()): { world: World; physics: Physics } {
  const world = World.fromBlueprint(bp, catalog);
  const physics = new Physics(world);
  physics.settle();
  physics.run(30 * MINUTE);
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

const alarmCodes = (world: World, entityId?: string) =>
  world
    .alarms()
    .filter((a) => entityId === undefined || a.entityId === entityId)
    .map((a) => `${a.code}/${a.severity}`)
    .sort();

const gpu = (id: string, u: number): Entity => ({
  id,
  kind: "server",
  name: id,
  parentId: "rack-b",
  modelId: "srv-4u-gpu",
  placement: { type: "unit", u },
  props: { cpuUtil: 1 },
});
const powerLink = (from: string, to: string) => ({
  id: `lp-${from}`,
  kind: "power" as const,
  from,
  to,
  props: {},
});

describe("steady state [REQ-005]", () => {
  test("a healthy hall settles cool, quiet and with loads that add up", () => {
    const { world } = boot();
    expect(world.alarms()).toEqual([]);
    const room = world.stateAs("hall", "room");
    expect(room.ambientC).toBeGreaterThan(19);
    expect(room.ambientC).toBeLessThan(24);
    for (const rack of ["rack-a", "rack-b"])
      expect(world.stateAs(rack, "rack").inletC).toBeLessThan(25);
    const pduA = world.stateAs("pdu-a", "pdu").loadW;
    const devicesA = ["srv-a1", "srv-a2", "tor-a"].reduce(
      (sum, id) => sum + (world.stateOf(id) as { powerW: number }).powerW,
      0,
    );
    expect(pduA).toBeCloseTo(devicesA, 6);
    const panel = world.stateAs("panel-1", "power_panel");
    expect(panel.loadW).toBeGreaterThan(pduA + world.stateAs("pdu-b", "pdu").loadW);
    expect(panel.loadA).toBeGreaterThan(0);
    expect(world.stateAs("ups-1", "ups").loadW).toBeCloseTo(panel.loadW, 6);
    expect(roomHeatW(world, "hall")).toBeGreaterThan(2000);
  });

  test("servers draw power by load and run hotter under load", () => {
    const { world, physics } = boot();
    const idle = world.stateAs("srv-a1", "server");
    const idleCpu = idle.cpuC;
    const idlePower = idle.powerW;
    world.apply({ type: "load.set", target: "srv-a1", value: 1 }, "scenario");
    physics.run(10 * MINUTE);
    expect(world.stateAs("srv-a1", "server").powerW).toBeCloseTo(750, 0);
    expect(world.stateAs("srv-a1", "server").powerW).toBeGreaterThan(idlePower);
    expect(world.stateAs("srv-a1", "server").cpuC).toBeGreaterThan(idleCpu + 10);
  });

  test("VM demand loads its host, and a VM CPU spike pushes the host harder", () => {
    const { world, physics } = boot();
    const host = world.index.entity("srv-a1");
    const before = effectiveUtil(world, host);
    inject(world, "spike", "vm_cpu_spike", "vm-web", { demand: 1 });
    physics.run(MINUTE);
    expect(effectiveUtil(world, host)).toBeGreaterThan(before);
  });
});

describe("cooling failures [REQ-005]", () => {
  test("losing all cooling heats the hall minute by minute and raises alarms", () => {
    const { world, physics } = boot();
    inject(world, "f1", "cooling_unit_failure", "crah-1");
    inject(world, "f2", "cooling_unit_failure", "crah-2");
    const start = world.stateAs("hall", "room").ambientC;
    physics.run(5 * MINUTE);
    const after5 = world.stateAs("hall", "room").ambientC;
    physics.run(25 * MINUTE);
    const after30 = world.stateAs("hall", "room").ambientC;
    expect(after5).toBeGreaterThan(start);
    expect(after30).toBeGreaterThan(after5 + 1);
    expect(alarmCodes(world, "crah-1")).toEqual(["cooling_stopped/critical"]);
    expect(world.stateAs("crah-1", "cooling_unit")).toMatchObject({ running: false, loadKw: 0 });
    expect(world.stateOf("crah-1").health).toBe("critical");
  });

  test("a rack whose assigned unit fails falls back to the other unit, running warmer", () => {
    const { world, physics } = boot();
    inject(world, "f1", "cooling_unit_failure", "crah-1");
    physics.run(20 * MINUTE);
    const a = world.stateAs("rack-a", "rack").inletC;
    const b = world.stateAs("rack-b", "rack").inletC;
    expect(a).toBeGreaterThan(b);
  });

  test("setpoint drift raises supply air; removing the fault brings it back", () => {
    const { world, physics } = boot();
    const before = world.stateAs("rack-a", "rack").inletC;
    inject(world, "drift", "setpoint_drift", "crah-1", { deltaC: 8 });
    inject(world, "drift2", "setpoint_drift", "crah-2", { deltaC: 8 });
    physics.run(30 * MINUTE);
    const hot = world.stateAs("rack-a", "rack").inletC;
    expect(hot).toBeGreaterThan(before + 4);
    world.apply({ type: "fault.remove", faultId: "drift" }, "scenario");
    world.apply({ type: "fault.remove", faultId: "drift2" }, "scenario");
    physics.run(60 * MINUTE);
    expect(world.stateAs("rack-a", "rack").inletC).toBeLessThan(hot - 3);
  });

  test("too much heat for degraded cooling overloads it and throttles servers; losing it too shuts them down", () => {
    const bp = withChanges(sampleBlueprint(), {
      entities: [gpu("gpu-1", 26), gpu("gpu-2", 32)],
      links: [powerLink("gpu-1", "pdu-b"), powerLink("gpu-2", "pdu-a")],
    });
    const { world, physics } = boot(bp);
    inject(world, "f1", "cooling_unit_failure", "crah-2");
    inject(world, "f2", "cooling_unit_degraded", "crah-1", { factor: 0.05 });
    physics.run(120 * MINUTE);
    expect(alarmCodes(world, "crah-1")).toContain("cooling_overload/warning");
    expect(world.stateAs("gpu-1", "server").throttled).toBe(true);
    expect(world.stateAs("gpu-1", "server").powerW).toBeLessThan(6500);
    expect(alarmCodes(world, "gpu-1")).toContain("cpu_throttled/warning");
    inject(world, "f3", "cooling_unit_failure", "crah-1");
    const events = physics.run(60 * MINUTE);
    const shutdown = events.find((e) => e.type === "thermal.shutdown") as Extract<
      WorldEvent,
      { type: "thermal.shutdown" }
    >;
    expect(shutdown).toMatchObject({ cause: "physics" });
    expect(world.stateAs(shutdown.target, "server")).toMatchObject({ adminOn: false, powerW: 0 });
    expect(alarmCodes(world, shutdown.target)).toContain("thermal_shutdown/critical");
  });

  test("a failed fan makes one server hotter than its twin and raises a warning", () => {
    const { world, physics } = boot();
    world.apply({ type: "load.set", target: "srv-a1", value: 0.8 }, "scenario");
    world.apply({ type: "load.set", target: "srv-a2", value: 0.8 }, "scenario");
    inject(world, "fan", "fan_failure", "srv-a1", { fanIndex: 2 });
    physics.run(10 * MINUTE);
    const broken = world.stateAs("srv-a1", "server");
    expect(broken.cpuC).toBeGreaterThan(world.stateAs("srv-a2", "server").cpuC + 2);
    expect(broken.fanRpm[2]).toBe(0);
    expect(alarmCodes(world, "srv-a1")).toEqual(["fan_failed/warning"]);
  });
});

describe("power failures [REQ-005]", () => {
  test("a tripped PDU cuts its servers and their VMs; resetting it restores them", () => {
    const { world, physics } = boot();
    inject(world, "trip", "breaker_trip", "pdu-a");
    physics.run(MINUTE);
    expect(world.stateAs("srv-a1", "server")).toMatchObject({ powered: false, powerW: 0 });
    expect(world.stateAs("vm-web", "vm").running).toBe(false);
    expect(alarmCodes(world, "pdu-a")).toEqual(["breaker_tripped/critical"]);
    // The ToR switch hangs off the same PDU, so the server's network links go down with it.
    expect(alarmCodes(world, "srv-a1")).toContain("server_power_lost/critical");
    expect(alarmCodes(world, "tor-a")).toEqual(["switch_down/critical"]);
    expect(alarmCodes(world, "vm-web")).toEqual(["vm_down/warning"]);
    expect(world.stateAs("srv-b1", "server").powered).toBe(true);
    world.apply({ type: "breaker.reset", target: "pdu-a" }, "tool");
    physics.run(MINUTE);
    expect(world.stateAs("srv-a1", "server").powered).toBe(true);
    expect(world.stateAs("vm-web", "vm").running).toBe(true);
    expect(alarmCodes(world, "srv-a1")).toEqual([]);
  });

  test("overloading a PDU trips its breaker by itself", () => {
    const bp = withChanges(sampleBlueprint(), {
      entities: [gpu("gpu-1", 26), gpu("gpu-2", 32)],
      links: [powerLink("gpu-1", "pdu-b"), powerLink("gpu-2", "pdu-b")],
    });
    const world = World.fromBlueprint(bp, catalog);
    const events = new Physics(world).run(MINUTE);
    const trip = events.find((e) => e.type === "fault.add");
    expect(trip).toMatchObject({
      cause: "physics",
      fault: { type: "breaker_trip", target: "pdu-b" },
    });
    expect(world.stateAs("gpu-1", "server").powered).toBe(false);
  });

  test("one PSU failure is survivable, all of them are not", () => {
    const { world, physics } = boot();
    inject(world, "psu0", "psu_failure", "srv-a1", { psuIndex: 0 });
    physics.run(MINUTE);
    expect(world.stateAs("srv-a1", "server")).toMatchObject({
      powered: true,
      psuOk: [false, true],
    });
    expect(alarmCodes(world, "srv-a1")).toEqual(["psu_failed/warning"]);
    inject(world, "psu1", "psu_failure", "srv-a1", { psuIndex: 1 });
    physics.run(MINUTE);
    expect(world.stateAs("srv-a1", "server").powered).toBe(false);
    expect(alarmCodes(world, "srv-a1")).toEqual([
      "psu_failed/critical",
      "server_power_lost/critical",
    ]);
  });

  test("a grid outage runs on battery until it is empty, then everything downstream goes dark", () => {
    const { world, physics } = boot();
    inject(world, "outage", "grid_outage", "ups-1");
    inject(world, "weak", "ups_battery_degraded", "ups-1", { factor: 0.05 });
    physics.run(MINUTE);
    expect(world.stateAs("ups-1", "ups")).toMatchObject({ onBattery: true });
    expect(alarmCodes(world, "ups-1")).toContain("ups_on_battery/critical");
    expect(world.stateAs("srv-a1", "server").powered).toBe(true);
    physics.run(120 * MINUTE);
    expect(world.stateAs("ups-1", "ups").batteryPct).toBe(0);
    expect(world.stateAs("srv-a1", "server").powered).toBe(false);
    expect(world.stateAs("crah-1", "cooling_unit").running).toBe(false);
    world.apply({ type: "fault.remove", faultId: "outage" }, "scenario");
    physics.run(MINUTE);
    expect(world.stateAs("ups-1", "ups").onBattery).toBe(false);
    expect(world.stateAs("srv-a1", "server").powered).toBe(true);
  });
});

describe("network, storage and options [REQ-005]", () => {
  test("a link down or a failed switch raises link alarms on the servers", () => {
    const { world, physics } = boot();
    const link = world.index.outgoing("srv-b1", "network")[0]?.id as string;
    inject(world, "ld", "link_down", link);
    physics.run(MINUTE);
    expect(alarmCodes(world, "srv-b1")).toEqual([`link_down.${link}/warning`]);
    inject(world, "sw", "switch_failure", "tor-a");
    physics.run(MINUTE);
    expect(alarmCodes(world, "tor-a")).toEqual(["switch_down/critical"]);
    expect(world.alarms().filter((a) => a.code.startsWith("link_down")).length).toBe(4);
  });

  test("failed disks are counted and alarmed", () => {
    const { world, physics } = boot();
    inject(world, "d", "disk_failure", "stor-b", { disks: 2 });
    physics.run(MINUTE);
    expect(world.stateAs("stor-b", "storage").failedDisks).toBe(2);
    expect(alarmCodes(world, "stor-b")).toEqual(["disk_failed/warning"]);
  });

  test("the step size must be positive and partial steps reach the exact time", () => {
    expect(
      () =>
        new Physics(World.fromBlueprint(sampleBlueprint(), catalog), {
          ...DEFAULT_PHYSICS,
          stepSeconds: 0,
        }),
    ).toThrow(/stepSeconds/);
    const world = World.fromBlueprint(sampleBlueprint(), catalog);
    new Physics(world).run(25);
    expect(world.time()).toBe(25);
  });
});

describe("determinism [REQ-001] [REQ-014]", () => {
  const scenario = () => {
    const { world, physics } = boot();
    inject(world, "f1", "cooling_unit_failure", "crah-1");
    physics.run(10 * MINUTE);
    world.apply({ type: "load.set", target: "srv-b1", value: 0.9 }, "scenario");
    physics.run(10 * MINUTE);
    return { world, physics };
  };

  test("the same scenario gives exactly the same state and events", () => {
    const a = scenario().world;
    const b = scenario().world;
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(b.events()).toEqual(a.events());
  });

  test("restoring a snapshot and replaying gives the same future", () => {
    const { world, physics } = scenario();
    const snap = world.snapshot();
    physics.run(15 * MINUTE);
    const future = world.snapshot();
    world.restore(snap);
    physics.run(15 * MINUTE);
    expect(world.snapshot()).toEqual(future);
  });
});
