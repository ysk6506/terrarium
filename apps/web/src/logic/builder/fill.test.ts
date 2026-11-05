import { Catalog } from "@terrarium/core/catalog";
import {
  type Blueprint,
  BlueprintIndex,
  hasErrors,
  validateBlueprint,
} from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { addBuilding, addRoom, autoWireRoom, emptyWorld, fillRoom, levelStats, preview } from ".";

const catalog = new Catalog();

/** A site with one building, one floor and a server room `w` × `d` metres. */
function world(w: number, d: number, purpose?: "network"): { bp: Blueprint; room: string } {
  let bp = emptyWorld("w", "채우기", { w: 200, d: 200 });
  bp = addBuilding(bp, catalog, { x: 20, y: 20, w: 60, d: 40 }).blueprint;
  const floor = new BlueprintIndex(bp).ofKind("floor")[0]?.id as string;
  const made = addRoom(bp, catalog, floor, { x: 1.2, y: 1.2, w, d }, purpose);
  return { bp: made.blueprint, room: made.select[0] as string };
}

const critical = (bp: Blueprint) => {
  const p = preview(bp, catalog);
  if ("problems" in p) throw new Error(p.problems.join("; "));
  return p.alarms.filter((a) => a.severity === "critical");
};

describe("filling a server room [REQ-043] [REQ-047]", () => {
  test("a full room has racks with servers, cooling and power, nothing invalid, and no alarms when left alone", () => {
    const { bp, room } = world(24, 18);
    const filled = fillRoom(bp, catalog, room, { load: "full", aisle: "cold" });
    expect(filled.racks).toBeGreaterThanOrEqual(20);
    expect(filled.servers).toBe(filled.racks * 28);
    const index = new BlueprintIndex(filled.blueprint);
    expect(index.ofKind("rack")).toHaveLength(filled.racks);
    expect(index.ofKind("server")).toHaveLength(filled.servers);
    expect(index.ofKind("cooling_unit")).toHaveLength(filled.coolingUnits);
    expect(index.ofKind("containment").length).toBeGreaterThan(0);
    expect(hasErrors(validateBlueprint(filled.blueprint, catalog))).toBe(false);
    expect(critical(filled.blueprint)).toEqual([]);
  });

  test("every mix of load and aisle runs cool, with no alarms, in rooms of several sizes", () => {
    for (const [w, d] of [
      [18, 14],
      [24, 18],
      [36, 30],
    ] as const)
      for (const load of ["empty", "half", "full"] as const)
        for (const aisle of ["none", "cold", "hot"] as const) {
          const { bp, room } = world(w, d);
          const filled = fillRoom(bp, catalog, room, { load, aisle });
          expect(hasErrors(validateBlueprint(filled.blueprint, catalog))).toBe(false);
          const ran = preview(filled.blueprint, catalog);
          if ("problems" in ran) throw new Error(ran.problems.join("; "));
          expect(ran.alarms, `${w}x${d} ${load} ${aisle}`).toEqual([]);
          expect(ran.hottest?.inletC ?? 0).toBeLessThan(27);
        }
  }, 120_000);

  test("the cooling has a spare unit and each rack is fed from both sides", () => {
    const { bp, room } = world(24, 18);
    const filled = fillRoom(bp, catalog, room, { load: "half", aisle: "hot" });
    const index = new BlueprintIndex(filled.blueprint);
    const stats = levelStats(index, catalog, { kind: "room", id: room });
    expect(stats.coolingKw).toBeGreaterThan((stats.itTypicalW / 1000) * 1.2);
    const rack = index.ofKind("rack")[0]?.id as string;
    const pdus = index.childrenOf(rack, "pdu");
    expect(pdus.map((p) => p.props.feed)).toEqual(["A", "B"]);
    const panels = pdus.map((p) => index.outgoing(p.id, "power")[0]?.to);
    expect(new Set(panels).size).toBe(2);
    expect(index.outgoing(rack, "cooling").length).toBe(2);
  });

  test("half holds fewer servers than full, and empty holds none", () => {
    const { bp, room } = world(24, 18);
    const half = fillRoom(bp, catalog, room, { load: "half", aisle: "none" });
    const full = fillRoom(bp, catalog, room, { load: "full", aisle: "none" });
    const empty = fillRoom(bp, catalog, room, { load: "empty", aisle: "none" });
    expect(half.servers).toBeGreaterThan(0);
    expect(half.servers).toBeLessThan(full.servers);
    expect(empty.servers).toBe(0);
    // The racks stand the same whatever goes in them, so a half-full room can be filled up later.
    expect([half.racks, empty.racks]).toEqual([full.racks, full.racks]);
    expect(new BlueprintIndex(empty.blueprint).ofKind("rack")).toHaveLength(empty.racks);
    expect(new BlueprintIndex(empty.blueprint).ofKind("containment")).toHaveLength(0);
    expect(hasErrors(validateBlueprint(empty.blueprint, catalog))).toBe(false);
  });

  test("a sealed hot aisle turns the rows' backs to the aisle, a cold one their fronts", () => {
    const { bp, room } = world(24, 18);
    const rows = (aisle: "cold" | "hot") => {
      const f = fillRoom(bp, catalog, room, { load: "empty", aisle });
      const racks = new BlueprintIndex(f.blueprint).ofKind("rack");
      const first = racks[0]?.placement;
      return first?.type === "spot" ? first.rotation : undefined;
    };
    expect(rows("cold")).toBe(0);
    expect(rows("hot")).toBe(180);
  });

  test("a bigger room holds more, and the equipment still fits", () => {
    const small = fillRoom(world(18, 14).bp, catalog, world(18, 14).room, {
      load: "full",
      aisle: "cold",
    });
    const { bp, room } = world(36, 30);
    const big = fillRoom(bp, catalog, room, { load: "full", aisle: "cold" });
    expect(big.racks).toBeGreaterThan(small.racks);
    expect(hasErrors(validateBlueprint(big.blueprint, catalog))).toBe(false);
    expect(critical(big.blueprint)).toEqual([]);
  });

  test("it says why when the room is too small, is not a server room, or is not empty", () => {
    const tiny = world(8, 6);
    expect(() => fillRoom(tiny.bp, catalog, tiny.room, { load: "full", aisle: "none" })).toThrow(
      /서버룸이 너무 작아요. 가로 14.4 m, 세로 10.8 m 이상/,
    );
    const net = world(24, 18, "network");
    expect(() => fillRoom(net.bp, catalog, net.room, { load: "full", aisle: "none" })).toThrow(
      /서버룸이 아니에요/,
    );
    const { bp, room } = world(24, 18);
    const once = fillRoom(bp, catalog, room, { load: "half", aisle: "cold" });
    expect(() => fillRoom(once.blueprint, catalog, room, { load: "full", aisle: "none" })).toThrow(
      /이미 놓인 것이 있어요/,
    );
  });

  test("auto wiring a filled room adds nothing: it is wired already", () => {
    const { bp, room } = world(24, 18);
    const filled = fillRoom(bp, catalog, room, { load: "half", aisle: "cold" });
    expect(autoWireRoom(filled.blueprint, catalog, room).added).toBe(0);
  });
});
