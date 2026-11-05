import { Catalog } from "@terrarium/core/catalog";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { addBuilding, addRoom, emptyWorld, planFor } from "./builder";
import { meanText } from "./format";

describe("how results read on screen [REQ-037]", () => {
  test("an interval of zero is not printed: a plus-minus of nothing says nothing", () => {
    expect(meanText({ mean: 100, ci95: 0, n: 4 }, "점")).toBe("100.0점");
    expect(meanText({ mean: 76, ci95: 3.2, n: 4 }, "점")).toBe("76.0점 ± 3.2");
  });
});

describe("what the pointer says when a rack will not fit [REQ-035]", () => {
  test("it says the spot is outside the room, in the pointer's own words", () => {
    const catalog = new Catalog();
    let bp = emptyWorld("w", "손으로 짓기", { w: 120, d: 80 }, "수원사업장");
    bp = addBuilding(bp, catalog, { x: 10, y: 10, w: 40, d: 30 }).blueprint;
    const floorId = new BlueprintIndex(bp).ofKind("floor")[0]?.id as string;
    bp = addRoom(bp, catalog, floorId, { x: 1.2, y: 1.2, w: 12, d: 9.6 }).blueprint;
    const roomId = new BlueprintIndex(bp).ofKind("room")[0]?.id as string;
    const where = {
      bp,
      index: new BlueprintIndex(bp),
      catalog,
      level: { kind: "room", id: roomId } as const,
    };
    const plan = planFor(where, { kind: "rack" }, 0, { x: 40, y: 40 });
    expect(plan?.problem).toBe("여기는 놓을 수 있는 공간 밖이에요");
  });
});
