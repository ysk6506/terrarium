import { Physics } from "@terrarium/core/physics";
import type { World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleWorld } from "../world/test-support/sample-world";
import { impactOf } from "./impact";
import type { TopologySource } from "./types";
import { impactCounts, impactWhen } from "./words";

function fresh(): World {
  const world = sampleWorld();
  new Physics(world).settle();
  return world;
}

function fail(world: World, type: string, target: string): void {
  world.apply(
    { type: "fault.add", fault: { id: `f-${target}`, type: type as never, target, params: {} } },
    "test",
  );
}

describe("the impact range follows the dependencies backwards from what is broken [REQ-078]", () => {
  test("a healthy world has no impact range", () => {
    const impact = impactOf(fresh());
    expect(impact.affected.size).toBe(0);
    expect(impact.racks.size).toBe(0);
    expect(impact.servers).toBe(0);
    expect(impact.severe).toBeUndefined();
    expect(impactWhen(impact)).toBe("");
  });

  test("a stopped cooling unit puts the racks that lean on it, and their servers, in the range", () => {
    const world = fresh();
    fail(world, "cooling_unit_failure", "crah-1");
    new Physics(world).settle();
    const impact = impactOf(world);
    expect(impact.causes.faulted.has("crah-1")).toBe(true);
    expect([...impact.racks].sort()).toEqual(["rack-a", "rack-b"]);
    expect([...impact.rooms]).toEqual(["hall"]);
    expect(impact.servers).toBe(3);
    expect(impactCounts(impact)).toBe("서버룸 1 · 랙 2 · 서버 3");
  });

  test("a rack that still has another unit is in the range for the half it lost, not gone", () => {
    const world = fresh();
    fail(world, "cooling_unit_failure", "crah-1");
    new Physics(world).settle();
    const impact = impactOf(world);
    // rack-b leans on crah-1 and crah-2: half lost. rack-a leans on crah-1 only: all lost.
    expect(impact.affected.has("rack-b")).toBe(true);
    expect(impact.affected.has("rack-a")).toBe(true);
    const spare = fresh();
    fail(spare, "cooling_unit_degraded", "crah-2");
    expect(impactOf(spare).affected.has("rack-a")).toBe(false);
  });

  test("the range tells how many minutes are left when the temperature has been rising", () => {
    const world = fresh();
    fail(world, "cooling_unit_failure", "crah-1");
    new Physics(world).settle();
    world.patch("rack-a", "rack", { inletC: 28 });
    const source: TopologySource = {
      index: world.index,
      time: () => 600,
      stateOf: (id) => world.stateOf(id),
      faults: () => world.faults(),
      alarms: () => world.alarms(),
      linkUp: (id) => world.linkUp(id),
      earlier: { t: 540, inletC: new Map([["rack-a", 26]]) },
    };
    const impact = impactOf(source);
    // 2 °C in 60 s: the 4 °C to 32 °C take 120 s.
    expect(impact.severe).toMatchObject({ kind: "thermal", minutes: 2, celsius: 32, at: "rack-a" });
    expect(impactWhen(impact)).toBe("냉방이 그대로면 2분 뒤 심각(32°C)");
  });

  test("with no earlier reading it does not guess a time, and a rack already at the line says so", () => {
    const world = fresh();
    fail(world, "cooling_unit_failure", "crah-1");
    new Physics(world).settle();
    world.patch("rack-a", "rack", { inletC: 28 });
    expect(impactOf(world).severe).toBeUndefined();
    world.patch("rack-a", "rack", { inletC: 33 });
    const impact = impactOf(world);
    expect(impact.severe).toMatchObject({ kind: "thermal", minutes: 0 });
    expect(impactWhen(impact)).toBe("이미 심각해요(32°C)");
  });

  test("a tripped panel takes down what leans on it all the way to the VMs, at once", () => {
    const world = fresh();
    fail(world, "breaker_trip", "panel-1");
    new Physics(world).settle();
    const impact = impactOf(world);
    for (const id of ["pdu-a", "pdu-b", "srv-a1", "srv-b1", "vm-web", "vm-db"])
      expect(impact.affected.has(id) || impact.causes.alarmed.has(id)).toBe(true);
    expect(impact.severe).toMatchObject({ kind: "power", minutes: 0 });
    expect(impactWhen(impact)).toBe("전기가 끊긴 곳은 이미 꺼졌어요");
  });

  test("a cut cable leaves the server it fed in the range and names both ends as the fault", () => {
    const world = fresh();
    const cable = world.index.outgoing("srv-a1", "network")[0];
    expect(cable).toBeDefined();
    fail(world, "link_down", (cable as { id: string }).id);
    const impact = impactOf(world);
    expect(impact.causes.faulted.has("srv-a1")).toBe(true);
    expect(impact.causes.faulted.has("tor-a")).toBe(true);
  });

  test("it only reads: the world is as it was, and the agents get no tool from it", () => {
    const world = fresh();
    fail(world, "cooling_unit_failure", "crah-1");
    const before = JSON.stringify(world.alarms());
    const seq = world.lastSeq();
    impactOf(world);
    expect(JSON.stringify(world.alarms())).toBe(before);
    expect(world.lastSeq()).toBe(seq);
  });
});
