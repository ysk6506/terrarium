import { Catalog } from "@terrarium/core/catalog";
import { DEFAULT_CAMPUS, generateCampus } from "@terrarium/core/sources/worldgen";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import {
  apronOf,
  assignUses,
  CELL_M,
  distanceTo,
  lampsOf,
  planCampus,
  reachOf,
  STREET_M,
  streetsOf,
  turned,
} from "./campus";
import { type BlockUse, EDGE_M, layoutOf, type Piece } from "./campus-layouts";
import { type Bounds, insidePolygon, overlapBounds, type Pt } from "./plan";
import { siteScene } from "./site";

const USES: readonly BlockUse[] = [
  "office",
  "dorm",
  "deck",
  "utility",
  "tanks",
  "sports",
  "pond",
  "park",
  "construction",
  "warehouse",
  "lawn",
];

const square = (side: number): Pt[] => [
  { x: 0, z: 0 },
  { x: side, z: 0 },
  { x: side, z: side },
  { x: 0, z: side },
];

const fab: Bounds = { x0: 560, z0: 560, x1: 760, z1: 700 };

const input = {
  outline: square(1400),
  buildings: [fab],
  yards: [] as Bounds[],
  roads: [] as Bounds[],
  avoid: [] as Bounds[],
  cluster: fab,
  landM2: 1400 * 1400,
  seed: 3,
};

/** How far a piece reaches from the block's centre, turn included (round things by radius). */
function extentOf(p: Piece): number {
  if (["tank", "water"].includes(p.kind)) return Math.max(Math.abs(p.x), Math.abs(p.z)) + p.w;
  const c = Math.abs(Math.cos(p.rot));
  const s = Math.abs(Math.sin(p.rot));
  const hx = (c * p.w + s * p.d) / 2;
  const hz = (s * p.w + c * p.d) / 2;
  return Math.max(Math.abs(p.x) + hx, Math.abs(p.z) + hz);
}

describe("what stands in a block of the campus [REQ-006] [REQ-048] [REQ-055]", () => {
  test.each(USES)("a %s block stays inside its streets and is the same every time", (use) => {
    const layout = layoutOf(use, 11);
    expect(layout.pieces[0]?.kind).toBe("pad");
    expect(layoutOf(use, 11)).toEqual(layout);
    for (const p of layout.pieces.filter((q) => !["crane", "fence", "path"].includes(q.kind)))
      expect(extentOf(p), `${use} ${p.kind}`).toBeLessThanOrEqual(CELL_M / 2 - STREET_M / 2);
    for (const t of layout.trees) {
      expect(Math.abs(t.x)).toBeLessThanOrEqual(EDGE_M + 2);
      expect(Math.abs(t.z)).toBeLessThanOrEqual(EDGE_M + 2);
    }
    for (const l of layout.lots) {
      expect(Math.abs(l.x) + l.w / 2).toBeLessThanOrEqual(CELL_M / 2 - STREET_M / 2);
      expect(Math.abs(l.z) + l.d / 2).toBeLessThanOrEqual(CELL_M / 2 - STREET_M / 2);
    }
  });

  test("another seed gives another building, so no two offices are the same", () => {
    const heights = new Set(
      [1, 2, 3, 4, 5, 6].map((s) => layoutOf("office", s).pieces.find((p) => p.kind === "slab")?.h),
    );
    expect(heights.size).toBeGreaterThan(2);
    expect(layoutOf("deck", 1).lots.some((l) => l.y > 0)).toBe(true);
    expect(layoutOf("construction", 1).trees).toEqual([]);
  });
});

