import { Catalog } from "@terrarium/core/catalog";
import { type Blueprint, BlueprintIndex, type Entity } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import {
  addBuilding,
  addFloor,
  addRoom,
  buyParcel,
  EditError,
  emptyWorld,
  type Level,
  landCostM,
  levelStats,
  moveTo,
  parcelViews,
  placePlant,
  planFor,
} from ".";

const catalog = new Catalog();
const SITE: Level = { kind: "site" };

const parcel = (id: string, name: string, x: number, w: number, owned?: false): Entity => ({
  id,
  kind: "parcel",
  name,
  parentId: "site-1",
  placement: { type: "area", x, y: 0, w, d: 200 },
  props: owned === false ? { owned: false, areaM2: w * 200, priceM: w * 200 * 1.2 } : {},
});

/** A site of 300 × 200 m: the left half is the owner's, the right half is for sale. */
function land(): Blueprint {
  const bp = emptyWorld("w", "땅 시험", { w: 300, d: 200 }, "시험사업장");
  return {
    ...bp,
    entities: [
      ...bp.entities,
      parcel("p-own", "본 부지", 0, 150),
      parcel("p-sale", "동쪽 확장 부지 1", 150, 150, false),
    ],
  };
}

describe("land, buildings and plant on the site [REQ-043] [REQ-048]", () => {
  test("a parcel for sale is told apart from land the owner holds, with its price", () => {
    const index = new BlueprintIndex(land());
    const views = parcelViews(index, catalog);
    expect(views.map((v) => [v.name, v.owned])).toEqual([
      ["본 부지", true],
      ["동쪽 확장 부지 1", false],
    ]);
    expect(views[1]?.priceM).toBe(36000);
  });

  test("a building cannot stand on land that is not bought, and the reason says which parcel and what it costs", () => {
    const bp = land();
    expect(() => addBuilding(bp, catalog, { x: 200, y: 50, w: 40, d: 30 })).toThrow(
      /동쪽 확장 부지 1은 아직 사지 않은 땅이에요.*먼저 사 주세요 \(360억 원\)/,
    );
    expect(() => addBuilding(bp, catalog, { x: 20, y: 50, w: 40, d: 30 })).not.toThrow();
  });

  test("buying a parcel makes it the owner's land, once, and counts what it cost", () => {
    const bp = land();
    const bought = buyParcel(bp, "p-sale").blueprint;
    expect(parcelViews(new BlueprintIndex(bought), catalog).every((v) => v.owned)).toBe(true);
    expect(() => buyParcel(bought, "p-sale")).toThrow(/이미 내 땅이에요/);
    expect(() => buyParcel(bp, "nope")).toThrow(EditError);
    expect(landCostM(new BlueprintIndex(bp))).toBe(0);
    expect(landCostM(new BlueprintIndex(bought))).toBe(36000);
    expect(levelStats(new BlueprintIndex(bought), catalog, SITE).costM).toBe(36000);
    // The land that was always the owner's is not counted: nothing was bought.
    expect(() => addBuilding(bought, catalog, { x: 200, y: 50, w: 40, d: 30 })).not.toThrow();
  });

  test("a building stands across two owned parcels, but not half on land for sale", () => {
    const bp = land();
    expect(() => addBuilding(bp, catalog, { x: 130, y: 50, w: 40, d: 30 })).toThrow(
      /아직 사지 않은 땅/,
    );
    const bought = buyParcel(bp, "p-sale").blueprint;
    expect(() => addBuilding(bought, catalog, { x: 130, y: 50, w: 40, d: 30 })).not.toThrow();
  });

  test("moving a building onto land for sale is refused with the same reason", () => {
    const built = addBuilding(land(), catalog, { x: 20, y: 50, w: 40, d: 30 });
    const id = built.select?.[0] as string;
    expect(() => moveTo(built.blueprint, catalog, SITE, id, 200, 50)).toThrow(/아직 사지 않은 땅/);
    expect(() => moveTo(built.blueprint, catalog, SITE, id, 60, 50)).not.toThrow();
  });

  test("a site without parcels or an outline is all the owner's, as before", () => {
    const bp = emptyWorld("w", "빈 땅", { w: 200, d: 150 });
    expect(() => addBuilding(bp, catalog, { x: 10, y: 10, w: 40, d: 30 })).not.toThrow();
  });

  test("buildings take a purpose into their name and props; rooms too", () => {
    let bp = land();
    const fab = addBuilding(bp, catalog, { x: 10, y: 10, w: 40, d: 30 }, "fab");
    bp = fab.blueprint;
    bp = addBuilding(bp, catalog, { x: 60, y: 10, w: 40, d: 30 }, "fab").blueprint;
    const index = new BlueprintIndex(bp);
    const buildings = index.ofKind("building");
    expect(buildings.map((b) => b.name)).toEqual(["반도체 팹 1", "반도체 팹 2"]);
    expect(buildings[0]?.props.purpose).toBe("fab");
    const floor = index.ofKind("floor")[0] as Entity;
    const hall = addRoom(bp, catalog, floor.id, { x: 1.2, y: 1.2, w: 12, d: 9 });
    const network = addRoom(
      hall.blueprint,
      catalog,
      floor.id,
      { x: 15, y: 1.2, w: 9, d: 9 },
      "network",
    );
    const rooms = new BlueprintIndex(network.blueprint).ofKind("room");
    expect(rooms.map((r) => r.name)).toEqual(["서버룸 A", "통신실 A"]);
    expect(rooms[0]?.props.purpose).toBeUndefined();
    expect(rooms[1]?.props.purpose).toBe("network");
    expect(addFloor(bp, buildings[0]?.id as string).blueprint).toBeDefined();
  });

  test("plant stands on owned land beside the buildings, and says why when it cannot", () => {
    let bp = land();
    bp = addBuilding(bp, catalog, { x: 20, y: 50, w: 40, d: 30 }).blueprint;
    const spot = (x: number, y: number) => ({ x, y, rotation: 0 as const });
    const placed = placePlant(bp, catalog, "sy-transformer-2500kva", spot(80, 50));
    const names = new BlueprintIndex(placed.blueprint).ofKind("power_panel").map((e) => e.name);
    expect(names).toEqual(["변압기 1"]);
    const gen = placePlant(placed.blueprint, catalog, "tg-diesel-2mw", spot(80, 80));
    expect(new BlueprintIndex(gen.blueprint).ofKind("generator")).toHaveLength(1);
    expect(() => placePlant(bp, catalog, "tg-diesel-2mw", spot(30, 60))).toThrow(/겹쳐요/);
    expect(() => placePlant(bp, catalog, "tg-diesel-2mw", spot(200, 60))).toThrow(
      /아직 사지 않은 땅/,
    );
    expect(() => placePlant(bp, catalog, "crah-100kw", spot(80, 50))).toThrow(
      /건물 밖에 세우는 설비가 아니에요/,
    );
  });

  test("pointing at land for sale with the buy tool says what it is and costs, and clicking buys it", () => {
    const bp = land();
    const where = { bp, index: new BlueprintIndex(bp), catalog, level: SITE };
    const over = planFor(where, { kind: "buy" }, 0, { x: 200, y: 100 });
    expect(over?.label).toBe("동쪽 확장 부지 1 30,000㎡, 360억 원. 누르면 사요");
    expect(over?.edit).toBeDefined();
    const mine = planFor(where, { kind: "buy" }, 0, { x: 50, y: 100 });
    expect(mine?.problem).toMatch(/팔고 있는 땅이 아니에요/);
    const bought = buyParcel(bp, "p-sale").blueprint;
    expect(
      planFor({ ...where, bp: bought, index: new BlueprintIndex(bought) }, { kind: "buy" }, 0, {
        x: 200,
        y: 100,
      })?.problem,
    ).toBeDefined();
  });

  test("pointing at land that was bought says it is already yours [REQ-043]", () => {
    const bp = buyParcel(land(), "p-sale").blueprint;
    const where = { bp, index: new BlueprintIndex(bp), catalog, level: SITE };
    const over = planFor(where, { kind: "buy" }, 0, { x: 200, y: 100 });
    expect(over?.problem).toMatch(/이미 내 땅/);
  });

  test("buying and plant belong to the site level only", () => {
    const bp = land();
    const placed = addBuilding(bp, catalog, { x: 20, y: 50, w: 40, d: 30 }).blueprint;
    const floor = new BlueprintIndex(placed).ofKind("floor")[0] as Entity;
    const where = {
      bp: placed,
      index: new BlueprintIndex(placed),
      catalog,
      level: { kind: "floor", id: floor.id } as Level,
    };
    expect(planFor(where, { kind: "buy" }, 0, { x: 5, y: 5 })).toBeUndefined();
    expect(
      planFor(where, { kind: "plant", modelId: "tg-diesel-1mw" }, 0, { x: 5, y: 5 }),
    ).toBeUndefined();
  });
});
