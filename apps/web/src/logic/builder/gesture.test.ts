import { Catalog } from "@terrarium/core/catalog";
import { RACK_WIDTH_M } from "@terrarium/core/kernel";
import { type Blueprint, BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import {
  addBuilding,
  addRoom,
  emptyWorld,
  gridOf,
  type Level,
  movePlan,
  nextRotation,
  placeRack,
  planFor,
  pointingHint,
  rectBetween,
  type Tool,
  toolFits,
  type Where,
} from ".";

const catalog = new Catalog();

function site() {
  let bp = emptyWorld("w", "손으로 짓기", { w: 120, d: 80 }, "수원사업장");
  bp = addBuilding(bp, catalog, { x: 10, y: 10, w: 40, d: 30 }).blueprint;
  const floorId = new BlueprintIndex(bp).ofKind("floor")[0]?.id as string;
  bp = addRoom(bp, catalog, floorId, { x: 1.2, y: 1.2, w: 12, d: 9.6 }).blueprint;
  const roomId = new BlueprintIndex(bp).ofKind("room")[0]?.id as string;
  return { bp, floorId, roomId };
}

const where = (bp: Blueprint, level: Level): Where => ({
  bp,
  index: new BlueprintIndex(bp),
  catalog,
  level,
});

describe("pointing and dragging in the builder [REQ-035]", () => {
  test("each level offers only the tools that make sense there", () => {
    const { floorId, roomId } = site();
    const siteLevel: Level = { kind: "site" };
    const floor: Level = { kind: "floor", id: floorId };
    const room: Level = { kind: "room", id: roomId };
    expect(toolFits({ kind: "building" }, siteLevel)).toBe(true);
    expect(toolFits({ kind: "building" }, floor)).toBe(false);
    expect(toolFits({ kind: "room" }, floor)).toBe(true);
    expect(toolFits({ kind: "rack" }, floor)).toBe(false);
    expect(toolFits({ kind: "rack" }, room)).toBe(true);
    expect(toolFits({ kind: "containment", aisle: "cold" }, room)).toBe(true);
    expect(toolFits({ kind: "equipment", modelId: "ups-500kva" }, siteLevel)).toBe(false);
    expect(toolFits({ kind: "select" }, siteLevel)).toBe(true);
    expect(gridOf(siteLevel)).toBe(5);
    expect(gridOf(room)).toBe(0.6);
  });

  test("a drag spans the same rectangle whichever way it goes", () => {
    expect(rectBetween({ x: 5, y: 8 }, { x: 1, y: 2 })).toEqual({ x: 1, y: 2, w: 4, d: 6 });
    expect(rectBetween({ x: 1, y: 2 }, { x: 5, y: 8 })).toEqual({ x: 1, y: 2, w: 4, d: 6 });
  });

  test("dragging a building on the site snaps to 5 m and says its size", () => {
    const { bp } = site();
    const plan = planFor(
      where(bp, { kind: "site" }),
      { kind: "building" },
      0,
      { x: 61, y: 9 },
      { x: 89, y: 31 },
    );
    expect(plan?.rect).toEqual({ x: 60, y: 10, w: 30, d: 20 });
    expect(plan?.label).toBe("건물 30 × 20 m");
    expect(plan?.problem).toBeUndefined();
    expect(plan?.edit?.blueprint.entities.filter((e) => e.kind === "building")).toHaveLength(2);
  });

  test("a building over another one is refused with the reason, and nothing changes", () => {
    const { bp } = site();
    const plan = planFor(
      where(bp, { kind: "site" }),
      { kind: "building" },
      0,
      { x: 20, y: 20 },
      { x: 40, y: 30 },
    );
    expect(plan?.problem).toMatch(/겹친다/);
    expect(plan?.edit).toBeUndefined();
  });

  test("pointing with an area tool shows nothing until the drag starts", () => {
    const { bp, floorId } = site();
    expect(
      planFor(where(bp, { kind: "floor", id: floorId }), { kind: "room" }, 0, { x: 20, y: 5 }),
    ).toBeUndefined();
    const room = planFor(
      where(bp, { kind: "floor", id: floorId }),
      { kind: "room" },
      0,
      { x: 20, y: 2 },
      { x: 30, y: 10 },
    );
    expect(room?.label).toMatch(/^서버룸 /);
    expect(room?.edit).toBeDefined();
  });

  test("a containment drag in a room becomes a cold or hot aisle", () => {
    const { bp, roomId } = site();
    const tool: Tool = { kind: "containment", aisle: "hot" };
    const plan = planFor(
      where(bp, { kind: "room", id: roomId }),
      tool,
      0,
      { x: 1, y: 1 },
      { x: 6, y: 3 },
    );
    expect(plan?.label).toMatch(/^열복도 /);
    const made = plan?.edit?.blueprint.entities.find((e) => e.kind === "containment");
    expect(made?.props.aisle).toBe("hot");
  });

  test("pointing with the rack tool shows one rack centred on the pointer", () => {
    const { bp, roomId } = site();
    const plan = planFor(where(bp, { kind: "room", id: roomId }), { kind: "rack" }, 0, {
      x: 3.1,
      y: 3,
    });
    expect(plan?.label).toBe("랙 하나");
    expect(plan?.rect.w).toBeCloseTo(RACK_WIDTH_M);
    expect(plan?.rect.x).toBeLessThan(3.1);
    expect((plan?.rect.x ?? 0) + (plan?.rect.w ?? 0)).toBeGreaterThan(3.1);
  });

  test("dragging the rack tool lays a row, forwards or backwards", () => {
    const { bp, roomId } = site();
    const room: Level = { kind: "room", id: roomId };
    const forward = planFor(
      where(bp, room),
      { kind: "rack" },
      0,
      { x: 2, y: 3 },
      { x: 2 + RACK_WIDTH_M * 4, y: 3.2 },
    );
    expect(forward?.label).toBe("랙 5개를 한 줄로");
    expect(forward?.edit?.select).toHaveLength(5);
    const backward = planFor(
      where(bp, room),
      { kind: "rack" },
      0,
      { x: 8, y: 3 },
      { x: 8 - RACK_WIDTH_M * 2, y: 3 },
    );
    expect(backward?.edit?.select).toHaveLength(3);
    expect(backward?.rect.x).toBeLessThan(8 - RACK_WIDTH_M * 2 + 0.01);
    const turned = planFor(
      where(bp, room),
      { kind: "rack" },
      90,
      { x: 3, y: 1 },
      { x: 3, y: 1 + RACK_WIDTH_M * 2 },
    );
    expect(turned?.edit?.select).toHaveLength(3);
    expect(turned?.rect.d).toBeGreaterThan(turned?.rect.w ?? 0);
  });

  test("a rack row that runs out of the room says which rack does not fit", () => {
    const { bp, roomId } = site();
    const plan = planFor(
      where(bp, { kind: "room", id: roomId }),
      { kind: "rack" },
      0,
      { x: 9, y: 3 },
      { x: 15, y: 3 },
    );
    expect(plan?.problem).toMatch(/번째 랙/);
  });

  test("equipment goes where the pointer is, by its model's footprint", () => {
    const { bp, roomId } = site();
    const tool: Tool = { kind: "equipment", modelId: "crah-100kw" };
    const plan = planFor(where(bp, { kind: "room", id: roomId }), tool, 0, { x: 5, y: 7 });
    const model = catalog.get("crah-100kw");
    expect(plan?.label).toBe(model.name);
    expect(plan?.rect.w).toBe("footprint" in model ? model.footprint.w : 0);
    expect(plan?.edit?.blueprint.entities.some((e) => e.modelId === "crah-100kw")).toBe(true);
    expect(planFor(where(bp, { kind: "site" }), tool, 0, { x: 5, y: 7 })).toBeUndefined();
  });

  test("dragging something built moves it by the drag, snapped, or says why not", () => {
    const { bp, roomId } = site();
    const room: Level = { kind: "room", id: roomId };
    const placed = placeRack(bp, catalog, roomId, { x: 1.2, y: 1.2, rotation: 0 });
    const id = placed.select[0] as string;
    const moved = movePlan(
      where(placed.blueprint, room),
      id,
      { x: 1.5, y: 1.5 },
      { x: 3.9, y: 4.4 },
    );
    expect(moved?.rect.x).toBeCloseTo(3.6);
    expect(moved?.rect.y).toBeCloseTo(4.2);
    expect(moved?.label).toMatch(/옮긴다$/);
    expect(moved?.edit).toBeDefined();
    const out = movePlan(where(placed.blueprint, room), id, { x: 1.5, y: 1.5 }, { x: 40, y: 1.5 });
    expect(out?.problem).toBeDefined();
    expect(
      movePlan(where(placed.blueprint, room), "nothing", { x: 0, y: 0 }, { x: 1, y: 1 }),
    ).toBeUndefined();
  });

  test("buildings move on the 5 m grid", () => {
    const { bp } = site();
    const index = new BlueprintIndex(bp);
    const building = index.ofKind("building")[0]?.id as string;
    const plan = movePlan(
      where(bp, { kind: "site" }),
      building,
      { x: 20, y: 20 },
      { x: 27, y: 21 },
    );
    expect(plan?.rect.x).toBe(15);
    expect(plan?.rect.y).toBe(10);
  });

  test("the hint line says what pointing would do", () => {
    const { bp } = site();
    const index = new BlueprintIndex(bp);
    const building = index.ofKind("building")[0]?.id as string;
    expect(pointingHint({ kind: "select" }, undefined, index)).toMatch(/화면이 움직인다/);
    expect(pointingHint({ kind: "select" }, building, index)).toMatch(/두 번 누르면 들어간다/);
    expect(pointingHint({ kind: "rack" }, undefined, index)).toMatch(/R로 돌린다/);
    for (const tool of [
      { kind: "building" },
      { kind: "room" },
      { kind: "containment", aisle: "cold" },
      { kind: "equipment", modelId: "ups-200kva" },
    ] as const)
      expect(pointingHint(tool, undefined, index).length).toBeGreaterThan(5);
    expect(nextRotation(270)).toBe(0);
    expect(nextRotation(0)).toBe(90);
  });
});
