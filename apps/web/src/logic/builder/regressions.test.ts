/** Bugs the random walk (fuzz.test.ts) found, kept as small cases so they never come back. */
import { Catalog } from "@terrarium/core/catalog";
import { BlueprintIndex, hasErrors, validateBlueprint } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import {
  addBuilding,
  buyParcel,
  EditError,
  moveTo,
  newSite,
  placePlant,
  rectangleOutline,
  resizeArea,
  rotate,
} from ".";

const catalog = new Catalog();
const SITE = { kind: "site" } as const;

const world = () =>
  newSite({
    name: "회귀 시험",
    siteName: "시험사업장",
    outline: rectangleOutline(600, 400),
    forSale: true,
    market: "general",
  });

describe("what the builder refused to let go wrong [REQ-043] [REQ-048]", () => {
  test("land cannot be moved or resized: a building could be left without ground under it", () => {
    const bp = buyParcel(world(), "parcel-2").blueprint;
    expect(() => moveTo(bp, catalog, SITE, "parcel-2", 0, 0)).toThrow(
      /옮기거나 크기를 바꿀 수 없어요/,
    );
    expect(() => resizeArea(bp, catalog, "parcel-2", { x: 0, y: 0, w: 10, d: 10 })).toThrow(
      EditError,
    );
  });

  test("a generator cannot be moved or turned onto a building, or onto land that is for sale", () => {
    let bp = addBuilding(world(), catalog, { x: 100, y: 100, w: 40, d: 40 }).blueprint;
    bp = placePlant(bp, catalog, "tg-diesel-2mw", { x: 300, y: 100, rotation: 0 }).blueprint;
    const gen = new BlueprintIndex(bp).ofKind("generator")[0];
    expect(gen).toBeDefined();
    const id = gen?.id as string;
    expect(() => moveTo(bp, catalog, SITE, id, 110, 110)).toThrow(/겹쳐요/);
    expect(() => moveTo(bp, catalog, SITE, id, 650, 100)).toThrow(/아직 사지 않은 땅/);
    const edge = moveTo(bp, catalog, SITE, id, 100, 142).blueprint;
    expect(() => rotate(edge, catalog, SITE, id)).not.toThrow();
    const moved = moveTo(bp, catalog, SITE, id, 400, 200).blueprint;
    expect(hasErrors(validateBlueprint(moved, catalog))).toBe(false);
  });

  test("a building cannot be resized or moved onto a generator", () => {
    let bp = addBuilding(world(), catalog, { x: 100, y: 100, w: 40, d: 40 }).blueprint;
    bp = placePlant(bp, catalog, "tg-diesel-2mw", { x: 300, y: 100, rotation: 0 }).blueprint;
    const building = new BlueprintIndex(bp).ofKind("building")[0]?.id as string;
    expect(() => moveTo(bp, catalog, SITE, building, 300, 100)).toThrow(/겹쳐요/);
    expect(() => resizeArea(bp, catalog, building, { x: 100, y: 100, w: 220, d: 40 })).toThrow(
      /겹쳐요/,
    );
  });
});
