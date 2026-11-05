import { Catalog } from "@terrarium/core/catalog";
import type { Entity } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { BlueprintAssembler } from ".";

const catalog = new Catalog();

const L = [
  { x: 0, y: 0 },
  { x: 200, y: 0 },
  { x: 200, y: 150 },
  { x: 400, y: 150 },
  { x: 400, y: 300 },
  { x: 0, y: 300 },
];

function campus(outline: typeof L, buildings: number, size = { w: 40, d: 30 }) {
  const asm = new BlueprintAssembler("w", "w", catalog);
  asm.site("s", "시험 사업장", { w: 400, d: 300 }, {}, true, outline);
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
  asm.yardItem(
    "s",
    "발전기 마당",
    { id: "beside", kind: "generator", name: "옆 발전기", modelId: "tg-diesel-2mw" },
    "b1",
  );
  asm.yardItem("s", "공용 마당", {
    id: "common",
    kind: "generator",
    name: "공용 발전기",
    modelId: "tg-diesel-2mw",
  });
  return asm.build();
}

const rect = (e: Entity | undefined) => {
  const p = e?.placement;
  if (p?.type !== "area" && p?.type !== "spot") throw new Error(`no place for ${e?.id}`);
  return { x: p.x, y: p.y, w: p.type === "area" ? p.w : 2, d: p.type === "area" ? p.d : 2 };
};

describe("plant that belongs to no building stands in a common yard on the land [REQ-048] [REQ-043]", () => {
  test("it stands inside the land, clear of every building", () => {
    const { blueprint, issues } = campus(L, 3);
    const things = blueprint.entities;
    const common = rect(things.find((e) => e.id === "common"));
    expect(common.x).toBeGreaterThanOrEqual(0);
    expect(common.y).toBeGreaterThanOrEqual(0);
    for (const b of things.filter((e) => e.kind === "building")) {
      const r = rect(b);
      const apart =
        common.x + common.w <= r.x ||
        r.x + r.w <= common.x ||
        common.y + common.d <= r.y ||
        r.y + r.d <= common.y;
      expect(apart, `${b.id}`).toBe(true);
    }
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  test("when the shape has no room for it, it is stacked below the land rather than lost", () => {
    const small = [
      { x: 0, y: 0 },
      { x: 90, y: 0 },
      { x: 90, y: 60 },
      { x: 0, y: 60 },
    ];
    const { blueprint } = campus(small, 1, { w: 60, d: 40 });
    const common = rect(blueprint.entities.find((e) => e.id === "common"));
    expect(Number.isFinite(common.x) && Number.isFinite(common.y)).toBe(true);
  });
});
