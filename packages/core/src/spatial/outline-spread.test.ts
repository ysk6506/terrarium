import { describe, expect, test } from "vitest";
import { packSpread } from ".";

describe("buildings spread over the land, not against its edge [REQ-048]", () => {
  const land = [
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { x: 1000, y: 800 },
    { x: 0, y: 800 },
  ];
  const item = (id: string, w = 120, d = 80) => ({ id, w, d });
  const edgeGap = (p: { x: number; y: number; w: number; d: number }) =>
    Math.min(p.x, p.y, 1000 - (p.x + p.w), 800 - (p.y + p.d));

  test("every building keeps its distance from the edge and from the others", () => {
    const { placed, unplaced } = packSpread(
      ["a", "b", "c", "d", "e"].map((id) => item(id)),
      land,
      { gap: 50, setback: 40 },
    );
    expect(unplaced).toEqual([]);
    for (const p of placed) expect(edgeGap(p)).toBeGreaterThanOrEqual(40);
    for (const [i, a] of placed.entries())
      for (const b of placed.slice(i + 1))
        expect(
          a.x + a.w + 50 <= b.x + 1e-6 ||
            b.x + b.w + 50 <= a.x + 1e-6 ||
            a.y + a.d + 50 <= b.y + 1e-6 ||
            b.y + b.d + 50 <= a.y + 1e-6,
        ).toBe(true);
  });

  test("they gather round the middle of the land instead of starting in a corner", () => {
    const { placed } = packSpread([item("a"), item("b"), item("c")], land, {
      gap: 50,
      setback: 40,
    });
    const cx = placed.reduce((s, p) => s + p.x + p.w / 2, 0) / placed.length;
    const cy = placed.reduce((s, p) => s + p.y + p.d / 2, 0) / placed.length;
    expect(Math.abs(cx - 500)).toBeLessThan(150);
    expect(Math.abs(cy - 400)).toBeLessThan(150);
  });

  test("a building with a place it wants goes to the nearest free ground, or stays out when that is too far", () => {
    const near = { x: 900, y: 700 };
    const { placed } = packSpread([{ ...item("a"), near }], land, { gap: 50, setback: 40 });
    expect(placed[0]?.x).toBeGreaterThan(700);
    expect(placed[0]?.y).toBeGreaterThan(550);
    const taken = [{ x: 700, y: 500, w: 260, d: 260 }];
    const blocked = packSpread([{ ...item("b"), near }], land, {
      gap: 50,
      setback: 40,
      taken,
      reach: 60,
    });
    expect(blocked.unplaced).toEqual(["b"]);
  });

  test("rectangles that already stand are kept clear of, and the same input gives the same result", () => {
    const taken = [{ x: 380, y: 300, w: 240, d: 200 }];
    const run = () => packSpread([item("a"), item("b")], land, { gap: 50, setback: 40, taken });
    const first = run();
    expect(first).toEqual(run());
    for (const p of first.placed)
      expect(
        p.x + p.w + 25 <= 380 || p.x >= 620 + 25 || p.y + p.d + 25 <= 300 || p.y >= 500 + 25,
      ).toBe(true);
  });
});
