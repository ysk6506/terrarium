import { outlineArea, outlineBounds, rectInOutline } from "@terrarium/core/spatial";
import { describe, expect, test } from "vitest";
import { SITE_PRESETS, sitePreset } from ".";

describe("the sites drawn from the owner's maps have their fabs where the blue roofs are [REQ-048] [REQ-043]", () => {
  const traced = ["giheung", "hwaseong", "pyeongtaek"] as const;
  const rectOf = (s: { x: number; y: number; w: number; d: number }) => ({
    x: s.x - s.w / 2,
    y: s.y - s.d / 2,
    w: s.w,
    d: s.d,
  });

  test("the traced outlines keep the proportions of the maps: Pyeongtaek twice the land of Hwaseong, Giheung the smallest of the three", () => {
    const km2 = (id: string) => outlineArea(sitePreset(id)?.outline ?? []) / 1e6;
    expect(km2("giheung")).toBeGreaterThan(1.1);
    expect(km2("giheung")).toBeLessThan(1.5);
    expect(km2("hwaseong")).toBeGreaterThan(1.4);
    expect(km2("hwaseong")).toBeLessThan(1.9);
    expect(km2("pyeongtaek") / km2("hwaseong")).toBeGreaterThan(2);
    expect(km2("pyeongtaek") / km2("hwaseong")).toBeLessThan(2.8);
  });

  test("every fab and data-centre place lies inside its site, and no two of them overlap", () => {
    for (const id of traced) {
      const preset = sitePreset(id);
      const slots = [
        ...(preset?.fabs ?? []),
        ...(preset?.dcs ?? []),
        ...(preset?.labs ?? []),
        ...(preset?.places ?? []),
      ];
      expect(slots.length, id).toBeGreaterThanOrEqual(3);
      for (const slot of slots)
        expect(
          rectInOutline(rectOf(slot), preset?.outline ?? []),
          `${id} ${slot.x},${slot.y}`,
        ).toBe(true);
      for (const [i, a] of slots.entries())
        for (const b of slots.slice(i + 1)) {
          const ra = rectOf(a);
          const rb = rectOf(b);
          const apart =
            ra.x + ra.w <= rb.x ||
            rb.x + rb.w <= ra.x ||
            ra.y + ra.d <= rb.y ||
            rb.y + rb.d <= ra.y;
          expect(apart, `${id} ${a.x},${a.y} and ${b.x},${b.y}`).toBe(true);
        }
    }
  });

  test("the sites with a map have as many fabs as the blue roofs counted on it; the HPC centre is at Hwaseong's south tip", () => {
    expect(sitePreset("giheung")?.fabs).toHaveLength(3);
    expect(sitePreset("hwaseong")?.fabs).toHaveLength(7);
    expect(sitePreset("pyeongtaek")?.fabs).toHaveLength(6);
    const hs = sitePreset("hwaseong");
    const depth = hs ? outlineBounds(hs.outline).d : 0;
    expect(hs?.dcs).toHaveLength(1);
    for (const dc of hs?.dcs ?? []) expect(dc.y).toBeGreaterThan(depth * 0.85);
    expect(hs?.labs).toHaveLength(3);
  });

  test("sites without a map to read have no fixed places: their buildings are spread over the land", () => {
    for (const id of ["suwon", "cheonan", "onyang"] as const) {
      expect(sitePreset(id)?.fabs).toEqual([]);
      expect(sitePreset(id)?.dcs).toEqual([]);
      expect(sitePreset(id)?.labs).toEqual([]);
    }
  });

  test("every place for a building has a size, and only the three mapped sites have fab places", () => {
    const mapped = SITE_PRESETS.filter((p) => (p.fabs ?? []).length > 0);
    expect(mapped.map((p) => p.id).sort()).toEqual(["giheung", "hwaseong", "pyeongtaek"]);
    for (const preset of mapped)
      for (const slot of [...(preset.fabs ?? []), ...(preset.dcs ?? []), ...(preset.labs ?? [])]) {
        expect(slot.w).toBeGreaterThan(0);
        expect(slot.d).toBeGreaterThan(0);
      }
  });
});
