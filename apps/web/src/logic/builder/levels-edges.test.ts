import { Catalog } from "@terrarium/core/catalog";
import { type Blueprint, BlueprintIndex, type Entity } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import {
  crumbs,
  floorsOf,
  levelArea,
  levelEntities,
  levelOf,
  levelParent,
  levelShape,
  sameLevel,
  siteOf,
  startLevel,
} from "./levels";

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
const index = (entities: Entity[]) =>
  new BlueprintIndex({
    schemaVersion: 1,
    id: "b",
    name: "b",
    entities,
    links: [],
    meta: {},
  } as Blueprint);

const site = e("site", "site", undefined, { placement: { type: "land", w: 120, d: 90 } });
const building = e("bldg", "building", "site", {
  placement: { type: "area", x: 5, y: 5, w: 50, d: 30 },
});
const floor2 = e("f2", "floor", "bldg", { placement: { type: "level", level: 2, height: 4 } });
const floor1 = e("f1", "floor", "bldg", { placement: { type: "level", level: 1, height: 4 } });
const hall = e("hall", "room", "f1", { placement: { type: "area", x: 2, y: 2, w: 20, d: 12 } });
const lShaped = e("l", "room", "f1", {
  name: "L자 방",
  placement: { type: "area", x: 30, y: 2, w: 10, d: 8, pieces: [{ x: 40, y: 2, w: 5, d: 8 }] },
});
const pod = e("pod", "containment", "hall", {
  placement: { type: "area", x: 1, y: 1, w: 4, d: 3 },
});
const rack = e("rack", "rack", "pod", { placement: { type: "spot", x: 1, y: 1, rotation: 0 } });
const loose = e("loose", "rack", "f1");
const full = index([site, building, floor2, floor1, hall, lShaped, pod, rack, loose]);

describe("where the builder is looking [REQ-006]", () => {
  test("two levels are the same when they are the same site, or the same floor or room", () => {
    expect(sameLevel({ kind: "site" }, { kind: "site" })).toBe(true);
    expect(sameLevel({ kind: "floor", id: "a" }, { kind: "floor", id: "a" })).toBe(true);
    expect(sameLevel({ kind: "floor", id: "a" }, { kind: "floor", id: "b" })).toBe(false);
    expect(sameLevel({ kind: "floor", id: "a" }, { kind: "room", id: "a" })).toBe(false);
  });

  test("floors come lowest first, and the site is found", () => {
    expect(floorsOf(full, "bldg").map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(siteOf(full)?.id).toBe("site");
    expect(siteOf(index([]))).toBeUndefined();
  });

  test("an entity is seen on the level of its room, else its floor, else the site", () => {
    expect(levelOf(full, "nope")).toEqual({ kind: "site" });
    expect(levelOf(full, "hall")).toEqual({ kind: "room", id: "hall" });
    expect(levelOf(full, "f2")).toEqual({ kind: "floor", id: "f2" });
    expect(levelOf(full, "bldg")).toEqual({ kind: "floor", id: "f1" });
    expect(levelOf(full, "rack")).toEqual({ kind: "room", id: "hall" });
    expect(levelOf(full, "loose")).toEqual({ kind: "floor", id: "f1" });
    expect(levelOf(index([site, building]), "bldg")).toEqual({ kind: "site" });
    expect(levelOf(index([site, building]), "site")).toEqual({ kind: "site" });
  });

  test("a world opens on its first room, else its first floor, else the site", () => {
    expect(startLevel(full)).toEqual({ kind: "room", id: "hall" });
    expect(startLevel(index([site, building, floor1]))).toEqual({ kind: "floor", id: "f1" });
    expect(startLevel(index([site, building]))).toEqual({ kind: "site" });
  });
});

describe("the way back up and what is drawn at each level [REQ-006]", () => {
  test("crumbs: site, then the building's floor, then the room", () => {
    expect(crumbs(full, { kind: "site" }).map((c) => c.label)).toEqual(["site"]);
    expect(crumbs(full, { kind: "floor", id: "f1" }).map((c) => c.label)).toEqual([
      "site",
      "bldg f1",
    ]);
    expect(crumbs(full, { kind: "room", id: "hall" }).map((c) => c.label)).toEqual([
      "site",
      "bldg f1",
      "hall",
    ]);
    expect(crumbs(index([]), { kind: "site" }).map((c) => c.label)).toEqual(["사업장"]);
  });

  test("a room that sits on no floor still names itself", () => {
    const lonely = index([site, e("room", "room", "site")]);
    expect(crumbs(lonely, { kind: "room", id: "room" }).map((c) => c.label)).toEqual([
      "site",
      "room",
    ]);
    expect(crumbs(lonely, { kind: "room", id: "gone" }).map((c) => c.label)).toEqual([
      "site",
      "gone",
    ]);
  });

  test("the site draws its buildings and parcels; with no site, nothing", () => {
    expect(levelEntities(full, { kind: "site" }).map((x) => x.id)).toEqual(["bldg"]);
    expect(levelEntities(index([]), { kind: "site" })).toEqual([]);
  });

  test("a floor draws what stands on it but not the other floors; a room draws its racks inside containments too", () => {
    expect(
      levelEntities(full, { kind: "floor", id: "f1" })
        .map((x) => x.id)
        .sort(),
    ).toEqual(["hall", "l", "loose"]);
    expect(levelEntities(full, { kind: "room", id: "hall" }).map((x) => x.id)).toEqual([
      "pod",
      "rack",
    ]);
  });

  test("the entity a level is about", () => {
    expect(levelParent(full, { kind: "site" })?.id).toBe("site");
    expect(levelParent(full, { kind: "room", id: "hall" })?.id).toBe("hall");
    expect(levelParent(full, { kind: "room", id: "gone" })).toBeUndefined();
  });
});

describe("the floor a level offers, in its own frame [REQ-006]", () => {
  test("a site is its land, or a default square when it has none", () => {
    expect(levelArea(full, catalog, { kind: "site" })).toEqual({ x: 0, y: 0, w: 120, d: 90 });
    expect(levelArea(index([e("s", "site", undefined)]), catalog, { kind: "site" })).toEqual({
      x: 0,
      y: 0,
      w: 200,
      d: 200,
    });
    expect(levelArea(index([]), catalog, { kind: "site" })).toEqual({ x: 0, y: 0, w: 200, d: 200 });
  });

  test("a floor is its building's footprint; a room is its own; unknown things get a small default", () => {
    expect(levelArea(full, catalog, { kind: "floor", id: "f1" })).toEqual({
      x: 0,
      y: 0,
      w: 50,
      d: 30,
    });
    expect(levelArea(full, catalog, { kind: "room", id: "hall" })).toEqual({
      x: 0,
      y: 0,
      w: 20,
      d: 12,
    });
    expect(levelArea(full, catalog, { kind: "room", id: "gone" })).toEqual({
      x: 0,
      y: 0,
      w: 20,
      d: 20,
    });
  });

  test("a room made of pieces is the box round them, and its shape is the pieces", () => {
    expect(levelArea(full, catalog, { kind: "room", id: "l" })).toEqual({
      x: 0,
      y: 0,
      w: 15,
      d: 8,
    });
    expect(levelShape(full, catalog, { kind: "room", id: "l" })).toHaveLength(2);
    expect(levelShape(full, catalog, { kind: "room", id: "hall" })).toEqual([
      { x: 0, y: 0, w: 20, d: 12 },
    ]);
    expect(levelShape(full, catalog, { kind: "site" })).toEqual([{ x: 0, y: 0, w: 120, d: 90 }]);
  });
});
