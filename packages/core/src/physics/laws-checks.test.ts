import { Catalog } from "@terrarium/core/catalog";
import { World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../world/test-support/sample";
import { Physics } from ".";
import {
  bbuViolations,
  chainViolations,
  directionViolations,
  formatViolations,
  rangeViolations,
  roomViolations,
  upsViolations,
} from "./laws-checks";
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

const calm: RoomStep = {
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
};

describe("the law checks name what they find, in Korean [REQ-113]", () => {
  test("[REQ-113] heat arriving in a room cannot be negative", () => {
    const found = roomViolations([{ ...calm, inW: -500, removedW: 0, clamped: true }], 3);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ law: "energy.room", where: "hall", t: 3 });
    expect(found[0]?.message).toContain("음수");
  });

  test("[REQ-113] a number that is not finite inside a list is found, and so are racks and UPS batteries out of range", () => {
    const { world } = boot();
    const server = world.stateAs("srv-a1", "server") as unknown as Record<string, unknown>;
    server.history = [1, Number.POSITIVE_INFINITY];
    expect(formatViolations(world).map((x) => x.message)).toContainEqual(
      expect.stringContaining("srv-a1의 history"),
    );
    world.stateAs("rack-a", "rack").inletC = 900;
    world.stateAs("ups-1", "ups").batteryPct = 130;
    world.stateAs("hall", "room").ambientC = -90;
    world.stateAs("srv-a2", "server").perf = 2;
    const where = rangeViolations(world).map((x) => x.where);
    expect(where).toEqual(expect.arrayContaining(["rack-a", "ups-1", "hall", "srv-a2"]));
  });

  test("[REQ-113] a battery that gave more than the load took, or grew while it carried the load, is found", () => {
    const { world } = boot();
    const ups = world.stateAs("ups-1", "ups");
    ups.loadW = 0;
    ups.batteryPct = 40;
    const over = upsViolations(world, "ups-1", { pct: 90, loadW: 0 }, 10);
    expect(over.map((x) => x.law)).toEqual(["energy.battery"]);
    expect(over[0]?.message).toContain("내놨는데");
    ups.inputOk = false;
    ups.batteryPct = 95;
    const grew = upsViolations(world, "ups-1", { pct: 90, loadW: 1e9 }, 10);
    expect(grew.map((x) => x.message)).toEqual([expect.stringContaining("충전량이 늘었어요")]);
  });

  test("[REQ-113] a rack battery is held to the same standard, and a rack without one has nothing to check", () => {
    const { world } = boot();
    const bbu = { kind: "bbu", onBattery: true, chargePct: 80 };
    const states = world as unknown as { stateAs: (id: string, kind: string) => unknown };
    const original = states.stateAs.bind(world);
    states.stateAs = (id, kind) => (id === "bbu-x" ? bbu : original(id, kind));
    const found = bbuViolations(world, "bbu-x", { pct: 50, loadW: 0 }, 10);
    expect(found.map((x) => x.message)).toEqual([expect.stringContaining("충전량이 늘었어요")]);
    bbu.onBattery = false;
    bbu.chargePct = 10;
    expect(
      bbuViolations(world, "bbu-x", { pct: 90, loadW: 0 }, 3600).map((x) => x.message),
    ).toEqual([expect.stringContaining("보다 많은 에너지")]);
  });

  test("[REQ-113] a supplier that carries a different load than its consumers draw is found", () => {
    const { world } = boot();
    expect(chainViolations(world, 0.5)).toEqual([]);
    world.stateAs("ups-1", "ups").loadW = 9e6;
    const found = chainViolations(world, 0.05);
    expect(found.map((x) => x.law)).toContain("power.chain");
    expect(found.map((x) => x.where)).toContain("ups-1");
  });

  test("[REQ-113] a breaker that holds longer under a bigger overload is a direction violation", () => {
    const { world } = boot({
      base: "v1",
      curves: {
        "power.protection.tripTimeCurve": [
          [1.5, 10],
          [3, 600],
        ],
      },
    });
    const found = directionViolations(world);
    expect(found.map((x) => x.where)).toContain("power.protection");
  });
});
