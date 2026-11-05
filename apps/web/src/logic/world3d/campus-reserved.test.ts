import { Catalog } from "@terrarium/core/catalog";
import { DEFAULT_CAMPUS, generateCampus } from "@terrarium/core/sources/worldgen";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { planCampus } from "./campus";
import { type Bounds, overlapBounds, type Pt } from "./plan";
import { siteScene } from "./site";

const square = (side: number): Pt[] => [
  { x: 0, z: 0 },
  { x: side, z: 0 },
  { x: side, z: side },
  { x: 0, z: side },
];

const fab: Bounds = { x0: 560, z0: 560, x1: 760, z1: 700 };
const unbuilt: Bounds = { x0: 900, z0: 560, x1: 1100, z1: 700 };
const input = {
  outline: square(1600),
  buildings: [fab],
  yards: [] as Bounds[],
  roads: [] as Bounds[],
  avoid: [] as Bounds[],
  cluster: fab,
  landM2: 1600 * 1600,
  seed: 3,
};

describe("the campus leaves the places the map gives to buildings that are not built [REQ-056] [REQ-055] [REQ-048]", () => {
  test("no block is laid on an unbuilt place, which is kept as cleared ground", () => {
    const campus = planCampus({ ...input, reserved: [unbuilt] });
    expect(campus.cleared).toEqual([unbuilt]);
    expect(campus.blocks.length).toBeGreaterThan(10);
    for (const b of campus.blocks)
      expect(overlapBounds(b.cell, { x0: 884, z0: 544, x1: 1116, z1: 716 })).toBe(false);
  });

  test("a campus with nothing built but a place on the map is still laid round that place", () => {
    const campus = planCampus({
      ...input,
      buildings: [],
      reserved: [unbuilt],
      cluster: unbuilt,
    });
    expect(campus.blocks.length).toBeGreaterThan(10);
    expect(campus.aprons).toEqual([]);
    expect(campus.cleared).toEqual([unbuilt]);
  });

  test("without places left over nothing is cleared, and the campus is what it was", () => {
    expect(planCampus(input).cleared).toEqual([]);
    expect(planCampus({ ...input, reserved: [] })).toEqual(planCampus(input));
  });
});

describe("a half-built Hwaseong keeps every fab place on its map [REQ-056] [REQ-048]", () => {
  const catalog = new Catalog();
  const blueprint = generateCampus(
    {
      ...DEFAULT_CAMPUS,
      site: "hwaseong",
      seed: 5,
      buildings: 1,
      fabs: 3,
      labs: 1,
      podsPerHall: 4,
      detail: 0.5,
    },
    catalog,
  ).blueprint;
  const scene = siteScene(new BlueprintIndex(blueprint), catalog);

  test("the six fab places and the two DSR places not built are cleared, and decoration keeps off them", () => {
    expect(scene).toBeDefined();
    if (!scene) return;
    expect(scene.campus.cleared).toHaveLength(6);
    for (const plot of scene.campus.cleared) {
      for (const block of scene.campus.blocks) expect(overlapBounds(block.cell, plot)).toBe(false);
      for (const b of scene.buildings)
        expect(
          overlapBounds(plot, {
            x0: b.x - b.w / 2,
            z0: b.z - b.d / 2,
            x1: b.x + b.w / 2,
            z1: b.z + b.d / 2,
          }),
        ).toBe(false);
      for (const t of scene.trees)
        expect(t.x > plot.x0 && t.x < plot.x1 && t.z > plot.z0 && t.z < plot.z1).toBe(false);
    }
  });

  test("the DSR tower is a research building of 27 floors, the HPC centre is a data centre of 11", () => {
    const tower = scene?.buildings.find((b) => b.purpose === "research");
    expect(tower?.floors).toBe(27);
    expect(tower?.height).toBeGreaterThan(100);
    const hpc = scene?.buildings.find((b) => b.name === "HPC센터");
    expect(hpc?.purpose).toBe("data_center");
    expect(hpc?.floors).toBe(DEFAULT_CAMPUS.floors + 1);
  });
});
