import { Catalog } from "@terrarium/core/catalog";
import { SITE_PRESETS } from "@terrarium/core/sources/worldgen";
import { parseOutline } from "@terrarium/core/spatial";
import { BlueprintIndex, hasErrors, validateBlueprint } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import {
  addBuilding,
  buyParcel,
  forSaleParcels,
  forSaleTotal,
  newSite,
  outlineProblem,
  parcelViews,
  rectangleOutline,
} from ".";

const catalog = new Catalog();

describe("a new site [REQ-048]", () => {
  test("a shape needs three points that do not cross, and a size the world can hold", () => {
    expect(
      outlineProblem([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]),
    ).toBe("점을 3개 이상 찍어 주세요");
    const bowtie = [
      { x: 0, y: 0 },
      { x: 200, y: 200 },
      { x: 200, y: 0 },
      { x: 0, y: 200 },
    ];
    expect(outlineProblem(bowtie)).toMatch(/서로 가로질러요.*다시 찍어 주세요/);
    expect(outlineProblem(rectangleOutline(50, 50))).toMatch(/너무 작아요.*10,000㎡ 이상/);
    expect(outlineProblem(rectangleOutline(5000, 600))).toMatch(/너무 넓어요|너무 길어요/);
    expect(outlineProblem(rectangleOutline(3200, 300))).toMatch(/너무 길어요.*3,000 m까지/);
    expect(outlineProblem(rectangleOutline(600, 400))).toBeUndefined();
    const lShape = [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 300 },
      { x: 0, y: 300 },
    ];
    expect(outlineProblem(lShape)).toBeUndefined();
  });

  test("every site preset's shape is one that can be made", () => {
    for (const p of SITE_PRESETS) expect(outlineProblem(p.outline), p.name).toBeUndefined();
  });

  test("a site with land for sale holds the shape, the pieces, and their prices, and nothing is invalid", () => {
    const bp = newSite({
      name: "새 사업장",
      siteName: "시험사업장",
      outline: rectangleOutline(600, 400),
      forSale: true,
    });
    const index = new BlueprintIndex(bp);
    const site = index.ofKind("site")[0];
    expect(parseOutline(site?.props.outline)).toHaveLength(4);
    const views = parcelViews(index, catalog);
    expect(views).toHaveLength(4);
    expect(views.every((v) => !v.owned && v.priceM > 0)).toBe(true);
    expect(views.map((v) => v.name)).toContain("동쪽 확장 부지 1");
    expect(site?.placement).toMatchObject({ type: "land", w: 750, d: 500 });
    expect(hasErrors(validateBlueprint(bp, catalog))).toBe(false);
    const total = forSaleTotal(600, 400);
    expect(total.count).toBe(4);
    expect(total.priceM).toBe(views.reduce((s, v) => s + v.priceM, 0));
  });

  test("the pieces do not overlap each other or the shape", () => {
    const pieces = forSaleParcels(600, 400);
    for (const a of pieces)
      for (const b of pieces)
        if (a !== b)
          expect(
            a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.d && b.y < a.y + a.d,
            `${a.name} / ${b.name}`,
          ).toBe(false);
    for (const p of pieces) expect(p.x >= 600 || p.y >= 400).toBe(true);
  });

  test("a building stands inside the shape, not on land for sale until it is bought", () => {
    const bp = newSite({
      name: "새 사업장",
      siteName: "시험사업장",
      outline: rectangleOutline(600, 400),
      forSale: true,
    });
    expect(addBuilding(bp, catalog, { x: 40, y: 40, w: 60, d: 40 }).blueprint).toBeDefined();
    expect(() => addBuilding(bp, catalog, { x: 640, y: 40, w: 60, d: 40 })).toThrow(
      /아직 사지 않은 땅이에요/,
    );
    const bought = buyParcel(bp, "parcel-1").blueprint;
    expect(addBuilding(bought, catalog, { x: 640, y: 40, w: 60, d: 40 }).blueprint).toBeDefined();
  });

  test("a site without land for sale is the shape alone", () => {
    const bp = newSite({
      name: "새 사업장",
      siteName: "시험사업장",
      outline: rectangleOutline(300, 200),
      forSale: false,
    });
    expect(new BlueprintIndex(bp).ofKind("parcel")).toHaveLength(0);
    expect(hasErrors(validateBlueprint(bp, catalog))).toBe(false);
  });

  test("a shape that cannot be a site is refused with its reason", () => {
    expect(() =>
      newSite({
        name: "x",
        siteName: "y",
        outline: rectangleOutline(30, 30),
        forSale: false,
      }),
    ).toThrow(/너무 작아요/);
  });
});
