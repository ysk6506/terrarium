import { Catalog } from "@terrarium/core/catalog";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { addBuilding, addFloor, addRoom, emptyWorld } from "../builder";
import { buildingScene } from "./building";

const catalog = new Catalog();

describe("the bare floor of a storey is in the building's picture [REQ-076]", () => {
  test("each floor of the cut-open building carries the floor no room covers, rooms taken out", () => {
    let bp = emptyWorld("w", "시험", { w: 200, d: 150 }, "사업장");
    bp = addBuilding(bp, catalog, { x: 10, y: 10, w: 40, d: 30 }).blueprint;
    const building = new BlueprintIndex(bp).ofKind("building")[0]?.id as string;
    bp = addFloor(bp, building).blueprint;
    const lower = new BlueprintIndex(bp).ofKind("floor")[0]?.id as string;
    bp = addRoom(bp, catalog, lower, { x: 3, y: 3, w: 12, d: 9 }).blueprint;
    const scene = buildingScene(new BlueprintIndex(bp), catalog, building);
    const area = (floor: number) =>
      (scene?.floors[floor]?.bare ?? []).reduce((n, r) => n + r.w * r.d, 0);
    expect(scene?.floors).toHaveLength(2);
    expect(area(0)).toBeCloseTo(40 * 30 - 12 * 9, 6);
    expect(area(1)).toBeCloseTo(40 * 30, 6);
  });
});
