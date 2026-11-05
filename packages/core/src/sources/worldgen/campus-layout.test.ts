import {
  outlineBounds,
  parseOutline,
  pointInOutline,
  rectInOutline,
} from "@terrarium/core/spatial";
import { describe, expect, test } from "vitest";
import {
  type CampusSpec,
  DEFAULT_CAMPUS,
  generateCampus,
  SITE_CAMPUS_MIX,
  SITE_PRESETS,
  sitePreset,
} from ".";

const spec = (site: CampusSpec["site"], extra: Partial<CampusSpec> = {}): CampusSpec => ({
  ...DEFAULT_CAMPUS,
  ...SITE_CAMPUS_MIX[site],
  site,
  seed: 3,
  ...extra,
});

function layoutOf(s: CampusSpec) {
  const { blueprint } = generateCampus(s);
  const site = blueprint.entities.find((e) => e.kind === "site");
  const outline = parseOutline(site?.props.outline) ?? [];
  const buildings = blueprint.entities.flatMap((e) =>
    e.kind === "building" && e.placement?.type === "area"
      ? [{ id: e.id, ...e.placement, purpose: String(e.props.purpose) }]
      : [],
  );
  return { blueprint, outline, buildings };
}

describe("campuses stand on the land as the maps show it [REQ-048] [REQ-043]", () => {
  test("no building is pressed against the edge of the land: every one stands well inside its shape", () => {
    for (const p of SITE_PRESETS) {
      const { outline, buildings } = layoutOf(spec(p.id));
      for (const b of buildings) {
        const apron = { x: b.x - 20, y: b.y - 20, w: b.w + 40, d: b.d + 40 };
        expect(rectInOutline(apron, outline), `${p.id} ${b.id}`).toBe(true);
      }
    }
  });

  test("fabs stand where the map shows blue roofs, as big as the roofs, and the HPC centre in the south of Hwaseong", () => {
    const hs = sitePreset("hwaseong");
    const { buildings, outline } = layoutOf(spec("hwaseong"));
    const fab = buildings.find((b) => b.id === "hs-fab1");
    const slot = hs?.fabs[0];
    expect(fab && slot).toBeTruthy();
    if (!fab || !slot) return;
    expect(Math.abs(fab.x + fab.w / 2 - slot.x)).toBeLessThan(3);
    expect(Math.abs(fab.y + fab.d / 2 - slot.y)).toBeLessThan(3);
    expect(fab.w).toBeGreaterThan(slot.w * 0.8);
    expect(fab.w).toBeLessThan(slot.w * 1.2);
    const depth = outlineBounds(outline).d;
    for (const dc of buildings.filter((b) => b.purpose === "data_center"))
      expect(dc.y + dc.d / 2).toBeGreaterThan(depth * 0.8);
  });

  test("a fab with no place on a map is spread over the free ground, not put on top of the others", () => {
    const { buildings } = layoutOf(spec("pyeongtaek", { fabs: 7 }));
    expect(buildings.filter((b) => b.purpose === "fab")).toHaveLength(7);
    for (const [i, a] of buildings.entries())
      for (const b of buildings.slice(i + 1))
        expect(
          a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.d <= b.y || b.y + b.d <= a.y,
          `${a.id} ${b.id}`,
        ).toBe(true);
  });

  test("the plant of a building stands beside it on the land, not under it and out past the fence", () => {
    for (const id of ["giheung", "hwaseong", "pyeongtaek"] as const) {
      const { blueprint, outline } = layoutOf(spec(id, { podsPerHall: 30, detail: 0.1 }));
      const yard = blueprint.entities.filter(
        (e) => e.parentId === sitePreset(id)?.code && e.placement?.type === "spot",
      );
      expect(yard.length).toBeGreaterThan(20);
      const outside = yard.filter(
        (e) =>
          e.placement?.type === "spot" &&
          !pointInOutline({ x: e.placement.x, y: e.placement.y }, outline),
      );
      expect(outside.length, id).toBe(0);
    }
  });
});
