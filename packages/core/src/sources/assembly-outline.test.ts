import { Catalog } from "@terrarium/core/catalog";
import { parseOutline, rectInOutline } from "@terrarium/core/spatial";
import { describe, expect, test } from "vitest";
import { BlueprintAssembler } from ".";

const catalog = new Catalog();

/** An L-shaped site, 400 x 300 m, with the top-right quarter cut away. */
const L = [
  { x: 0, y: 0 },
  { x: 200, y: 0 },
  { x: 200, y: 150 },
  { x: 400, y: 150 },
  { x: 400, y: 300 },
  { x: 0, y: 300 },
];

function site(buildings: number, size = { w: 40, d: 30 }) {
  const asm = new BlueprintAssembler("w", "w", catalog);
  asm.site("s", "시험 사업장", { w: 400, d: 300 }, {}, true, L);
  for (let i = 1; i <= buildings; i++) {
    asm.building(`b${i}`, "s", `B${i}`).floor(`b${i}-f1`, `b${i}`, "1F", 1);
    asm.room(`b${i}-f1`, {
      id: `b${i}-r`,
      name: "방",
      racks: [],
      devices: [],
      equipment: [],
      size,
      purpose: "electrical",
    });
  }
  return asm.build();
}

describe("buildings are placed inside the shape of the land [REQ-048]", () => {
  test("every building stands inside the outline, which the site entity keeps", () => {
    const { blueprint, issues, notes } = site(5);
    const s = blueprint.entities.find((e) => e.kind === "site");
    const outline = parseOutline(s?.props.outline);
    expect(outline).toEqual(L);
    for (const b of blueprint.entities.filter((e) => e.kind === "building")) {
      const p = b.placement;
      if (p?.type !== "area") throw new Error("no area");
      expect(rectInOutline({ x: p.x, y: p.y, w: p.w, d: p.d }, L)).toBe(true);
    }
    expect(notes).toEqual([]);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  test("land inside the shape needs no parcel; land beside it is offered for sale", () => {
    const { blueprint } = site(2);
    const parcels = blueprint.entities.filter((e) => e.kind === "parcel");
    expect(parcels.length).toBeGreaterThan(0);
    expect(parcels.every((p) => p.props.owned === false)).toBe(true);
    const land = blueprint.entities.find((e) => e.kind === "site")?.placement;
    expect(land?.type === "land" && land.w > 400 && land.d > 300).toBe(true);
  });

  test("buildings that do not fit are reported and flagged, not hidden", () => {
    const { notes, issues } = site(8, { w: 120, d: 90 });
    expect(notes.some((n) => n.includes("들어가지 않아"))).toBe(true);
    expect(issues.filter((i) => i.code === "W041").length).toBeGreaterThan(0);
  });

  test("a building moved out of the shape is an error until the land beside it is bought", () => {
    const { blueprint } = site(1);
    const moved = {
      ...blueprint,
      entities: blueprint.entities.map((e) =>
        e.id === "b1" && e.placement?.type === "area"
          ? { ...e, placement: { ...e.placement, x: 300, y: 20 } }
          : e,
      ),
    };
    const bad = validate(moved);
    expect(bad.some((i) => i.code === "W041")).toBe(true);
  });
});

import { validateBlueprint } from "@terrarium/core/world";

const validate = (bp: Parameters<typeof validateBlueprint>[0]) => validateBlueprint(bp, catalog);
