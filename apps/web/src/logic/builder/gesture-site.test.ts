import { Catalog } from "@terrarium/core/catalog";
import { type Blueprint, BlueprintIndex, type Entity } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { addBuilding, emptyWorld, type Level, movePlan, planFor, type Where } from ".";

const catalog = new Catalog();
const SITE: Level = { kind: "site" };

const parcel = (id: string, name: string, x: number, w: number, owned: boolean): Entity => ({
  id,
  kind: "parcel",
  name,
  parentId: "site-1",
  placement: { type: "area", x, y: 0, w, d: 200 },
  props: owned ? {} : { owned: false, areaM2: w * 200, priceM: w * 200 * 1.2 },
});

/** 300 × 200 m: the left half is the owner's, the right half is for sale. */
function land(): Blueprint {
  const bp = emptyWorld("w", "땅 시험", { w: 300, d: 200 }, "시험사업장");
  return {
    ...bp,
    entities: [
      ...bp.entities,
      parcel("p-own", "본 부지", 0, 150, true),
      parcel("p-sale", "동쪽 부지", 150, 150, false),
    ],
  };
}

const where = (bp: Blueprint, level: Level = SITE): Where => ({
  bp,
  index: new BlueprintIndex(bp),
  catalog,
  level,
});

describe("pointing at land for sale with the buying tool [REQ-043]", () => {
  test("land for sale says what it is and what it costs, and can be bought", () => {
    const plan = planFor(where(land()), { kind: "buy" }, 0, { x: 200, y: 50 });
    expect(plan?.label).toContain("동쪽 부지");
    expect(plan?.label).toContain("누르면 사요");
    expect(plan?.problem).toBeUndefined();
    expect(plan?.edit).toBeDefined();
  });

  test("land that is already the owner's says so; land that is nothing says to look for the stripes", () => {
    const own = planFor(where(land()), { kind: "buy" }, 0, { x: 50, y: 50 });
    expect(own?.problem).toContain("이미 내 땅");
    const nowhere = planFor(where(land()), { kind: "buy" }, 0, { x: 999, y: 999 });
    expect(nowhere?.problem).toContain("줄무늬");
    expect(nowhere?.rect).toEqual({ x: 999, y: 999, w: 0, d: 0 });
  });

  test("a drag with the buying tool uses where it ended", () => {
    const plan = planFor(where(land()), { kind: "buy" }, 0, { x: 10, y: 10 }, { x: 200, y: 50 });
    expect(plan?.label).toContain("동쪽 부지");
  });
});

describe("plant beside the buildings, and moving what stands on the site [REQ-048]", () => {
  test("a plant on owned land can be placed; on land not bought it is refused with a reason", () => {
    const ok = planFor(where(land()), { kind: "plant", modelId: "tg-diesel-1mw" }, 0, {
      x: 60,
      y: 120,
    });
    expect(ok?.problem).toBeUndefined();
    expect(ok?.edit).toBeDefined();
    const refused = planFor(where(land()), { kind: "plant", modelId: "tg-diesel-1mw" }, 0, {
      x: 200,
      y: 120,
    });
    expect(refused?.problem).toBeDefined();
  });

  test("a building moved by the pointer snaps to the site's grid and keeps its size", () => {
    const placed = addBuilding(land(), catalog, { x: 20, y: 50, w: 40, d: 30 }).blueprint;
    const id = new BlueprintIndex(placed).ofKind("building")[0]?.id as string;
    const plan = movePlan(where(placed), id, { x: 30, y: 60 }, { x: 52, y: 63 });
    expect(plan?.rect).toMatchObject({ w: 40, d: 30 });
    expect((plan?.rect.x ?? 0) % 5).toBe(0);
    expect(plan?.label).toContain("옮겼어요");
  });

  test("nothing moves that is not there or has no floor of its own", () => {
    const placed = addBuilding(land(), catalog, { x: 20, y: 50, w: 40, d: 30 }).blueprint;
    expect(movePlan(where(placed), "nope", { x: 0, y: 0 }, { x: 5, y: 5 })).toBeUndefined();
  });
});
