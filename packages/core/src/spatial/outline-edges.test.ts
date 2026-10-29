import { describe, expect, test } from "vitest";
import { outlineBounds, outlineFromLonLat, packInOutline, rectInOutline } from ".";

describe("land outlines at the edges [REQ-048]", () => {
  test("a narrow slit between sample points is still found by the corner at its tip", () => {
    // A 100 x 100 square with a hair-thin slit from the top edge down to y = 40.
    const slit = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 50.4, y: 100 },
      { x: 50.5, y: 40 },
      { x: 50.6, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(rectInOutline({ x: 10, y: 10, w: 30, d: 30 }, slit)).toBe(true);
    // The sample grid (every ~9 m) steps over the slit, but its tip lies inside this rectangle.
    expect(rectInOutline({ x: 10, y: 10, w: 80, d: 80 }, slit)).toBe(false);
  });

  test("a ring that is not closed is used as it is, and a closed one loses its repeated corner", () => {
    const open = [
      [127.0, 37.0],
      [127.01, 37.0],
      [127.01, 37.01],
    ] as const;
    expect(outlineFromLonLat(open)).toHaveLength(3);
    const four = [...open, [127.0, 37.01]] as const;
    expect(outlineFromLonLat(four)).toHaveLength(4);
    expect(outlineFromLonLat([...four, four[0]])).toHaveLength(4);
    const box = outlineBounds(outlineFromLonLat(four));
    expect(box.x).toBeCloseTo(0);
    expect(box.y).toBeCloseTo(0);
  });

  test("buildings of the same size are placed in id order, whatever order they come in", () => {
    const land = [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 100 },
      { x: 0, y: 100 },
    ];
    const same = (id: string) => ({ id, w: 60, d: 40 });
    const forward = packInOutline([same("a"), same("b"), same("c")], land, 10);
    const backward = packInOutline([same("c"), same("b"), same("a")], land, 10);
    expect(forward).toEqual(backward);
    expect(forward.unplaced).toEqual([]);
    const xs = forward.placed.map((p) => p.x);
    expect(xs).toEqual([...xs].sort((p, q) => p - q));
  });
});
