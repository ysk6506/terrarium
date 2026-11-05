import { Catalog } from "@terrarium/core/catalog";
import {
  type Blueprint,
  BlueprintIndex,
  buildingFloorSpaces,
  footprint,
  insideRoomLocal,
  isSizeLocked,
  powerCapacityOf,
  RACK_AREA_M2,
  racksThatFit,
  roomArea,
  roomPurposeOf,
  roomRects,
  shapesOverlap,
  siteDrawW,
  WHITE_FLOOR_SHARE,
} from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { type CampusSpec, DEFAULT_CAMPUS, generateCampus, SITE_CAMPUS_MIX, SITE_PRESETS } from ".";

const catalog = new Catalog();
const hwaseong = (seed: number): CampusSpec => ({
  ...DEFAULT_CAMPUS,
  ...SITE_CAMPUS_MIX.hwaseong,
  site: "hwaseong",
  seed,
});

const result = generateCampus(hwaseong(1), catalog);
const index = new BlueprintIndex(result.blueprint);
const hpc = index.ofKind("building").find((b) => b.name === "HPC센터");
const floors = (hpc ? index.childrenOf(hpc.id, "floor") : []).slice().sort((a, b) => {
  const n = (e: typeof a) => (e.placement?.type === "level" ? e.placement.level : 0);
  return n(a) - n(b);
});
const roomsOn = (floorId: string) => index.childrenOf(floorId, "room");
const purposes = (floorId: string) => roomsOn(floorId).map((r) => roomPurposeOf(r));
const count = (list: readonly string[], what: string) => list.filter((p) => p === what).length;
const racksOf = (bp: Blueprint, building: string): number => {
  const idx = new BlueprintIndex(bp);
  return idx.descendants(building).filter((e) => e.kind === "rack").length;
};

describe("the Hwaseong HPC centre has the size of the real building [REQ-076]", () => {
  test("it stands on a 95 x 72 m floor (the 6,806 m² of the architect's page), locked to that size", () => {
    expect(hpc).toBeDefined();
    const box = footprint(hpc as NonNullable<typeof hpc>, catalog);
    expect(box).toMatchObject({ w: 95, d: 72 });
    expect(Math.abs((box?.w ?? 0) * (box?.d ?? 0) - 6806.4) / 6806.4).toBeLessThan(0.01);
    expect(isSizeLocked(hpc)).toBe(true);
  });

  test("it has eleven floors above ground, and the grid connection of 108 MW is the published figure", () => {
    expect(floors).toHaveLength(11);
    expect(floors.map((f) => f.name)).toEqual(
      ["1F", ...Array.from({ length: 10 }, (_, i) => `${i + 2}F`)].sort(
        (a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10),
      ),
    );
    const site = index.ofKind("site")[0];
    expect(powerCapacityOf(site)).toEqual({ mw: 108, estimated: false });
  });

  test("the ground floor has the lobby and loading bay, a storeroom, the network room and the control room", () => {
    const ground = floors[0]?.id as string;
    expect(purposes(ground).sort()).toEqual(["lobby", "network", "noc", "storage"]);
  });

  test("every server floor has two or three server rooms, and an electrical room, a mechanical room and a storeroom", () => {
    for (const floor of floors.slice(1)) {
      const kinds = purposes(floor.id);
      expect(count(kinds, "data_hall")).toBeGreaterThanOrEqual(2);
      expect(count(kinds, "data_hall")).toBeLessThanOrEqual(3);
      expect(count(kinds, "electrical")).toBe(1);
      expect(count(kinds, "mechanical")).toBe(1);
      expect(count(kinds, "storage")).toBe(1);
    }
  });

  test("the server rooms take 55 to 60 % of each server floor, and the rooms fit the floor with free floor to spare", () => {
    const floorM2 = 95 * 72;
    for (const floor of floors.slice(1)) {
      const halls = roomsOn(floor.id).filter((r) => roomPurposeOf(r) === "data_hall");
      const white = halls.reduce((n, r) => n + roomArea(r), 0) / floorM2;
      expect(white).toBeGreaterThanOrEqual(WHITE_FLOOR_SHARE.low - 0.005);
      expect(white).toBeLessThanOrEqual(WHITE_FLOOR_SHARE.high + 0.005);
    }
    for (const space of buildingFloorSpaces(index, catalog, hpc?.id as string)) {
      expect(space.overM2).toBe(0);
      expect(space.freeM2).toBeGreaterThan(100);
    }
  });

  test("no room leaves the building or lands on another, and everything in a room stands inside it", () => {
    for (const floor of floors) {
      const rooms = roomsOn(floor.id);
      for (const room of rooms) {
        for (const r of roomRects(room)) {
          expect(r.x).toBeGreaterThanOrEqual(0);
          expect(r.y).toBeGreaterThanOrEqual(0);
          expect(r.x + r.w).toBeLessThanOrEqual(95 + 1e-6);
          expect(r.y + r.d).toBeLessThanOrEqual(72 + 1e-6);
        }
        for (const other of rooms.filter((o) => o.id < room.id))
          expect(shapesOverlap(roomRects(room), roomRects(other))).toBe(false);
        for (const e of index.descendants(room.id)) {
          if (e.placement?.type !== "spot") continue;
          const at = footprint(e, catalog);
          if (at) expect(insideRoomLocal(room, at)).toBe(true);
        }
      }
    }
  });
});

