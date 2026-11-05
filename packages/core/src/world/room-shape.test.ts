import { Catalog } from "@terrarium/core/catalog";
import { describe, expect, test } from "vitest";
import {
  BlueprintIndex,
  blueprintDigest,
  type Entity,
  insideRoom,
  insideRoomLocal,
  outlineOf,
  roomArea,
  roomLocalRects,
  roomOutline,
  roomRects,
  shapeProblem,
  structureCostM,
  validateBlueprint,
} from ".";
import { sampleBlueprint, withChanges } from "./test-support/sample";

const catalog = new Catalog();
const withPieces = (pieces?: Array<{ x: number; y: number; w: number; d: number }>): Entity => ({
  id: "hall",
  kind: "room",
  name: "서버룸 A",
  parentId: "fl1",
  placement: { type: "area", x: 5, y: 5, w: 12, d: 10, ...(pieces ? { pieces } : {}) },
  props: {},
});
const areaOf = (poly: ReadonlyArray<{ x: number; y: number }>) => {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as { x: number; y: number };
    const b = poly[(i + 1) % poly.length] as { x: number; y: number };
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
};
const codes = (hall: Entity) =>
  validateBlueprint(withChanges(sampleBlueprint(), { entities: [hall] }), catalog)
    .filter((i) => i.severity === "error")
    .map((i) => i.code);

describe("a room made of pieces [REQ-075]", () => {
  test("without pieces a room is the plain rectangle it always was", () => {
    const hall = withPieces();
    expect(roomRects(hall)).toEqual([{ x: 5, y: 5, w: 12, d: 10 }]);
    expect(roomOutline(hall)).toHaveLength(4);
    expect(areaOf(roomOutline(hall))).toBe(120);
    expect(roomArea(hall)).toBe(120);
    expect(codes(hall)).toEqual([]);
  });

  test("an L-shaped room has a six-corner outline running counter-clockwise, and its area is the sum", () => {
    const hall = withPieces([{ x: 17, y: 5, w: 6, d: 4 }]);
    const outline = roomOutline(hall);
    expect(outline).toHaveLength(6);
    expect(areaOf(outline)).toBeCloseTo(144, 9);
    expect(roomArea(hall)).toBe(144);
    expect(codes(hall)).toEqual([]);
  });

  test("a room with two pieces gives a twelve-corner outline (a cross)", () => {
    const hall = withPieces([
      { x: 17, y: 7, w: 4, d: 4 },
      { x: 1, y: 7, w: 4, d: 4 },
    ]);
    expect(roomOutline(hall)).toHaveLength(12);
    expect(areaOf(roomOutline(hall))).toBeCloseTo(152, 9);
  });

  test("a point is inside the room when it is in any piece, and a rack must fit the union", () => {
    const hall = withPieces([{ x: 17, y: 5, w: 6, d: 4 }]);
    expect(insideRoom(hall, { x: 20, y: 6 })).toBe(true);
    expect(insideRoom(hall, { x: 20, y: 12 })).toBe(false);
    expect(insideRoom(hall, { x: 10, y: 12 })).toBe(true);
    expect(roomLocalRects(hall)[1]).toEqual({ x: 12, y: 0, w: 6, d: 4 });
    // across the seam between body and piece
    expect(insideRoomLocal(hall, { x: 11, y: 1, w: 2, d: 1 })).toBe(true);
    expect(insideRoomLocal(hall, { x: 11, y: 3, w: 2, d: 3 })).toBe(false);
  });

  test("the validator rejects overlaps, detached pieces, corner-only contact and pieces outside the building", () => {
    expect(codes(withPieces([{ x: 15, y: 5, w: 6, d: 4 }]))).toContain("W056");
    expect(codes(withPieces([{ x: 30, y: 5, w: 4, d: 4 }]))).toContain("W056");
    expect(codes(withPieces([{ x: 17, y: 15, w: 4, d: 4 }]))).toContain("W056");
    expect(codes(withPieces([{ x: 55, y: 5, w: 10, d: 4 }]))).toContain("W056");
    expect(
      shapeProblem([
        { x: 0, y: 0, w: 2, d: 2 },
        { x: 2, y: 2, w: 2, d: 2 },
      ]),
    ).toEqual({
      kind: "detached",
      index: 1,
    });
  });

  test("pieces that close round a gap are refused", () => {
    const ring = [
      { x: 0, y: 0, w: 6, d: 2 },
      { x: 0, y: 2, w: 2, d: 2 },
      { x: 4, y: 2, w: 2, d: 2 },
      { x: 0, y: 4, w: 6, d: 2 },
    ];
    expect(shapeProblem(ring)).toEqual({ kind: "hole" });
    expect(outlineOf(ring.slice(0, 3))).toHaveLength(8);
  });

  test("another room cannot stand on a piece, and a rack inside the piece is fine", () => {
    const base = sampleBlueprint();
    const other: Entity = {
      id: "hall-2",
      kind: "room",
      name: "서버룸 B",
      parentId: "fl1",
      placement: { type: "area", x: 18, y: 6, w: 3, d: 3 },
      props: {},
    };
    const hall = withPieces([{ x: 17, y: 5, w: 6, d: 4 }]);
    const clash = validateBlueprint(withChanges(base, { entities: [hall, other] }), catalog);
    expect(clash.some((i) => i.code === "W008")).toBe(true);
    const rack: Entity = {
      id: "rack-p",
      kind: "rack",
      name: "랙 P",
      parentId: "hall",
      placement: { type: "spot", x: 13, y: 0.6, rotation: 0 },
      props: {},
    };
    const fine = validateBlueprint(withChanges(base, { entities: [hall, rack] }), catalog);
    expect(fine.filter((i) => i.severity === "error")).toEqual([]);
    const outside = { ...rack, placement: { type: "spot", x: 13, y: 6, rotation: 0 } } as Entity;
    const bad = validateBlueprint(withChanges(base, { entities: [hall, outside] }), catalog);
    expect(bad.some((i) => i.code === "W007")).toBe(true);
  });

  test("the fit-out cost counts every piece, and a room without pieces keeps its blueprint digest", () => {
    const base = sampleBlueprint();
    const plain = new BlueprintIndex(base);
    const hall = plain.entity("hall");
    const grown = withPieces([{ x: 17, y: 5, w: 6, d: 4 }]);
    const cost = (e: Entity) =>
      structureCostM(new BlueprintIndex(withChanges(base, { entities: [e] })), catalog, e);
    expect(cost(grown)).toBeCloseTo((cost(hall) / 120) * 144, 9);
    const same = withChanges(base, { entities: [{ ...hall }] });
    expect(blueprintDigest(same)).toBe(blueprintDigest(base));
  });
});
