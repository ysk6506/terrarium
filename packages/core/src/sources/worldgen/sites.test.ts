import { outlineArea, outlineBounds } from "@terrarium/core/spatial";
import { describe, expect, test } from "vitest";
import { SITE_PRESETS, sitePreset } from ".";

const cross = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
) => {
  const side = (p: typeof a, q: typeof a, r: typeof a) =>
    Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b);
};

describe("the six sites have shapes with the right proportions [REQ-048]", () => {
  test("each site is a simple polygon that starts at the origin and fits its box", () => {
    for (const p of SITE_PRESETS) {
      const o = p.outline;
      expect(o.length).toBeGreaterThanOrEqual(6);
      const box = outlineBounds(o);
      expect([box.x, box.y]).toEqual([0, 0]);
      expect(p.land.w).toBeGreaterThanOrEqual(box.w);
      expect(p.land.d).toBeGreaterThanOrEqual(box.d);
      let crossings = 0;
      for (let i = 0; i < o.length; i++)
        for (let j = i + 2; j < o.length; j++) {
          if (i === 0 && j === o.length - 1) continue;
          const at = (k: number) => o[k % o.length] as (typeof o)[number];
          if (cross(at(i), at(i + 1), at(j), at(j + 1))) crossings++;
        }
      expect(crossings, p.name).toBe(0);
    }
  });

  test("areas keep their order: Pyeongtaek is the largest, Onyang the smallest", () => {
    const area = (id: string) => outlineArea(sitePreset(id)?.outline ?? []);
    const ranked = [...SITE_PRESETS].sort((a, b) => area(b.id) - area(a.id)).map((p) => p.id);
    expect(ranked[0]).toBe("pyeongtaek");
    expect(ranked.at(-1)).toBe("onyang");
    expect(area("pyeongtaek") / area("onyang")).toBeGreaterThan(4);
    expect(area("pyeongtaek") / area("onyang")).toBeLessThan(8);
  });

  test("on the notional map the sites lie in the right directions from one another", () => {
    const at = (id: string) => sitePreset(id)?.map ?? { x: -1, y: -1 };
    expect(at("suwon").y).toBeLessThan(at("giheung").y);
    expect(at("giheung").y).toBeLessThan(at("hwaseong").y);
    expect(at("hwaseong").y).toBeLessThan(at("pyeongtaek").y);
    expect(at("pyeongtaek").y).toBeLessThan(at("cheonan").y);
    expect(at("cheonan").y).toBeLessThan(at("onyang").y);
    for (const p of SITE_PRESETS) {
      expect(p.map.x).toBeGreaterThanOrEqual(0);
      expect(p.map.x).toBeLessThanOrEqual(100);
      expect(p.map.y).toBeGreaterThanOrEqual(0);
      expect(p.map.y).toBeLessThanOrEqual(100);
    }
  });
});
