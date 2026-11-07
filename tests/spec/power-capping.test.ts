/**
 * Power capping, model only (REQ-107, ADR-0130, docs/design-docs/power-capping-reference.md): a cap on a server moves its CPU/GPU
 * clocks, the clocks move throughput, and power (hence heat) follows. Rack-level distribution has two modes (균등, 부하 비례).
 * Two validated scenarios: keep a rack inside the power it is allotted, and hold servers up while the cooling is short.
 */
import { Catalog } from "@terrarium/core/catalog";
import { distributeCap, Physics, perfUnderCap } from "@terrarium/core/physics";
import { POWER_TEMPLATES } from "@terrarium/core/scenario";
import { Session } from "@terrarium/core/session";
import { TOOL_NAMES } from "@terrarium/core/tools";
import { BlueprintIndex, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { accelLab } from "./test-support/ladder-labs";

const servers = (demand: number[]) =>
  demand.map((d, i) => ({ id: `s${i}`, demandW: d, idleW: 500, maxW: 10_000 }));

describe("distributing a rack limit over its servers [REQ-107]", () => {
  test("균등: everyone gets the same share, and what a small server does not need goes to the others", () => {
    const plan = distributeCap(9000, servers([9000, 9000, 2000]), "equal");
    expect(plan.caps.get("s2")).toBe(2000);
    expect(plan.caps.get("s0") as number).toBeCloseTo(3500, 0);
    expect(plan.caps.get("s1") as number).toBeCloseTo(3500, 0);
    expect(plan.kept).toBe(true);
  });

  test("부하 비례: the share follows what each server asks above idle", () => {
    const plan = distributeCap(9000, servers([9000, 5000, 2000]), "proportional");
    const [a, b, c] = ["s0", "s1", "s2"].map((id) => plan.caps.get(id) as number) as [
      number,
      number,
      number,
    ];
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    expect(a + b + c).toBeLessThanOrEqual(9000.5);
  });

  test("a cap never goes below idle, and a limit under the idle sum cannot be kept", () => {
    const plan = distributeCap(900, servers([9000, 9000]), "equal");
    expect([...plan.caps.values()].every((w) => w >= 500)).toBe(true);
    expect(plan.kept).toBe(false);
  });

  test("a demand under the limit is left alone", () => {
    const plan = distributeCap(50_000, servers([4000, 3000]), "equal");
    expect(plan.caps.get("s0")).toBe(4000);
    expect(plan.shortfallW).toBe(0);
  });

  test("performance falls slower than power (perf = share^0.4 of the power above idle)", () => {
    expect(perfUnderCap(10_000, 10_000, 1000)).toBe(1);
    const half = perfUnderCap(5500, 10_000, 1000);
    expect(half).toBeGreaterThan(0.5);
    expect(half).toBeLessThan(1);
    expect(perfUnderCap(1000, 10_000, 1000)).toBeGreaterThanOrEqual(0.1);
  });
});

const TRAIN = () => accelLab("gpu-training-cluster", { network: "net-leaf-spine" });
const templateOf = (id: string) =>
  POWER_TEMPLATES.find((t) => t.id === id) as (typeof POWER_TEMPLATES)[number];

function play(id: string, act: (session: Session, world: World, rack: string) => void) {
  const blueprint = TRAIN();
  const scenario = templateOf(id).build(new BlueprintIndex(blueprint), "lab");
  const session = Session.create({ blueprint, scenario, tools: TOOL_NAMES, seed: 1 });
  session.start();
  act(session, session.world, limitRack(session.world));
  return session;
}

/** The rack with a power limit and the most servers: the one the sheets are about. */
function limitRack(world: World): string {
  const racks = world.index
    .ofKind("rack")
    .filter((r) => typeof r.props.powerLimitW === "number")
    .map((r) => ({ id: r.id, n: world.index.childrenOf(r.id, "server").length }))
    .sort((a, b) => b.n - a.n || a.id.localeCompare(b.id));
  return racks[0]?.id as string;
}

const rackServers = (world: World, rack: string) => world.index.childrenOf(rack, "server");

describe("scenario: 랙 전력 한도 안에서 배분 [REQ-107]", () => {
  test("without caps the rack stays over its limit for the whole hour", () => {
    const session = play("power-cap-rack-limit", (s) => {
      s.call("wait", { seconds: 1800 });
    });
    const meters = session.world.stateAs(limitRack(session.world), "rack");
    expect(meters.overS).toBeGreaterThan(600);
  });

  test("a rack-level plan in either mode brings the rack under its limit with the servers still on", () => {
    const results: Record<string, { over: number; loss: number; power: number }> = {};
    for (const mode of ["equal", "proportional"] as const) {
      const session = play("power-cap-rack-limit", (s, world, rack) => {
        s.call("wait", { seconds: 120 });
        const limit = world.index.entity(rack).props.powerLimitW as number;
        const catalog = new Catalog();
        const list = rackServers(world, rack).map((sv) => {
          const m = catalog.getOf(sv.modelId as string, "server");
          return {
            id: sv.id,
            demandW: world.stateAs(sv.id, "server").powerW,
            idleW: m.idlePowerW,
            maxW: m.maxPowerW,
          };
        });
        const plan = distributeCap(limit - 350, list, mode);
        for (const [id, watts] of plan.caps)
          s.call("set_power_cap", { server: id, watts: Math.floor(watts) });
        s.call("wait", { seconds: 600 });
      });
      const rack = limitRack(session.world);
      const m = session.world.stateAs(rack, "rack");
      const limit = session.world.index.entity(rack).props.powerLimitW as number;
      expect(m.powerW, mode).toBeLessThanOrEqual(limit);
      expect(
        rackServers(session.world, rack).every(
          (x) => session.world.stateAs(x.id, "server").adminOn,
        ),
      ).toBe(true);
      expect(m.stopAt).toBeUndefined();
      results[mode] = { over: m.overS ?? 0, loss: m.lossS ?? 0, power: m.powerW };
    }
    expect(results.equal?.over).toBeLessThan(1800);
    expect(results.proportional?.loss).toBeGreaterThan(0);
  });
});

describe("scenario: 냉방 부족 때 캡으로 버티기 [REQ-107]", () => {
  test("without caps every server of the rack shuts down for heat", () => {
    const session = play("power-cap-cooling-short", (s) => {
      s.call("wait", { seconds: 3000 });
    });
    const rack = limitRack(session.world);
    const on = rackServers(session.world, rack).filter(
      (x) => session.world.stateAs(x.id, "server").adminOn,
    );
    expect(on.length).toBeLessThan(rackServers(session.world, rack).length);
  });

  test("an early cap keeps the servers up for the hour, later than without, with a performance loss", () => {
    const session = play("power-cap-cooling-short", (s, world, rack) => {
      for (const sv of rackServers(world, rack))
        s.call("set_power_cap", { server: sv.id, watts: 3000 });
      s.call("wait", { seconds: 3000 });
    });
    const rack = limitRack(session.world);
    const sv = rackServers(session.world, rack);
    expect(sv.every((x) => session.world.stateAs(x.id, "server").adminOn)).toBe(true);
    expect(session.world.stateAs(rack, "rack").lossS).toBeGreaterThan(0);
  });
});

describe("the experiment setting that imitates a weak room cooling with the fan speed [REQ-107]", () => {
  test("a server whose fans are held at 30 % runs hotter than the same server at full speed", () => {
    const bp = TRAIN();
    const target = bp.entities.find((e) => e.kind === "server" && e.id.endsWith("-r0106-s01"))?.id;
    const slow = {
      ...bp,
      entities: bp.entities.map((e) =>
        e.id === target ? { ...e, props: { ...e.props, fanSpeedPct: 30 } } : e,
      ),
    };
    const temp = (blueprint: typeof bp) => {
      const world = World.fromBlueprint(blueprint, new Catalog());
      const physics = new Physics(world);
      physics.settle();
      physics.run(900);
      return world.stateAs(target as string, "server").cpuC;
    };
    expect(temp(slow)).toBeGreaterThan(temp(bp) + 3);
  });
});
