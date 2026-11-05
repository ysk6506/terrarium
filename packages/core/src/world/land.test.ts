import { Catalog } from "@terrarium/core/catalog";
import { encodeOutline } from "@terrarium/core/spatial";
import { describe, expect, test } from "vitest";
import { BlueprintIndex, type Entity, landProblem, parcelPriceM } from ".";
import { campusBlueprint } from "./test-support/sample-campus";

const catalog = new Catalog();

function indexWith(change: (site: Entity, parcels: Entity[]) => Entity[]): BlueprintIndex {
  const bp = campusBlueprint();
  const site = bp.entities.find((e) => e.kind === "site") as Entity;
  const parcels = bp.entities.filter((e) => e.kind === "parcel");
  const rest = bp.entities.filter((e) => e.kind !== "site" && e.kind !== "parcel");
  return new BlueprintIndex({ ...bp, entities: [...rest, ...change(site, parcels)] });
}

describe("why a building cannot stand on this land [REQ-043] [REQ-048]", () => {
  test("a place on land the owner holds has no problem", () => {
    const index = indexWith((site, parcels) => [site, ...parcels]);
    expect(landProblem(index, catalog, { x: 12, y: 12, w: 40, d: 30 })).toBeUndefined();
  });

  test("a place on a parcel for sale names that parcel, so the builder can offer to buy it", () => {
    const index = indexWith((site, parcels) => [site, ...parcels]);
    const problem = landProblem(index, catalog, { x: 120, y: 12, w: 40, d: 30 });
    expect(problem?.message).toMatch(/[은는] 아직 사지 않은 땅이에요\. 먼저 사 주세요$/);
    expect(index.find(problem?.parcelId as string)?.kind).toBe("parcel");
  });

  test("a place off every parcel is simply not the owner's land", () => {
    const index = indexWith((site, parcels) => [site, ...parcels]);
    const problem = landProblem(index, catalog, { x: 900, y: 900, w: 40, d: 30 });
    expect(problem?.message).toMatch(/내 땅이 아니에요/);
    expect(problem?.parcelId).toBeUndefined();
  });

  test("a site with an outline holds the land inside it, and parcels outside it are for sale", () => {
    const outline = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const index = indexWith((site) => [
      { ...site, props: { ...site.props, outline: encodeOutline(outline) } },
    ]);
    expect(landProblem(index, catalog, { x: 20, y: 20, w: 40, d: 30 })).toBeUndefined();
    expect(landProblem(index, catalog, { x: 150, y: 20, w: 40, d: 30 })?.message).toMatch(
      /내 땅이 아니에요/,
    );
  });

  test("a site with neither parcels nor an outline is all the owner's", () => {
    const index = indexWith((site) => [site]);
    expect(landProblem(index, catalog, { x: 900, y: 900, w: 40, d: 30 })).toBeUndefined();
  });

  test("a parcel's price follows its size", () => {
    expect(parcelPriceM(100, 200)).toBe(24000);
    expect(parcelPriceM(70, 70)).toBe(5880);
  });
});
