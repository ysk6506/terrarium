import { describe, expect, test } from "vitest";
import {
  encodeOutline,
  normalizeOutline,
  outlineArea,
  outlineBounds,
  outlineFromLonLat,
  packInOutline,
  parseOutline,
  pointInOutline,
  rectInOutline,
} from ".";

/** An L-shaped site: 400 x 300 with the top-right 200 x 150 cut away. */
const L = [
  { x: 0, y: 0 },
  { x: 200, y: 0 },
  { x: 200, y: 150 },
  { x: 400, y: 150 },
  { x: 400, y: 300 },
  { x: 0, y: 300 },
];

describe("land outlines [REQ-048]", () => {
  test("area, bounds and containment follow the shape, not its bounding box", () => {
    expect(outlineArea(L)).toBe(400 * 300 - 200 * 150);
    expect(outlineBounds(L)).toEqual({ x: 0, y: 0, w: 400, d: 300 });
    expect(pointInOutline({ x: 100, y: 100 }, L)).toBe(true);
    expect(pointInOutline({ x: 300, y: 50 }, L)).toBe(false);
  });

  test("a rectangle across the notch is outside, one in the body is inside", () => {
    expect(rectInOutline({ x: 20, y: 20, w: 100, d: 100 }, L)).toBe(true);
    expect(rectInOutline({ x: 150, y: 100, w: 100, d: 100 }, L)).toBe(false);
    expect(rectInOutline({ x: 250, y: 20, w: 50, d: 50 }, L)).toBe(false);
  });

  test("an outline survives being written into a prop and read back", () => {
    expect(parseOutline(encodeOutline(L))).toEqual(L);
    expect(parseOutline("")).toBeUndefined();
    expect(parseOutline("1,2;3,4")).toBeUndefined();
    expect(parseOutline("a,b;c,d;e,f")).toBeUndefined();
    expect(parseOutline(undefined)).toBeUndefined();
  });

  test("buildings are packed inside the shape without touching, and the result never changes", () => {
    const items = [
      { id: "b1", w: 120, d: 80 },
      { id: "b2", w: 100, d: 100 },
      { id: "b3", w: 60, d: 60 },
      { id: "b4", w: 90, d: 50 },
    ];
    const a = packInOutline(items, L, 20);
    expect(a.unplaced).toEqual([]);
    expect(a.placed).toHaveLength(4);
    for (const p of a.placed) expect(rectInOutline(p, L, 0)).toBe(true);
    for (const p of a.placed)
      for (const q of a.placed)
        if (p.id < q.id)
          expect(
            p.x + p.w + 19 <= q.x ||
              q.x + q.w + 19 <= p.x ||
              p.y + p.d + 19 <= q.y ||
              q.y + q.d + 19 <= p.y,
          ).toBe(true);
    expect(packInOutline([...items].reverse(), L, 20)).toEqual(a);
  });

  test("what cannot fit is reported, not squeezed in", () => {
    const { placed, unplaced } = packInOutline(
      [
        { id: "small", w: 50, d: 50 },
        { id: "huge", w: 390, d: 290 },
      ],
      L,
      20,
    );
    expect(placed.map((p) => p.id)).toEqual(["small"]);
    expect(unplaced).toEqual(["huge"]);
  });

  test("map coordinates become a north-up outline in metres that starts at the origin", () => {
    const ring = [
      [127.0, 37.0],
      [127.01, 37.0],
      [127.01, 37.01],
      [127.0, 37.01],
      [127.0, 37.0],
    ] as const;
    const o = outlineFromLonLat(ring);
    const box = outlineBounds(o);
    expect(o).toHaveLength(4);
    expect(box.x).toBeCloseTo(0);
    expect(box.y).toBeCloseTo(0);
    expect(box.w).toBeGreaterThan(850);
    expect(box.w).toBeLessThan(950);
    expect(box.d).toBeGreaterThan(1050);
    expect(box.d).toBeLessThan(1150);
    // North is up: the first (southern) point has the larger y.
    expect((o[0]?.y ?? 0) > (o[3]?.y ?? 0)).toBe(true);
  });

  test("scaling keeps the shape and starts at the origin", () => {
    const moved = normalizeOutline(
      L.map((p) => ({ x: p.x + 50, y: p.y + 70 })),
      0.5,
    );
    expect(outlineBounds(moved)).toEqual({ x: 0, y: 0, w: 200, d: 150 });
    expect(outlineArea(moved)).toBe(outlineArea(L) / 4);
  });
});
