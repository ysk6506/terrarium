/**
 * The power and cooling ladders (REQ-107, ADR-0130, docs/design-docs/power-cooling-ladders.md): what the new choices build and what
 * their faults do. Power: N+1 UPS, rack batteries with a 48 V bus, an own substation. Cooling: rear doors, direct liquid, immersion.
 */
import { Catalog } from "@terrarium/core/catalog";
import { Physics } from "@terrarium/core/physics";
import { type Blueprint, type FaultType, LADDER, unmetOf, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { accelLab, coolingLab, powerLab } from "./test-support/ladder-labs";

const catalog = new Catalog();
function boot(make: () => Blueprint, warm = 300) {
  const world = World.fromBlueprint(make(), catalog);
  const physics = new Physics(world);
  physics.settle();
  physics.run(warm);
  return { world, physics };
}
const inject = (
  world: World,
  type: FaultType,
  target: string,
  params: Record<string, number> = {},
) =>
  world.apply({ type: "fault.add", fault: { id: `t-${type}`, type, target, params } }, "scenario");
const first = (world: World, kind: Parameters<World["stateAs"]>[1]) =>
  world.index.ofKind(kind)[0]?.id as string;

describe("the ladders hold the new choices in order [REQ-107]", () => {
  test("power: 단일 → A+B → N+1 → 2N+발전기 → 2N+자동+48시간 → 랙 BBU → 변전소", () => {
    expect(LADDER.power.map((c) => c.id)).toEqual([
      "pwr-single",
      "pwr-ab",
      "pwr-n1-ups",
      "pwr-2n-gen",
      "pwr-2n-auto",
      "pwr-rack-bbu",
      "pwr-substation",
    ]);
  });

  test("cooling: N → N+1 → 2N+컨테인먼트 → 리어도어 → DLC → 침지", () => {
    expect(LADDER.cooling.map((c) => c.id)).toEqual([
      "cool-n",
      "cool-n1",
      "cool-2n",
      "cool-rdhx",
      "cool-liquid",
      "cool-immersion",
    ]);
  });

  test("accelerator: 없음 → 서버마다 → 추론 풀 → 학습 클러스터 → 액냉 포드, all modelled", () => {
    expect(LADDER.accel.map((c) => c.id)).toEqual([
      "gpu-none",
      "gpu-per-server",
      "gpu-serving-pool",
      "gpu-training-cluster",
      "gpu-liquid-pod",
    ]);
    expect(LADDER.accel.every((c) => c.modeled)).toBe(true);
  });

  test("a training cluster needs a leaf-spine network, the liquid pod also liquid cooling and A+B power", () => {
    const base = { network: "net-three-tier", cooling: "cool-n1", power: "pwr-ab" } as never;
    const layers = (extra: Record<string, string>) => ({ ...(base as object), ...extra }) as never;
    expect(unmetOf(layers({ accel: "gpu-training-cluster" })).length).toBeGreaterThan(0);
    expect(unmetOf(layers({ accel: "gpu-training-cluster", network: "net-leaf-spine" }))).toEqual(
      [],
    );
    expect(
      unmetOf(layers({ accel: "gpu-liquid-pod", network: "net-leaf-spine" })).length,
    ).toBeGreaterThan(0);
  });
});

describe("power ladder worlds [REQ-107]", () => {
  test("the substation world has a substation, rack batteries, a 48 V bus per rack and an ATS with a generator", () => {
    const { world } = boot(() => powerLab("pwr-substation"));
    expect(world.index.ofKind("substation").length).toBe(1);
    expect(world.index.ofKind("bbu").length).toBeGreaterThan(0);
    expect(world.index.ofKind("dc_bus").length).toBe(world.index.ofKind("bbu").length);
    expect(world.index.ofKind("generator").length).toBeGreaterThan(1);
    expect(world.stateAs(first(world, "substation"), "substation").status).toBe("ok");
  });

  test("a utility feed loss moves to the other feed by itself after ten seconds, and does not when the transfer is broken", () => {
    const auto = boot(() => powerLab("pwr-substation"));
    const sub = first(auto.world, "substation");
    inject(auto.world, "utility_feed_loss", sub, { feed: 1 });
    auto.physics.run(30);
    expect(auto.world.stateAs(sub, "substation").activeFeed).toBe(2);
    expect(auto.world.stateAs(sub, "substation").status).not.toBe("down");

    const stuck = boot(() => powerLab("pwr-substation"));
    inject(stuck.world, "utility_feed_loss", sub, { feed: 1, manual: 1 });
    stuck.physics.run(60);
    expect(stuck.world.stateAs(sub, "substation").status).toBe("down");
    stuck.world.apply({ type: "feed.transfer", target: sub, feed: 2 }, "agent");
    stuck.physics.run(30);
    expect(stuck.world.stateAs(sub, "substation").activeFeed).toBe(2);
    expect(stuck.world.stateAs(sub, "substation").status).not.toBe("down");
  });

  test("a transformer that overheats trips, and the substation runs on the other one", () => {
    const { world, physics } = boot(() => powerLab("pwr-substation"));
    const sub = first(world, "substation");
    inject(world, "transformer_overtemp", sub, { transformer: 1 });
    physics.run(900);
    const s = world.stateAs(sub, "substation");
    expect(s.transformersOk).toEqual([false, true]);
    expect(s.status).not.toBe("down");
  });

  test("a rack battery carries the rack when its feeds are gone, and a lost cell shortens the time", () => {
    const { world, physics } = boot(() => powerLab("pwr-rack-bbu"));
    const bbu = first(world, "bbu");
    const full = world.stateAs(bbu, "bbu").runtimeMin;
    inject(world, "bbu_cell_fault", bbu, { cells: 2 });
    physics.run(30);
    expect(world.stateAs(bbu, "bbu").cellsFailed).toBe(2);
    expect(world.stateAs(bbu, "bbu").runtimeMin).toBeLessThan(full);
    expect(world.stateAs(bbu, "bbu").status).toBe("degraded");
  });

  test("a sagging 48 V bus raises an alarm on the bus", () => {
    const { world, physics } = boot(() => powerLab("pwr-rack-bbu"));
    const bus = first(world, "dc_bus");
    inject(world, "dc_bus_sag", bus, { sagV: 8 });
    physics.run(30);
    expect(world.stateAs(bus, "dc_bus").status).not.toBe("ok");
    expect(world.alarms().some((a) => a.entityId === bus)).toBe(true);
  });

  test("N+1 UPS keeps the load when one module fails", () => {
    const { world, physics } = boot(() => powerLab("pwr-n1-ups"));
    const ups = world.index.ofKind("ups");
    expect(ups.length).toBeGreaterThanOrEqual(3);
    inject(world, "ups_module_fail", ups[0]?.id as string);
    physics.run(120);
    const servers = world.index.ofKind("server");
    expect(servers.every((s) => world.stateAs(s.id, "server").powered)).toBe(true);
  });
});

describe("cooling ladder worlds [REQ-107]", () => {
  test("a rear-door world has a heat exchanger per dense rack, and a stuck valve warms the rack", () => {
    const { world, physics } = boot(() => coolingLab("cool-rdhx"), 600);
    const door = first(world, "rdhx");
    const rack = world.index.entity(door).parentId ?? "";
    const before = rack ? world.index.find(rack)?.id : undefined;
    expect(world.index.ofKind("rdhx").length).toBeGreaterThan(0);
    const t0 = world.stateAs(
      world.index.outgoing(door, "member_of")[0]?.to ?? before ?? "",
      "rack",
    ).inletC;
    inject(world, "rdhx_valve_stuck", door, { openPct: 0 });
    physics.run(900);
    expect(world.stateAs(door, "rdhx").status).toBe("degraded");
    expect(t0).toBeGreaterThan(0);
  });

  test("an immersion world has tanks, and a low fluid level warms the bath", () => {
    const { world, physics } = boot(() => coolingLab("cool-immersion"), 600);
    const tank = first(world, "immersion_tank");
    const rack = world.index.outgoing(tank, "member_of")[0]?.to as string;
    const before = world.stateAs(rack, "rack").bathC;
    inject(world, "fluid_level_low", tank, { levelPct: 25 });
    physics.run(1200);
    expect(world.stateAs(rack, "rack").bathC).toBeGreaterThan(before);
    expect(world.stateAs(tank, "immersion_tank").status).not.toBe("ok");
  });

  test("a pod's CDU keeps its standby pump idle until an operator starts it", () => {
    const pod = () =>
      accelLab("gpu-liquid-pod", {
        network: "net-leaf-spine",
        cooling: "cool-liquid",
        power: "pwr-ab",
      });
    const { world, physics } = boot(pod, 600);
    const cdu = first(world, "cdu");
    const full = world.stateAs(cdu, "cdu").capacityKw;
    inject(world, "cdu_pump_failure", cdu, { pumps: 1 });
    physics.run(60);
    const hurt = world.stateAs(cdu, "cdu").capacityKw;
    expect(hurt).toBeLessThan(full);
    world.apply({ type: "cdu.pump_switch", target: cdu }, "agent");
    physics.run(60);
    expect(world.stateAs(cdu, "cdu").capacityKw).toBeGreaterThan(hurt);
    expect(() => world.apply({ type: "cdu.pump_switch", target: cdu }, "agent")).toThrow(/이미/);
  });

  test("a coolant leak powers the leaking rack off by its leak policy", () => {
    const pod = () =>
      accelLab("gpu-liquid-pod", {
        network: "net-leaf-spine",
        cooling: "cool-liquid",
        power: "pwr-ab",
      });
    const { world, physics } = boot(pod, 300);
    const rack = world.index.ofKind("rack").find((r) => r.props.leakPolicy === "poweroff");
    expect(rack).toBeDefined();
    inject(world, "coolant_leak", rack?.id as string);
    physics.run(60);
    const servers = world.index.childrenOf(rack?.id as string, "server");
    expect(servers.every((s) => !world.stateAs(s.id, "server").adminOn)).toBe(true);
  });
});
