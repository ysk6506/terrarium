/**
 * The status tools of the power and cooling layers (REQ-107, REQ-100): what an agent reads from the substation, the rack
 * batteries, the UPS and generators, the CRAH, CDU, rear-door and immersion plants, and what each says when the world has
 * no such part or the part has failed.
 */
import { Catalog } from "@terrarium/core/catalog";
import type { Facades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { TOOL_NAMES, Toolbox } from "@terrarium/core/tools";
import { type Blueprint, type EntityKind, type FaultType, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { accelLab, coolingLab, powerLab } from "./test-support/ladder-labs";

function boot(bp: Blueprint) {
  const world = World.fromBlueprint(bp, new Catalog());
  const physics = new Physics(world);
  physics.settle();
  physics.run(120);
  const box = new Toolbox(TOOL_NAMES);
  const call = (tool: string, args: Record<string, unknown> = {}) =>
    box.call(tool, args, { world, facades: {} as Facades });
  const data = (tool: string, args: Record<string, unknown> = {}) => {
    const r = call(tool, args);
    expect(r.error, `${tool}: ${r.error}`).toBeUndefined();
    return r.data as any;
  };
  const first = (kind: EntityKind) => world.index.ofKind(kind)[0]?.id as string;
  const inject = (type: FaultType, target: string, params: Record<string, number> = {}) =>
    world.apply(
      { type: "fault.add", fault: { id: `t-${type}`, type, target, params } },
      "scenario",
    );
  return { world, physics, call, data, first, inject };
}

describe("power_status lists every kind of supplier the world has [REQ-107]", () => {
  test("a substation world shows the substation with its two feeds and two transformers", () => {
    const { data } = boot(powerLab("pwr-substation"));
    const sub = data("substation_status").substations[0];
    expect(sub).toMatchObject({ status: "ok", loadPct: expect.any(Number) });
    expect(sub.feeds).toEqual([
      { feed: 1, voltage: true, active: true },
      { feed: 2, voltage: true, active: false },
    ]);
    expect(sub.transformers).toHaveLength(2);
    expect(data("power_status").substations).toHaveLength(1);
    expect(data("power_status", { id: "nothing" })).toMatchObject({ ups: [], generators: [] });
  });

  test("losing the active feed is reported with how long it has been lost", () => {
    const { data, inject, first, physics } = boot(powerLab("pwr-substation"));
    inject("utility_feed_loss", first("substation"), { feed: 1 });
    physics.run(120);
    const sub = data("substation_status").substations[0];
    expect(sub.feeds[0].voltage).toBe(false);
    expect(sub.activeFeedLostForSeconds ?? 0).toBeGreaterThanOrEqual(0);
  });

  test("a transformer that overheats no longer reads as it did", () => {
    const { data, inject, first, physics } = boot(powerLab("pwr-substation"));
    const before = data("substation_status").substations[0];
    inject("transformer_overtemp", first("substation"), { transformer: 1 });
    physics.run(1800);
    const after = data("substation_status").substations[0];
    expect(after.transformers[0]).not.toEqual(before.transformers[0]);
  });

  test("rack batteries show charge, runtime and the DC bus the rack hangs on, and can be asked by rack", () => {
    const { data, first } = boot(powerLab("pwr-rack-bbu"));
    const packs = data("bbu_status").packs;
    expect(packs).toHaveLength(3);
    expect(packs[0]).toMatchObject({
      status: "ok",
      chargePct: 100,
      onBattery: false,
      cellsFailed: 0,
    });
    expect(packs[0].dcBus).toMatch(/-dc48$/);
    expect(packs[0].busVoltageV).toBeGreaterThan(40);
    const rack = packs[1].rack as string;
    expect(data("bbu_status", { rack }).packs.map((p: { rack: string }) => p.rack)).toEqual([rack]);
    expect(data("power_status").rackBatteries).toHaveLength(3);
    expect(first("bbu")).toBe(packs[0].id);
  });

  test("a failed battery cell shows in the pack and a sagging bus shows in the bus voltage", () => {
    const { data, inject, first, physics } = boot(powerLab("pwr-rack-bbu"));
    const before = data("bbu_status").packs[0];
    inject("bbu_cell_fault", first("bbu"), {});
    physics.run(300);
    expect(data("bbu_status").packs[0].cellsFailed).toBeGreaterThan(before.cellsFailed);
    inject("dc_bus_sag", first("dc_bus"), {});
    physics.run(300);
    expect(data("bbu_status").packs.some((p: { busStatus: string }) => p.busStatus !== "ok")).toBe(
      true,
    );
  });

  test("UPS and generators are listed with their charge, load and phase", () => {
    const { data } = boot(powerLab("pwr-2n-gen"));
    const p = data("power_status");
    expect(p.ups).toHaveLength(4);
    expect(p.ups[0]).toMatchObject({
      inputOk: true,
      onBattery: false,
      batteryPct: 100,
      loadKw: 10,
    });
    expect(p.generators.map((g: { phase: string }) => g.phase)).toEqual(["standby", "standby"]);
    expect(p.generators[0].fuelPct).toBe(100);
  });
});

describe("the tools say in words what the world does not have [REQ-107]", () => {
  test.each([
    ["pwr-ab", "bbu_status", "랙 배터리(BBU)가 없어요"],
    ["pwr-ab", "substation_status", "자체 변전소가 없어요"],
  ])("a world on %s answers %s with: %s", (power, tool, words) => {
    const r = boot(powerLab(power)).call(tool);
    expect(r.error).toContain(words);
  });

  test("a world with no CDU, GPU, fabric or scheduler says so for each tool", () => {
    const { call } = boot(powerLab("pwr-ab"));
    expect(call("cdu_status").error).toContain("CDU가 없어요");
    expect(call("gpu_status").error).toContain("GPU가 없어요");
    expect(call("ib_status").error).toContain("InfiniBand/RoCE 패브릭이 없어요");
    expect(call("job_status").error).toContain("잡 스케줄러도 추론 풀도 없어요");
  });
});

describe("cooling_status and cdu_status read the plant of a liquid or rear-door hall [REQ-107]", () => {
  test("a liquid hall lists its CDUs with three pumps (two duty, one standby) and a dry leak sensor", () => {
    const { data } = boot(coolingLab("cool-liquid"));
    const cdus = data("cdu_status").cdus;
    expect(cdus).toHaveLength(2);
    expect(cdus[0]).toMatchObject({
      running: true,
      manualStandby: false,
      standbyOn: false,
      leakSensor: "dry",
    });
    expect(cdus[0].pumps.map((p: { role: string }) => p.role)).toEqual(["duty", "duty", "standby"]);
    expect(data("cooling_status").cdus).toHaveLength(2);
    expect(data("cooling_status").crah.every((c: { running: boolean }) => c.running)).toBe(true);
  });

  test("a rear-door hall lists the doors with valve and water temperatures", () => {
    const { data } = boot(coolingLab("cool-rdhx"));
    const doors = data("cooling_status").rearDoors;
    expect(doors.length).toBeGreaterThan(0);
    expect(doors[0]).toMatchObject({ status: expect.any(String), valvePct: expect.any(Number) });
    expect(doors[0].waterInC).toBeLessThan(doors[0].waterOutC + 0.001);
  });

  test("an immersion hall lists the tanks with fluid temperature, pump and level", () => {
    const { data } = boot(coolingLab("cool-immersion"));
    const tanks = data("cooling_status").tanks;
    expect(tanks.length).toBeGreaterThan(0);
    expect(tanks[0]).toMatchObject({
      pumpOk: true,
      fluidC: expect.any(Number),
      levelPct: expect.any(Number),
    });
  });

  test("a pump that fails is listed as not ok and a stuck rear-door valve shows in its row", () => {
    const liquid = boot(coolingLab("cool-liquid"));
    liquid.inject("cdu_pump_failure", liquid.first("cdu"), { pump: 1 });
    liquid.physics.run(300);
    const pumps = liquid.data("cdu_status").cdus[0].pumps as Array<{ ok: boolean }>;
    expect(pumps.some((p) => !p.ok)).toBe(true);
    const door = boot(coolingLab("cool-rdhx"));
    door.inject("rdhx_valve_stuck", door.first("rdhx"), {});
    door.physics.run(300);
    expect(door.data("cooling_status").rearDoors[0].valvePct).toEqual(expect.any(Number));
  });
});

describe("the accelerator tools read the cluster, the fabric, the jobs and the caps [REQ-107]", () => {
  test("a training cluster answers for GPUs, fabric, scheduler, jobs and rack power caps", () => {
    const { data } = boot(accelLab("gpu-training-cluster"));
    expect(data("gpu_status").servers.length).toBeGreaterThan(0);
    expect(data("ib_status")).toMatchObject({
      status: expect.any(String),
      links: expect.anything(),
    });
    const jobs = data("job_status");
    expect(jobs.scheduler).toBeDefined();
    expect(jobs.jobs.length).toBeGreaterThan(0);
    const racks = data("power_cap_status").racks;
    expect(racks[0]).toMatchObject({ limitW: expect.any(Number), powerW: expect.any(Number) });
    expect(racks[0].servers[0]).toMatchObject({ capW: null, throttled: false, running: true });
  });

  test("a serving pool has pools and jobs but no scheduler and no fabric", () => {
    const { data, call } = boot(accelLab("gpu-serving-pool"));
    const jobs = data("job_status");
    expect(jobs.scheduler).toBeUndefined();
    expect(jobs.pools.length).toBeGreaterThan(0);
    expect(call("ib_status").error).toContain("패브릭이 없어요");
  });
});
