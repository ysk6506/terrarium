import { Catalog } from "@terrarium/core/catalog";
import { type Blueprint, BlueprintIndex, type Entity } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { insetOutline, insideScene, outlineOfScene, roomScene } from "./room";

const catalog = new Catalog();
const e = (
  id: string,
  kind: Entity["kind"],
  parentId: string | undefined,
  extra: Partial<Entity> = {},
): Entity => ({
  id,
  kind,
  name: id,
  props: {},
  ...(parentId ? { parentId } : {}),
  ...extra,
});

/** A hall with one containment (an aisle, 12 m long and 3 m deep, between z = 4 and z = 7) and racks on the sides given. */
function hallWith(aisle: "cold" | "hot", racks: Array<{ id: string; y: number }>) {
  const entities: Entity[] = [
    e("site", "site", undefined, { placement: { type: "land", w: 100, d: 100 } }),
    e("bldg", "building", "site", { placement: { type: "area", x: 0, y: 0, w: 40, d: 30 } }),
    e("fl", "floor", "bldg", { placement: { type: "level", level: 1, height: 4 } }),
    e("hall", "room", "fl", { placement: { type: "area", x: 0, y: 0, w: 20, d: 12 } }),
    e("pod", "containment", "hall", {
      placement: { type: "area", x: 2, y: 4, w: 12, d: 3 },
      props: { aisle },
    }),
    ...racks.map((r, i) =>
      e(r.id, "rack", "pod", { placement: { type: "spot", x: 3 + i * 0.7, y: r.y, rotation: 0 } }),
    ),
  ];
  const bp: Blueprint = { schemaVersion: 1, id: "b", name: "b", entities, links: [], meta: {} };
  return roomScene(new BlueprintIndex(bp), catalog, "hall");
}

describe("the closed-in aisle of a containment follows the racks round it [REQ-006]", () => {
  test("racks on both sides close the aisle between them", () => {
    const scene = hallWith("cold", [
      { id: "a", y: 2.2 },
      { id: "b", y: 7.8 },
    ]);
    const [pod] = scene?.pods ?? [];
    expect(pod).toBeDefined();
    expect((pod?.enclosure.z1 ?? 0) - (pod?.enclosure.z0 ?? 0)).toBeGreaterThan(1);
    expect(pod?.enclosure.z0).toBeGreaterThan(2.2);
    expect(pod?.enclosure.z1).toBeLessThan(7.8 + 0.1);
  });

  test("one row above: the cold aisle is the one in front of it (below), the hot aisle the one behind it (above)", () => {
    const cold = hallWith("cold", [{ id: "a", y: 2.2 }])?.pods[0];
    const hot = hallWith("hot", [{ id: "a", y: 2.2 }])?.pods[0];
    expect(cold?.enclosure.z0).toBeGreaterThan(2.2);
    expect((cold?.enclosure.z1 ?? 0) - (cold?.enclosure.z0 ?? 0)).toBeLessThanOrEqual(1.2 + 1e-9);
    expect(hot?.enclosure.z1).toBeLessThan(2.2 + 1.2);
    expect((hot?.enclosure.z1 ?? 0) - (hot?.enclosure.z0 ?? 0)).toBeLessThanOrEqual(1.2 + 1e-9);
  });

  test("one row below: the cold aisle is the one above it, the hot aisle below", () => {
    const cold = hallWith("cold", [{ id: "a", y: 9.5 }])?.pods[0];
    const hot = hallWith("hot", [{ id: "a", y: 9.5 }])?.pods[0];
    expect(cold?.enclosure.z1).toBeLessThanOrEqual(9.5);
    expect(hot?.enclosure.z0).toBeGreaterThanOrEqual(9.5 - 1);
  });

  test("a containment with no racks is just its own footprint", () => {
    const pod = hallWith("cold", [])?.pods[0];
    expect(pod?.enclosure).toMatchObject({ x0: 2, x1: 14, z0: 4, z1: 7 });
  });
});

describe("the floor of a room is its rectangles, and a plain room is one [REQ-006]", () => {
  const plain = { w: 10, d: 6 } as never;

  test("a room without an outline has the four corners of its box", () => {
    expect(outlineOfScene(plain)).toEqual([
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 6 },
      { x: 0, z: 6 },
    ]);
    expect(insideScene(plain, 5, 3)).toBe(true);
    expect(insideScene(plain, 11, 3)).toBe(false);
  });

  test("pulling a rectangle's outline in by a margin shrinks it on every side", () => {
    const inset = insetOutline(outlineOfScene(plain), 0.5);
    const xs = inset.map((p) => p.x);
    const zs = inset.map((p) => p.z);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([0.5, 9.5]);
    expect([Math.min(...zs), Math.max(...zs)]).toEqual([0.5, 5.5]);
  });
});
