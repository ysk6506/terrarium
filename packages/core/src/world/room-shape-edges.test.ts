import { describe, expect, test } from "vitest";
import type { Entity } from "./blueprint";
import {
  coveredBy,
  insideRoom,
  insideRoomLocal,
  outlineOf,
  roomArea,
  roomBounds,
  roomLocalRects,
  roomOutline,
  roomRects,
  shapeProblem,
} from "./room-shape";

type Placed = Pick<Entity, "placement">;

const area = (
  x: number,
  y: number,
  w: number,
  d: number,
  pieces?: Array<{ x: number; y: number; w: number; d: number }>,
): Placed => ({
  placement: { type: "area", x, y, w, d, ...(pieces ? { pieces } : {}) },
});
const nowhere: Placed = {};
const onALevel: Placed = { placement: { type: "level", level: 1, height: 4 } };

describe("a room's shape when it is only a rectangle, or not a room at all [REQ-075]", () => {
  test("something with no area has no rectangles, no floor, no outline", () => {
    for (const thing of [nowhere, onALevel]) {
      expect(roomRects(thing)).toEqual([]);
      expect(roomLocalRects(thing)).toEqual([]);
      expect(roomArea(thing)).toBe(0);
      expect(roomOutline(thing)).toEqual([]);
      expect(insideRoom(thing, { x: 1, y: 1 })).toBe(false);
    }
    expect(roomBounds([])).toBeUndefined();
    expect(outlineOf([])).toEqual([]);
  });

  test("a plain rectangle gives itself, in its own frame from the corner", () => {
    const room = area(10, 20, 6, 4);
    expect(roomRects(room)).toEqual([{ x: 10, y: 20, w: 6, d: 4 }]);
    expect(roomLocalRects(room)).toEqual([{ x: 0, y: 0, w: 6, d: 4 }]);
    expect(roomArea(room)).toBe(24);
    expect(roomOutline(room)).toHaveLength(4);
    expect(insideRoomLocal(room, { x: 1, y: 1, w: 2, d: 2 })).toBe(true);
    expect(insideRoomLocal(room, { x: 5, y: 1, w: 2, d: 2 })).toBe(false);
  });

  test("pieces add floor and the local frame keeps the body's corner as the origin", () => {
    const room = area(10, 20, 6, 4, [{ x: 16, y: 20, w: 2, d: 4 }]);
    expect(roomArea(room)).toBe(32);
    expect(roomLocalRects(room)[1]).toEqual({ x: 6, y: 0, w: 2, d: 4 });
    expect(roomBounds(roomRects(room))).toEqual({ x: 10, y: 20, w: 8, d: 4 });
    expect(insideRoom(room, { x: 17, y: 22 })).toBe(true);
    expect(insideRoomLocal(room, { x: 5, y: 1, w: 2, d: 2 })).toBe(true);
  });
});

describe("a rectangle across the seam between two pieces is inside; one across a gap is not [REQ-075]", () => {
  const pair = [
    { x: 0, y: 0, w: 4, d: 4 },
    { x: 4, y: 0, w: 4, d: 4 },
  ];
  const apart = [
    { x: 0, y: 0, w: 4, d: 4 },
    { x: 5, y: 0, w: 4, d: 4 },
  ];

  test("covered whole, covered by a union, and not covered", () => {
    expect(coveredBy(pair, { x: 1, y: 1, w: 2, d: 2 })).toBe(true);
    expect(coveredBy(pair, { x: 3, y: 1, w: 2, d: 2 })).toBe(true);
    expect(coveredBy(apart, { x: 3, y: 1, w: 3, d: 2 })).toBe(false);
    expect(coveredBy([], { x: 0, y: 0, w: 1, d: 1 })).toBe(false);
  });

  test("what is wrong with a shape: nothing, no size, overlap, detached, a hole", () => {
    expect(shapeProblem(pair)).toBeUndefined();
    expect(shapeProblem([pair[0] as never, { x: 4, y: 0, w: 0, d: 4 }])).toEqual({
      kind: "empty",
      index: 1,
    });
    expect(shapeProblem([pair[0] as never, { x: 2, y: 0, w: 4, d: 4 }])).toEqual({
      kind: "overlap",
      index: 1,
    });
    expect(shapeProblem(apart)).toEqual({ kind: "detached", index: 1 });
    const ring = [
      { x: 0, y: 0, w: 3, d: 1 },
      { x: 2, y: 1, w: 1, d: 2 },
      { x: 0, y: 3, w: 3, d: 1 },
      { x: 0, y: 1, w: 1, d: 2 },
    ];
    expect(shapeProblem(ring)).toEqual({ kind: "hole" });
  });
});
