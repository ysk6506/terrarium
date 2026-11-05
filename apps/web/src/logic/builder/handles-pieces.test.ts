import { Catalog } from "@terrarium/core/catalog";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import {
  addBuilding,
  addPiece,
  addRoom,
  emptyWorld,
  frameOffset,
  handlePlan,
  handleSize,
  handlesFit,
  handlesFor,
  type Level,
  pieceAt,
} from ".";

const catalog = new Catalog();

/** A 12 x 9 m server room at (3, 3) in a 40 x 30 m building, with a 4.8 x 6 m piece on the right of its upper part. */
function world() {
  let bp = emptyWorld("w", "시험", { w: 200, d: 150 }, "사업장");
  bp = addBuilding(bp, catalog, { x: 10, y: 10, w: 40, d: 30 }).blueprint;
  const floorId = new BlueprintIndex(bp).ofKind("floor")[0]?.id as string;
  bp = addRoom(bp, catalog, floorId, { x: 3, y: 3, w: 12, d: 9 }).blueprint;
  const roomId = new BlueprintIndex(bp).ofKind("room")[0]?.id as string;
  bp = addPiece(bp, catalog, roomId, "right", { along: 4.8, out: 6 }).blueprint;
  const level: Level = { kind: "floor", id: floorId };
  return { bp, index: new BlueprintIndex(bp), roomId, floorId, level };
}

describe("handles and pieces of a room [REQ-076]", () => {
  test("the stretch of a side that a piece covers has no handle, the stretch left over has one", () => {
    const { index, level, roomId } = world();
    const handles = handlesFor(index, level, index.entity(roomId));
    const right = handles.find((h) => h.key === "0:right");
    expect(right?.length).toBeCloseTo(4.2, 6);
    expect(right?.offset).toBeCloseTo(4.8, 6);
    expect(handles.some((h) => h.key === "1:left")).toBe(false);
    expect(handles.some((h) => h.key === "1:right")).toBe(true);
  });

  test("the piece under a point is found, the body and the floor around it are not a piece", () => {
    const { index, level, roomId } = world();
    const room = index.entity(roomId);
    expect(pieceAt(index, level, room, { x: 17, y: 5 })).toBe(0);
    expect(pieceAt(index, level, room, { x: 5, y: 5 })).toBeUndefined();
    expect(pieceAt(index, level, room, { x: 30, y: 25 })).toBeUndefined();
  });

  test("a piece pulled out past the wall is refused with the reason, and the plan shows where it would stand", () => {
    const { bp, index, level, roomId } = world();
    const plus = handlesFor(index, level, index.entity(roomId)).find((h) => h.key === "0:bottom+");
    const plan = handlePlan({ bp, index, catalog, level }, plus as never, plus?.at as never, {
      x: (plus?.at.x ?? 0) + 0,
      y: (plus?.at.y ?? 0) + 200,
    });
    expect(plan?.problem).toMatch(/건물이 꽉 찼어요/);
    expect(plan?.edit).toBeUndefined();
    expect(plan?.rect.d).toBeGreaterThan(20);
  });

  test("a handle drawn for a room or a building has a size that grows with the space, and frames start at the body's corner", () => {
    const { index, level, roomId, floorId } = world();
    const room = index.entity(roomId);
    const building = index.entity(index.ofKind("building")[0]?.id as string);
    expect(handleSize(room)).toBeGreaterThanOrEqual(0.6);
    expect(handleSize(building)).toBeGreaterThan(handleSize(room));
    expect(frameOffset(index, level, building)).toEqual({ x: 10, y: 10 });
    expect(frameOffset(index, { kind: "room", id: roomId }, room)).toEqual({ x: 3, y: 3 });
    expect(frameOffset(index, level, room)).toEqual({ x: 0, y: 0 });
    expect(handlesFit(index, { kind: "floor", id: floorId }, room)).toBe(true);
    expect(handlesFit(index, { kind: "site" }, room)).toBe(false);
    expect(handlesFit(index, level, undefined)).toBe(false);
    expect(handlesFit(index, level, index.entity(floorId))).toBe(false);
  });
});
