import { describe, expect, test } from "vitest";
import { bayDecor, EDGE_M, MAX_TOOLS } from "./fab";

describe("the tools of a fab cleanroom [REQ-006] [REQ-043]", () => {
  const bay = bayDecor("hs-fab1-f2-bay", 130, 60);

  test("a bay has rows of tools and a rail down each aisle", () => {
    expect(bay.tools.length).toBeGreaterThan(40);
    expect(bay.rails.length).toBeGreaterThanOrEqual(3);
  });

  test("every tool and rail stands inside the room, clear of the walls", () => {
    for (const t of bay.tools) {
      expect(t.x - t.w / 2).toBeGreaterThanOrEqual(EDGE_M - 1e-6);
      expect(t.x + t.w / 2).toBeLessThanOrEqual(130 - EDGE_M + 1e-6);
      expect(t.z - t.d / 2).toBeGreaterThanOrEqual(0);
      expect(t.z + t.d / 2).toBeLessThanOrEqual(60);
    }
    for (const r of bay.rails) {
      expect(r.x0).toBeGreaterThanOrEqual(EDGE_M);
      expect(r.x1).toBeLessThanOrEqual(130 - EDGE_M);
    }
  });

  test("no two tools overlap, and a tool never blocks an aisle with its rail above", () => {
    const t = bay.tools;
    for (let i = 0; i < t.length; i++)
      for (let j = i + 1; j < t.length; j++) {
        const a = t[i];
        const b = t[j];
        if (!a || !b) continue;
        const apart =
          Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.z - b.z) >= (a.d + b.d) / 2;
        expect(apart).toBe(true);
      }
    for (const r of bay.rails)
      for (const tool of t) expect(Math.abs(tool.z - r.z)).toBeGreaterThan(tool.d / 2);
  });

  test("the same room always looks the same and another room does not", () => {
    expect(bayDecor("hs-fab1-f2-bay", 130, 60)).toEqual(bay);
    expect(bayDecor("hs-fab2-f3-bay", 130, 60)).not.toEqual(bay);
  });

  test("a huge room draws a bounded number of tools, a small one draws none", () => {
    expect(bayDecor("giant", 400, 300).tools.length).toBeLessThanOrEqual(MAX_TOOLS);
    expect(bayDecor("giant", 400, 300).tools.length).toBeGreaterThan(MAX_TOOLS / 2);
    expect(bayDecor("closet", 12, 8)).toEqual({ tools: [], rails: [] });
  });
});
