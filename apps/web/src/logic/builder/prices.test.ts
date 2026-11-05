import { Catalog } from "@terrarium/core/catalog";
import {
  BlueprintIndex,
  BUILD_RATE_M_PER_M2,
  type Entity,
  FIT_OUT_RATE_M_PER_M2,
  landMarket,
  PYEONG_M2,
} from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import {
  addBuilding,
  addFloor,
  addRoom,
  buyParcel,
  forSaleTotal,
  type Level,
  landCostM,
  levelStats,
  newSite,
  parcelViews,
  rectangleOutline,
} from ".";

const catalog = new Catalog();
const SITE: Level = { kind: "site" };

describe("what building and buying cost in the builder [REQ-059]", () => {
  const world = (market?: string) =>
    newSite({
      name: "값 시험",
      siteName: "시험사업장",
      outline: rectangleOutline(600, 400),
      forSale: true,
      ...(market ? { market } : {}),
    });

  test("land for sale is priced by the market of the place, and the site remembers which", () => {
    const hwaseong = world("hwaseong");
    const site = hwaseong.entities.find((e) => e.kind === "site") as Entity;
    expect(site.props.landMarket).toBe("hwaseong");
    expect(site.props.landPriceM).toBe(landMarket("hwaseong").perM2M);
    const views = parcelViews(new BlueprintIndex(hwaseong), catalog);
    for (const v of views)
      expect(v.priceM).toBeCloseTo(v.areaM2 * landMarket("hwaseong").perM2M, -1);
    // Dearer places cost more for the very same land.
    expect(forSaleTotal(600, 400, "suwon").priceM).toBeGreaterThan(
      forSaleTotal(600, 400, "hwaseong").priceM,
    );
    expect(forSaleTotal(600, 400, "hwaseong").priceM).toBeGreaterThan(
      forSaleTotal(600, 400, "cheonan").priceM,
    );
    // Not saying where means ordinary factory land.
    expect(forSaleTotal(600, 400).priceM).toBe(forSaleTotal(600, 400, "general").priceM);
  });

  test("a parcel's price per pyeong can be read back from what it costs", () => {
    const bp = world("giheung");
    const v = parcelViews(new BlueprintIndex(bp), catalog)[0];
    const perPyeong = ((v?.priceM ?? 0) / (v?.areaM2 ?? 1)) * PYEONG_M2;
    expect(perPyeong).toBeCloseTo(landMarket("giheung").perM2M * PYEONG_M2, 0);
  });

  test("a building costs its floors at its purpose's rate, once it stands and again for every floor added", () => {
    const bought = buyParcel(world("hwaseong"), "parcel-1").blueprint;
    const built = addBuilding(bought, catalog, { x: 610, y: 10, w: 100, d: 80 }, "fab");
    const landOnly = levelStats(new BlueprintIndex(bought), catalog, SITE).costM;
    const withFab = levelStats(new BlueprintIndex(built.blueprint), catalog, SITE).costM;
    expect(withFab - landOnly).toBeCloseTo(100 * 80 * BUILD_RATE_M_PER_M2.fab, 3);
    const two = addFloor(built.blueprint, built.select[0] as string).blueprint;
    expect(levelStats(new BlueprintIndex(two), catalog, SITE).costM - withFab).toBeCloseTo(
      100 * 80 * BUILD_RATE_M_PER_M2.fab,
      3,
    );
    expect(landCostM(new BlueprintIndex(two))).toBe(landCostM(new BlueprintIndex(bought)));
  });

  test("a floor's own view counts its walls and its rooms' fit-out, not the land or the building's other floors", () => {
    const bought = buyParcel(world(), "parcel-1").blueprint;
    const built = addBuilding(bought, catalog, { x: 610, y: 10, w: 60, d: 40 });
    const floorId = new BlueprintIndex(built.blueprint).ofKind("floor")[0]?.id as string;
    const withRoom = addRoom(built.blueprint, catalog, floorId, { x: 1.2, y: 1.2, w: 12, d: 9 });
    const index = new BlueprintIndex(withRoom.blueprint);
    const level: Level = { kind: "floor", id: floorId };
    expect(levelStats(index, catalog, level).costM).toBeCloseTo(
      60 * 40 * BUILD_RATE_M_PER_M2.data_center + 12 * 9 * FIT_OUT_RATE_M_PER_M2.data_hall,
      3,
    );
    const roomId = index.ofKind("room")[0]?.id as string;
    expect(levelStats(index, catalog, { kind: "room", id: roomId }).costM).toBeCloseTo(
      12 * 9 * FIT_OUT_RATE_M_PER_M2.data_hall,
      3,
    );
  });
});