describe("the racks of the HPC centre follow the area rule and the power it has [REQ-076]", () => {
  const racks = racksOf(result.blueprint, hpc?.id as string);

  test("it holds 10,000 to 13,000 racks, as many as its white floor takes at about 2.6 m² a rack and a little fewer", () => {
    expect(racks).toBeGreaterThanOrEqual(10_000);
    expect(racks).toBeLessThanOrEqual(13_000);
    const white = floors
      .flatMap((f) => roomsOn(f.id))
      .filter((r) => roomPurposeOf(r) === "data_hall")
      .reduce((n, r) => n + roomArea(r), 0);
    expect(RACK_AREA_M2).toBe(2.6);
    expect(racks).toBeLessThanOrEqual(racksThatFit(white));
    expect(racks).toBeGreaterThan(0.6 * racksThatFit(white));
  });

  test("its design load stays under the 108 MW connection, near 8 kW a rack", () => {
    const site = index.ofKind("site")[0];
    const drawMw = siteDrawW(index, catalog) / 1e6;
    expect(drawMw).toBeLessThan(powerCapacityOf(site)?.mw ?? 0);
    expect(drawMw / racks).toBeGreaterThan(0.005);
    expect(drawMw / racks).toBeLessThan(0.0125);
  });

  test("the generated world has no errors, and the same seed gives the same world", () => {
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(generateCampus(hwaseong(1), catalog).blueprint).toEqual(result.blueprint);
  });

  test.each([2, 3, 4])("seed %i: the rack count, the floors and the load hold too", (seed) => {
    const other = generateCampus(hwaseong(seed), catalog);
    const idx = new BlueprintIndex(other.blueprint);
    const b = idx.ofKind("building").find((x) => x.name === "HPC센터");
    const n = racksOf(other.blueprint, b?.id as string);
    expect(n).toBeGreaterThanOrEqual(10_000);
    expect(n).toBeLessThanOrEqual(13_000);
    expect(other.issues.filter((i) => i.severity === "error")).toEqual([]);
    for (const space of buildingFloorSpaces(idx, catalog, b?.id as string))
      expect(space.overM2).toBe(0);
    expect(siteDrawW(idx, catalog) / 1e6).toBeLessThan(108);
  });
});

describe("buildings on a map's place are locked, and every site names its connection [REQ-076]", () => {
  test("every building made on a slot of the map has its size locked, the others do not", () => {
    const fabs = index.ofKind("building").filter((b) => b.props.purpose === "fab");
    expect(fabs.length).toBe(7);
    expect(fabs.every((b) => isSizeLocked(b))).toBe(true);
    const plain = generateCampus(
      { ...DEFAULT_CAMPUS, site: "suwon", seed: 3, buildings: 1, podsPerHall: 2 },
      catalog,
    );
    const suwon = new BlueprintIndex(plain.blueprint).ofKind("building");
    expect(suwon.length).toBeGreaterThan(0);
    expect(suwon.some((b) => isSizeLocked(b))).toBe(false);
  });

  test("only the Hwaseong figure is published; the other sites say their capacity is an estimate", () => {
    for (const preset of SITE_PRESETS) {
      expect(preset.power.mw).toBeGreaterThan(0);
      expect(preset.power.estimated).toBe(preset.id !== "hwaseong");
    }
  });
});
