import { Catalog } from "@terrarium/core/catalog";
import { DEFAULT_CAMPUS, generateCampus } from "@terrarium/core/sources/worldgen";
import { BlueprintIndex, type Entity, roomPurposeOf } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import {
  crumbsOf,
  DEFAULT_ANGLES,
  type Focus,
  fitDistance,
  floorY,
  focusBox,
  focusOf,
  poseFor,
  positionOf,
  sameFocus,
} from "./camera";
import { siteScene } from "./site";

const catalog = new Catalog();
const bp = generateCampus(
  {
    ...DEFAULT_CAMPUS,
    site: "pyeongtaek",
    seed: 5,
    buildings: 2,
    floors: 2,
    hallsPerFloor: 2,
    podsPerHall: 6,
    detail: 0.5,
  },
  catalog,
).blueprint;
const index = new BlueprintIndex(bp);
const site = siteScene(index, catalog);
const lens = { fov: (34 * Math.PI) / 180, aspect: 16 / 9 };

describe("framing what the camera looks at [REQ-006]", () => {
  test("the camera stands off far enough that the whole box is in view, and no farther than needed", () => {
    const box = { x0: 0, y0: 0, z0: 0, x1: 80, y1: 14, z1: 60 };
    const d = fitDistance(box, DEFAULT_ANGLES.building, lens);
    expect(d).toBeGreaterThan(40);
    // Twice the distance fits it with room to spare; half does not.
    const near = fitDistance(box, DEFAULT_ANGLES.building, { ...lens, fov: lens.fov * 2 });
    expect(near).toBeLessThan(d);
    const wide = fitDistance(box, DEFAULT_ANGLES.building, { ...lens, aspect: 1 });
    expect(wide).toBeGreaterThan(d);
  });

  test("a pose looks at the middle of the box, from the south-west and above", () => {
    const pose = poseFor({ x0: 0, y0: 0, z0: 0, x1: 20, y1: 4, z1: 10 }, "room", lens);
    expect(pose.target).toEqual([10, 2, 5]);
    const [x, y, z] = positionOf(pose);
    expect(x).toBeLessThan(10);
    expect(y).toBeGreaterThan(2);
    expect(z).toBeGreaterThan(5);
    expect(Math.hypot(x - 10, y - 2, z - 5)).toBeCloseTo(pose.distance);
  });

  test("every focus has a box: the site, a building, a room and a rack", () => {
    if (!site) throw new Error("no site");
    const building = index.ofKind("building")[0] as Entity;
    const hall = index.ofKind("room").find((r) => roomPurposeOf(r) === "data_hall") as Entity;
    const rack =
      index.childrenOf(hall.id, "rack")[0] ??
      index.childrenOf(index.childrenOf(hall.id, "containment")[0]?.id ?? "", "rack")[0];
    const focuses: Focus[] = [
      { kind: "site" },
      { kind: "site", whole: true },
      { kind: "building", id: building.id },
      { kind: "room", id: hall.id },
      { kind: "rack", id: (rack as Entity).id },
    ];
    const sizes = focuses.map((f) => {
      const b = focusBox(index, catalog, site, f);
      expect(b).toBeDefined();
      const box = b as NonNullable<typeof b>;
      expect(box.x1).toBeGreaterThan(box.x0);
      expect(box.y1).toBeGreaterThan(box.y0);
      return (box.x1 - box.x0) * (box.z1 - box.z0);
    });
    // Each step in is a smaller area than the one before it (the whole land is the widest).
    expect(sizes[1]).toBeGreaterThan(sizes[0] as number);
    expect(sizes[0]).toBeGreaterThan(sizes[2] as number);
    expect(sizes[2]).toBeGreaterThan(sizes[3] as number);
    expect(sizes[3]).toBeGreaterThan(sizes[4] as number);
    expect(focusBox(index, catalog, site, { kind: "room", id: "nope" })).toBeUndefined();
    expect(focusBox(index, catalog, site, { kind: "building", id: "nope" })).toBeUndefined();
    expect(focusBox(index, catalog, site, { kind: "rack", id: "nope" })).toBeUndefined();
  });

  test("a floor's box is its building's footprint at the height of that floor", () => {
    if (!site) throw new Error("no site");
    const floor = index.ofKind("floor").find((f) => f.name === "2F") as Entity;
    const outer = focusBox(index, catalog, site, { kind: "building", id: floor.parentId ?? "" });
    const box = focusBox(index, catalog, site, { kind: "floor", id: floor.id });
    expect(box?.x0).toBe(outer?.x0);
    expect(box?.x1).toBe(outer?.x1);
    expect(box?.y0).toBeCloseTo(4.5);
    expect((box?.y1 ?? 0) - (box?.y0 ?? 0)).toBeCloseTo(4.5);
    expect(focusBox(index, catalog, site, { kind: "floor", id: "nope" })).toBeUndefined();
    const building = index.ofKind("building")[0] as Entity;
    expect(focusBox(index, catalog, site, { kind: "floor", id: building.id })).toBeUndefined();
    const crumbs = crumbsOf(index, { kind: "floor", id: floor.id });
    expect(crumbs.map((c) => c.focus.kind)).toEqual(["site", "building", "floor"]);
    expect(crumbs.at(-1)?.label).toBe("2F");
  });

  test("a room box lies inside its building and on its floor", () => {
    if (!site) throw new Error("no site");
    const hall = index
      .ofKind("room")
      .find(
        (r) => roomPurposeOf(r) === "data_hall" && index.enclosing(r.id, "floor")?.name === "2F",
      ) as Entity;
    const outer = focusBox(index, catalog, site, {
      kind: "building",
      id: index.enclosing(hall.id, "building")?.id ?? "",
    });
    const inner = focusBox(index, catalog, site, { kind: "room", id: hall.id });
    expect(inner && outer && inner.x0 >= outer.x0 && inner.x1 <= outer.x1 + 0.01).toBe(true);
    expect(inner?.y0).toBeCloseTo(4.5);
    expect(floorY(index, index.enclosing(hall.id, "floor")?.id ?? "")).toBeCloseTo(4.5);
    expect(floorY(index, "nope")).toBe(0);
  });

  test("a thing's focus is the level it belongs to, and the path back up is listed", () => {
    const hall = index.ofKind("room").find((r) => roomPurposeOf(r) === "data_hall") as Entity;
    const cooling = index.childrenOf(hall.id, "cooling_unit")[0] as Entity;
    expect(focusOf(index, cooling.id)).toEqual({ kind: "room", id: hall.id });
    expect(focusOf(index, hall.id)).toEqual({ kind: "room", id: hall.id });
    const floor = index.enclosing(hall.id, "floor") as Entity;
    expect(focusOf(index, floor.id)).toEqual({ kind: "building", id: floor.parentId });
    expect(focusOf(index, "nope")).toEqual({ kind: "site" });
    expect(focusOf(index, (index.ofKind("site")[0] as Entity).id)).toEqual({ kind: "site" });
    const server = index.ofKind("server")[0] as Entity;
    expect(focusOf(index, server.id).kind).toBe("rack");
    const crumbs = crumbsOf(index, {
      kind: "rack",
      id: index.enclosing(server.id, "rack")?.id ?? "",
    });
    expect(crumbs.map((c) => c.focus.kind)).toEqual(["site", "building", "room", "rack"]);
    expect(crumbsOf(index, { kind: "site" })).toHaveLength(1);
    expect(crumbsOf(index, { kind: "room", id: "nope" })).toHaveLength(1);
    expect(sameFocus({ kind: "site" }, { kind: "site" })).toBe(true);
    expect(sameFocus({ kind: "site" }, { kind: "site", whole: true })).toBe(false);
    expect(sameFocus({ kind: "room", id: "a" }, { kind: "room", id: "a" })).toBe(true);
    expect(sameFocus({ kind: "room", id: "a" }, { kind: "rack", id: "a" })).toBe(false);
  });
});
