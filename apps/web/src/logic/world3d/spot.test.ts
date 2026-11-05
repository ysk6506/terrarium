import { Catalog } from "@terrarium/core/catalog";
import { DEFAULT_CAMPUS, generateCampus } from "@terrarium/core/sources/worldgen";
import { BlueprintIndex, type Entity, footprint, roomPurposeOf } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { planFrame, toPlan } from "./frame";
import { RACK_BASE_M, U_M } from "./racks";
import { type SiteScene, siteScene } from "./site";
import { spotOf } from "./spot";

const catalog = new Catalog();
const bp = generateCampus(
  {
    ...DEFAULT_CAMPUS,
    site: "hwaseong",
    seed: 3,
    buildings: 1,
    fabs: 1,
    hallsPerFab: 2,
    floors: 2,
    hallsPerFloor: 2,
    podsPerHall: 4,
    detail: 0.5,
  },
  catalog,
).blueprint;
const index = new BlueprintIndex(bp);
const site = siteScene(index, catalog) as SiteScene;
const hall = index.ofKind("room").find((r) => roomPurposeOf(r) === "data_hall") as Entity;
const rack = index
  .descendants(hall.id)
  .find((e) => e.kind === "rack" && index.childrenOf(e.id, "server").length > 0);
const server = index.childrenOf((rack as Entity).id, "server")[0] as Entity;

describe("where a tool call's equipment stands in the 3D site [REQ-050]", () => {
  test("a rack stands on its room's plan, at the top of the rack, in the building it belongs to", () => {
    const spot = spotOf(index, catalog, site, (rack as Entity).id);
    const frame = planFrame(index, catalog, site, { kind: "room", id: hall.id });
    if (!spot || !frame) throw new Error("no spot");
    const at = toPlan(frame, spot);
    const rect = footprint(rack as Entity, catalog) as NonNullable<ReturnType<typeof footprint>>;
    expect(at.x).toBeCloseTo(rect.x + rect.w / 2);
    expect(at.y).toBeCloseTo(rect.y + rect.d / 2);
    expect(spot.y).toBeGreaterThan(frame.y + 2);
    expect(spot.building).toBe(index.enclosing(hall.id, "building")?.id);
  });

  test("a server stands in its rack at the height of its unit: higher units are higher", () => {
    const servers = index.childrenOf((rack as Entity).id, "server");
    const heights = servers.map((s) => spotOf(index, catalog, site, s.id)?.y ?? Number.NaN);
    expect(heights.every((y) => Number.isFinite(y))).toBe(true);
    const frame = planFrame(index, catalog, site, { kind: "room", id: hall.id }) as NonNullable<
      ReturnType<typeof planFrame>
    >;
    for (const y of heights) expect(y).toBeGreaterThanOrEqual(frame.y + RACK_BASE_M - 1e-9);
    const byUnit = servers
      .map((s) => ({
        u: s.placement?.type === "unit" ? s.placement.u : 0,
        y: heights[servers.indexOf(s)],
      }))
      .sort((a, b) => a.u - b.u);
    for (let i = 1; i < byUnit.length; i++)
      expect((byUnit[i]?.y ?? 0) - (byUnit[i - 1]?.y ?? 0)).toBeCloseTo(
        ((byUnit[i]?.u ?? 0) - (byUnit[i - 1]?.u ?? 0)) * U_M,
      );
    expect(spotOf(index, catalog, site, server.id)?.x).toBeCloseTo(
      spotOf(index, catalog, site, (rack as Entity).id)?.x ?? Number.NaN,
    );
  });

  test("a room, a floor and a building are marked in the middle of themselves", () => {
    const room = spotOf(index, catalog, site, hall.id);
    const floor = index.enclosing(hall.id, "floor") as Entity;
    const building = index.enclosing(hall.id, "building") as Entity;
    const info = site.buildings.find((b) => b.id === building.id) as SiteScene["buildings"][number];
    const onFloor = spotOf(index, catalog, site, floor.id);
    const onBuilding = spotOf(index, catalog, site, building.id);
    expect(room?.building).toBe(building.id);
    expect(onFloor?.x).toBeCloseTo(info.x);
    expect(onFloor?.z).toBeCloseTo(info.z);
    expect(onBuilding?.y).toBeGreaterThan(info.height);
    expect(onFloor?.floor).toBe(room?.floor);
  });

  test("the floors are counted from the lowest, so a view that parts them can lift each marker", () => {
    const floors = index.childrenOf(index.enclosing(hall.id, "building")?.id as string, "floor");
    const counted = floors.map((f) => spotOf(index, catalog, site, f.id)?.floor);
    expect(counted).toEqual(floors.map((_, i) => i));
  });

  test("plant equipment outside stands in its yard", () => {
    const item = site.yards.flatMap((y) => y.items)[0];
    if (!item) throw new Error("no yard items");
    const spot = spotOf(index, catalog, site, item.id);
    expect(spot?.x).toBe(item.x);
    expect(spot?.z).toBe(item.z);
    expect(spot?.building).toBeUndefined();
  });

  test("the site is marked over the developed land; a thing that is not in the world has no place", () => {
    const spot = spotOf(index, catalog, site, site.id);
    expect(spot?.x).toBeGreaterThan(site.cluster.x0);
    expect(spot?.x).toBeLessThan(site.cluster.x1);
    expect(spotOf(index, catalog, site, "nothing-here")).toBeUndefined();
  });

  test("a turned building carries its markers with it", () => {
    const building = index.enclosing(hall.id, "building") as Entity;
    const turned: SiteScene = {
      ...site,
      buildings: site.buildings.map((b) => (b.id === building.id ? { ...b, rot: 1.1 } : b)),
    };
    const flat = spotOf(index, catalog, site, (rack as Entity).id);
    const slant = spotOf(index, catalog, turned, (rack as Entity).id);
    const info = site.buildings.find((b) => b.id === building.id) as SiteScene["buildings"][number];
    const away = (p?: { x: number; z: number }) =>
      Math.hypot((p?.x ?? 0) - info.x, (p?.z ?? 0) - info.z);
    expect(away(slant)).toBeCloseTo(away(flat));
    expect(slant?.x).not.toBeCloseTo(flat?.x ?? 0);
  });
});