describe("the campus around the buildings [REQ-006] [REQ-048] [REQ-055]", () => {
  const campus = planCampus(input);

  test("blocks stand on the land, clear of buildings, roads and land set aside", () => {
    expect(campus.blocks.length).toBeGreaterThan(20);
    const road: Bounds = { x0: 300, z0: 300, x1: 1100, z1: 312 };
    const lot: Bounds = { x0: 880, z0: 600, x1: 960, z1: 640 };
    const again = planCampus({ ...input, roads: [road], avoid: [lot] });
    for (const b of again.blocks) {
      for (const [x, z] of [
        [b.cell.x0, b.cell.z0],
        [b.cell.x1, b.cell.z0],
        [b.cell.x0, b.cell.z1],
        [b.cell.x1, b.cell.z1],
      ] as const)
        expect(insidePolygon({ x, z }, input.outline)).toBe(true);
      expect(overlapBounds(b.cell, { x0: 544, z0: 544, x1: 776, z1: 716 })).toBe(false);
      expect(overlapBounds(b.cell, road)).toBe(false);
      expect(overlapBounds(b.cell, lot)).toBe(false);
    }
    expect(planCampus(input)).toEqual(campus);
  });

  test("the first blocks are the usual ones, and a utility plant stands next to the building", () => {
    const uses = campus.blocks.map((b) => b.use);
    expect(uses[0]).toBe("utility");
    for (const u of ["office", "deck", "dorm", "sports", "pond", "warehouse"] as const)
      expect(uses).toContain(u);
    const nearest = [...campus.blocks].sort(
      (a, b) => distanceTo(a.centre, fab) - distanceTo(b.centre, fab),
    )[0];
    expect(nearest?.use).toBe("utility");
  });

  test("every block is closed by streets, laid once, and lamps and trees stay on the land", () => {
    for (const a of campus.streets)
      for (const b of campus.streets)
        if (a !== b) expect(overlapBounds(a.area, b.area)).toBe(false);
    const half = STREET_M / 2;
    for (const block of campus.blocks) {
      const { x0, z0, x1, z1 } = block.cell;
      const has = (along: "x" | "z", x: number, z: number) =>
        campus.streets.some(
          (s) =>
            s.along === along &&
            x >= s.area.x0 - 1 &&
            x <= s.area.x1 + 1 &&
            z >= s.area.z0 - 1 &&
            z <= s.area.z1 + 1,
        );
      const mx = (x0 + x1) / 2;
      const mz = (z0 + z1) / 2;
      expect(has("x", mx, z0 + half - 1)).toBe(true);
      expect(has("x", mx, z1 - half + 1)).toBe(true);
      expect(has("z", x0, mz)).toBe(true);
      expect(has("z", x1, mz)).toBe(true);
    }
    for (const p of [...campus.lamps, ...campus.trees])
      expect(insidePolygon(p, input.outline)).toBe(true);
    expect(campus.lamps.length).toBeGreaterThan(campus.streets.length);
  });

  test("cars fill the lots, on the roof of a car park too", () => {
    expect(campus.lots.length).toBeGreaterThan(5);
    for (const lot of campus.lots) {
      expect(lot.cars.length).toBeGreaterThan(0);
      for (const c of lot.cars) {
        expect(c.x).toBeGreaterThanOrEqual(lot.area.x0 - 3);
        expect(c.x).toBeLessThanOrEqual(lot.area.x1 + 3);
        expect(c.z).toBeGreaterThanOrEqual(lot.area.z0 - 3);
        expect(c.z).toBeLessThanOrEqual(lot.area.z1 + 3);
      }
    }
    expect(campus.lots.some((l) => l.cars.some((c) => (c.y ?? 0) > 10))).toBe(true);
  });

  test("aprons pave round each building as far as the land lets them", () => {
    expect(campus.aprons).toHaveLength(1);
    expect(campus.aprons[0]).toEqual({ x0: 538, z0: 538, x1: 782, z1: 722 });
    const edge: Bounds = { x0: 10, z0: 10, x1: 110, z1: 110 };
    expect(apronOf(edge, input.outline)).toEqual({ x0: 4, z0: 4, x1: 116, z1: 116 });
    expect(apronOf({ x0: 2, z0: 2, x1: 50, z1: 50 }, input.outline)).toBeUndefined();
  });

  test("nothing is built where there is no land, or no building to build round", () => {
    const empty = planCampus({
      ...input,
      outline: square(120),
      cluster: { x0: 30, z0: 30, x1: 90, z1: 90 },
      buildings: [{ x0: 30, z0: 30, x1: 90, z1: 90 }],
    });
    expect(empty.blocks).toEqual([]);
    expect(empty.streets).toEqual([]);
    expect(empty.lamps).toEqual([]);
    const none = planCampus({ ...input, buildings: [], yards: [] });
    expect(none.blocks).toEqual([]);
  });
});

