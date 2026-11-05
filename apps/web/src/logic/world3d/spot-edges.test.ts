import { Catalog } from "@terrarium/core/catalog";
import { DEFAULT_CAMPUS, generateCampus } from "@terrarium/core/sources/worldgen";
import { BlueprintIndex, type Entity, roomPurposeOf } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
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
const building = index.enclosing(hall.id, "building") as Entity;
const rack = index.descendants(hall.id).find((e) => e.kind === "rack") as Entity;

describe("where equipment stands when the picture cannot place it [REQ-050]", () => {
  test("a piece of land stands where the site stands, since it has no equipment place of its own", () => {
    const parcel = index.ofKind("parcel")[0] as Entity;
    expect(spotOf(index, catalog, site, parcel.id)).toEqual(spotOf(index, catalog, site, site.id));
  });

  test("a picture that does not show the building has no place for its floors, rooms or racks", () => {
    const without: SiteScene = {
      ...site,
      buildings: site.buildings.filter((b) => b.id !== building.id),
    };
    const floor = index.enclosing(hall.id, "floor") as Entity;
    expect(spotOf(index, catalog, without, building.id)).toBeUndefined();
    expect(spotOf(index, catalog, without, floor.id)).toBeUndefined();
    expect(spotOf(index, catalog, without, hall.id)).toBeUndefined();
    expect(spotOf(index, catalog, without, rack.id)).toBeUndefined();
  });

  test("a chain of parents that is too long, or ends without a place, gives no place", () => {
    expect(spotOf(index, catalog, site, rack.id, 9)).toBeUndefined();
    const orphan: Entity = {
      ...(index.ofKind("generator")[0] as Entity),
      id: "orphan-gen",
      parentId: undefined,
    };
    const alone = new BlueprintIndex({ ...bp, entities: [...bp.entities, orphan] });
    expect(spotOf(alone, catalog, site, "orphan-gen")).toBeUndefined();
  });

  test("a rack mounted without a unit height or an equipment without a room still gets the rack's place", () => {
    const flat = spotOf(index, catalog, site, rack.id);
    const mounted = index.childrenOf(rack.id, "server")[0] ?? index.childrenOf(rack.id)[0];
    const onRack = mounted && spotOf(index, catalog, site, mounted.id);
    expect(onRack?.x).toBeCloseTo(flat?.x ?? Number.NaN);
    expect(onRack?.z).toBeCloseTo(flat?.z ?? Number.NaN);
  });
});
