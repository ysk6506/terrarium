import { Catalog } from "@terrarium/core/catalog";
import { DEFAULT_CAMPUS, generateCampus } from "@terrarium/core/sources/worldgen";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { boundsOfBox, insidePolygon, overlapBounds } from "./plan";
import { gateOf, siteScene } from "./site";

const catalog = new Catalog();
const campus = generateCampus(
  {
    ...DEFAULT_CAMPUS,
    site: "giheung",
    seed: 7,
    buildings: 3,
    floors: 2,
    hallsPerFloor: 2,
    podsPerHall: 6,
    detail: 0.3,
  },
  catalog,
).blueprint;
const index = new BlueprintIndex(campus);
const scene = siteScene(index, catalog);

describe("the site seen from above [REQ-006] [REQ-048]", () => {
  test("a campus becomes land with its outline, its buildings and its yards", () => {
    expect(scene).toBeDefined();
    if (!scene) return;
    expect(scene.name).toBe("기흥사업장");
    expect(scene.outline.length).toBeGreaterThanOrEqual(8);
    expect(scene.buildings).toHaveLength(3);
    expect(scene.yards.map((y) => y.kind).sort()).toContain("cooling");
    expect(scene.yards.map((y) => y.kind)).toContain("generators");
    expect(scene.yards.map((y) => y.kind)).toContain("power");
    expect(scene.parcels.length).toBeGreaterThan(0);
  });

  test("every building stands inside the land and says what it holds", () => {
    if (!scene) throw new Error("no scene");
    for (const b of scene.buildings) {
      for (const corner of [
        { x: b.x - b.w / 2, z: b.z - b.d / 2 },
        { x: b.x + b.w / 2, z: b.z + b.d / 2 },
      ])
        expect(insidePolygon(corner, scene.outline)).toBe(true);
      expect(b.floors).toBe(3);
      expect(b.height).toBeCloseTo(b.floors * b.floorH);
      expect(b.halls).toBe(4);
      expect(b.racks).toBeGreaterThan(0);
      expect(b.servers).toBeGreaterThan(b.racks);
      expect(b.modes.length).toBeGreaterThan(0);
      expect(b.roofRows).toBeGreaterThan(0);
    }
  });

  test("buildings and yards do not overlap each other", () => {
    if (!scene) throw new Error("no scene");
    const areas = [...scene.buildings.map(boundsOfBox), ...scene.yards.map((y) => y.area)];
    for (let i = 0; i < areas.length; i++)
      for (let j = i + 1; j < areas.length; j++)
        expect(overlapBounds(areas[i] as never, areas[j] as never)).toBe(false);
  });

  test("a road reaches every building and yard and keeps off them", () => {
    if (!scene) throw new Error("no scene");
    expect(scene.roads.reached.size).toBe(scene.buildings.length + scene.yards.length);
    const built = [...scene.buildings.map(boundsOfBox), ...scene.yards.map((y) => y.area)];
    for (const r of scene.roads.rects)
      for (const b of built) expect(overlapBounds(r, b)).toBe(false);
    for (const r of scene.roads.rects) {
      const c = { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 };
      expect(insidePolygon(c, scene.outline)).toBe(true);
    }
  });

  test("trees and parked cars stay off buildings, roads and each other's lots", () => {
    if (!scene) throw new Error("no scene");
    expect(scene.trees.length).toBeGreaterThan(50);
    const built = scene.buildings.map(boundsOfBox);
    for (const t of scene.trees) {
      expect(insidePolygon(t, scene.outline)).toBe(true);
      for (const b of built)
        expect(t.x > b.x0 && t.x < b.x1 && t.z > b.z0 && t.z < b.z1).toBe(false);
      for (const r of scene.roads.rects)
        expect(t.x > r.x0 && t.x < r.x1 && t.z > r.z0 && t.z < r.z1).toBe(false);
    }
    expect(scene.lots.length).toBeGreaterThan(0);
    for (const lot of scene.lots) {
      expect(lot.cars.length).toBeGreaterThan(0);
      for (const b of built) expect(overlapBounds(lot.area, b)).toBe(false);
    }
  });

  test("the same world always gives the same picture", () => {
    const again = siteScene(new BlueprintIndex(campus), catalog);
    expect(again?.trees).toEqual(scene?.trees);
    expect(again?.roads.rects).toEqual(scene?.roads.rects);
  });

  test("a site with no outline is a plain rectangle, and an empty world has no site", () => {
    const plain = {
      ...campus,
      entities: campus.entities.map((e) =>
        e.kind === "site" ? { ...e, props: { ...e.props, outline: "" } } : e,
      ),
    };
    const rect = siteScene(new BlueprintIndex(plain), catalog);
    expect(rect?.outline).toHaveLength(4);
    const none = siteScene(new BlueprintIndex({ ...campus, entities: [], links: [] }), catalog);
    expect(none).toBeUndefined();
  });

  test("the gate is where the land meets the viewer's side", () => {
    const square = [
      { x: 0, z: 0 },
      { x: 100, z: 0 },
      { x: 100, z: 80 },
      { x: 0, z: 80 },
    ];
    expect(gateOf(square, 40)).toEqual({ x: 40, z: 80 });
    // Outside the land's width there is no crossing: take the southernmost corner.
    expect(gateOf(square, 500).z).toBe(80);
  });
});