describe("the rules the campus is laid by [REQ-006] [REQ-048] [REQ-055]", () => {
  test("quarter turns move a point round the vertical axis", () => {
    expect(turned(10, 0, 0)).toEqual({ x: 10, z: 0 });
    expect(turned(10, 0, 1)).toEqual({ x: 0, z: -10 });
    expect(turned(10, 0, 2)).toEqual({ x: -10, z: 0 });
    expect(turned(0, 10, 3)).toEqual({ x: -10, z: 0 });
  });

  test("distance to a rectangle is zero inside it, straight outside it, diagonal at a corner", () => {
    const b: Bounds = { x0: 0, z0: 0, x1: 10, z1: 10 };
    expect(distanceTo({ x: 5, z: 5 }, b)).toBe(0);
    expect(distanceTo({ x: 15, z: 5 }, b)).toBe(5);
    expect(distanceTo({ x: 13, z: 14 }, b)).toBe(5);
  });

  test("the campus reaches further on bigger land, within limits", () => {
    expect(reachOf(0)).toBe(260);
    expect(reachOf(1_000_000)).toBeCloseTo(360);
    expect(reachOf(50_000_000)).toBe(620);
  });

  test("one block with its streets has four, and neighbours share the street between them", () => {
    expect(streetsOf(new Set(["0,0"]))).toHaveLength(4);
    expect(streetsOf(new Set(["0,0", "1,0"]))).toHaveLength(7);
    expect(streetsOf(new Set())).toEqual([]);
  });

  test("lamps alternate sides along a street and stay on the land", () => {
    const streets = streetsOf(new Set(["0,0"]));
    const lamps = lampsOf(streets, square(500));
    expect(lamps.length).toBeGreaterThanOrEqual(4);
    expect(lampsOf(streets, square(40))).toEqual([]);
  });

  test("a utility plant goes next to every building, the rest by order and by weight", () => {
    const cells = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => ({
      i,
      j: 0,
      rect: { x0: i * CELL_M, z0: 0, x1: (i + 1) * CELL_M, z1: CELL_M },
      centre: { x: i * CELL_M + CELL_M / 2, z: CELL_M / 2 },
      dist: i * 40,
    }));
    const buildings: Bounds[] = [
      { x0: -100, z0: 0, x1: -10, z1: CELL_M },
      { x0: 12 * CELL_M + 100, z0: 0, x1: 12 * CELL_M + 200, z1: CELL_M },
    ];
    const uses = assignUses(cells, buildings, 400, 3);
    expect(uses.get("0,0")).toBe("utility");
    expect(uses.get("12,0")).toBe("utility");
    expect(uses.get("1,0")).toBe("office");
    expect(uses.size).toBe(cells.length);
    expect([...uses.values()].filter((u) => u === "utility").length).toBeGreaterThanOrEqual(2);
  });
});

describe("a site gets its campus [REQ-006] [REQ-048] [REQ-055]", () => {
  const catalog = new Catalog();
  const blueprint = generateCampus(
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
  const scene = siteScene(new BlueprintIndex(blueprint), catalog);

  test("streets, blocks and paved ground come with the buildings, and the forest keeps off them", () => {
    expect(scene).toBeDefined();
    if (!scene) return;
    expect(scene.campus.blocks.length).toBeGreaterThan(10);
    expect(scene.campus.aprons).toHaveLength(scene.buildings.length);
    for (const t of scene.trees)
      for (const cell of scene.campus.occupied)
        expect(t.x > cell.x0 && t.x < cell.x1 && t.z > cell.z0 && t.z < cell.z1).toBe(false);
    for (const lot of scene.lots)
      for (const block of scene.campus.blocks)
        expect(overlapBounds(lot.area, block.cell)).toBe(false);
  });
});
