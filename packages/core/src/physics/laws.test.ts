import { Catalog } from "@terrarium/core/catalog";
import { World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../world/test-support/sample";
import { Physics } from ".";
import { KNOWN_V1_EXCEPTIONS, LawMonitor } from "./laws";
import { deviceViolations, formatViolations, rangeViolations, roomViolations } from "./laws-checks";
import type { RoomStep } from "./thermal";

const catalog = new Catalog();

function boot(physics?: Parameters<typeof World.fromBlueprint>[0]["physics"]) {
  const world = World.fromBlueprint(
    { ...sampleBlueprint(), ...(physics ? { physics } : {}) },
    catalog,
  );
  const engine = new Physics(world);
  engine.settle();
  return { world, engine };
}

const step = (over: Partial<RoomStep>): RoomStep => ({
  room: "hall",
  dt: 10,
  fromC: 24,
  toC: 24,
  inW: 10_000,
  removedW: 10_000,
  envelopeW: 0,
  capacityW: 100_000,
  massJPerK: 1_000_000,
  clamped: false,
  ...over,
});

describe("the laws catch a world that breaks them [REQ-113]", () => {
  test("a balanced room step is clean; one that creates energy, removes more than the capacity, or cools with cooling off is not", () => {
    expect(roomViolations([step({})], 0)).toEqual([]);
    const made = roomViolations([step({ toC: 25 })], 0);
    expect(made.map((v) => v.law)).toEqual(["energy.room"]);
    expect(made[0]?.message).toContain("온도 변화 × 열용량");
    const over = roomViolations([step({ removedW: 120_000, inW: 120_000 })], 0);
    expect(over.map((v) => v.law)).toContain("energy.cooling");
    const cold = roomViolations(
      [step({ removedW: 0, inW: 5_000, fromC: 24, toC: 23.99, massJPerK: 5_000_000 })],
      0,
    );
    expect(cold.map((v) => v.law)).toContain("direction.cooling");
  });

  test("a step that ended on the room's bound is not held to the balance", () => {
    expect(roomViolations([step({ toC: 75, clamped: true })], 0)).toEqual([]);
  });

  test("a number that is not finite, a temperature out of range and a draw above the maximum are found", () => {
    const { world } = boot();
    expect(formatViolations(world)).toEqual([]);
    expect(rangeViolations(world)).toEqual([]);
    expect(deviceViolations(world)).toEqual([]);
    world.stateAs("srv-a1", "server").cpuC = Number.NaN;
    world.stateAs("srv-a2", "server").cpuC = 400;
    world.stateAs("srv-b1", "server").powerW = 1e6;
    expect(formatViolations(world).map((v) => v.where)).toContain("srv-a1");
    expect(rangeViolations(world).map((v) => v.where)).toContain("srv-a2");
    expect(deviceViolations(world).map((v) => v.where)).toContain("srv-b1");
  });

  test("a table that gives less power for more load is a direction violation, found when the monitor starts", () => {
    const { world } = boot({
      base: "v1",
      curves: {
        "power.device.utilCurve": [
          [0, 1],
          [1, 0],
        ],
      },
    });
    const found = new LawMonitor(world).report().failures;
    expect(found.map((v) => v.law)).toContain("direction.load");
  });

  test("an efficiency table of exactly 1 at full load is allowed (no energy out of nothing, none lost)", () => {
    const { world } = boot({
      base: "v1",
      curves: {
        "power.conversion.upsEfficiencyCurve": [
          [0, 0.9],
          [1, 1],
        ],
      },
    });
    expect(new LawMonitor(world).report().failures).toEqual([]);
  });
});

describe("the default physics keeps the laws on a small room [REQ-113]", () => {
  test("a simulated hour: no violation, and the exceptions of v1 are named", () => {
    const { world, engine } = boot();
    const monitor = new LawMonitor(world);
    for (let i = 0; i < 360; i++) {
      engine.step();
      monitor.observe(10);
    }
    expect(monitor.report().steps).toBe(360);
    expect(monitor.report().failures.map((v) => v.message)).toEqual([]);
    for (const k of KNOWN_V1_EXCEPTIONS) expect(k.reason).not.toBe("");
  });
});
