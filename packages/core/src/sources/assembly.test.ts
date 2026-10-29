import { Catalog } from "@terrarium/core/catalog";
import type { LocationHint } from "@terrarium/core/spatial";
import { BlueprintIndex, footprint, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { BlueprintAssembler, type RoomSpec } from ".";

const catalog = new Catalog();
const hint = (extra: Partial<LocationHint> = {}): LocationHint => ({
  floorInfo: {},
  unitSpan: 1,
  ...extra,
});

function room(id: string, extra: Partial<RoomSpec> = {}): RoomSpec {
  return {
    id,
    name: `${id} 서버룸`,
    racks: [
      { id: `${id}-r1`, name: "R1", hint: hint({ row: 1, column: 1 }) },
      { id: `${id}-r2`, name: "R2", hint: hint({ row: 2, column: 1 }) },
    ],
    devices: [
      {
        id: `${id}-s1`,
        kind: "server",
        name: "s1",
        modelId: "srv-2u-compute",
        hint: hint({ unit: 5 }),
        rackId: `${id}-r1`,
      },
      {
        id: `${id}-s2`,
        kind: "server",
        name: "s2",
        modelId: "srv-2u-compute",
        hint: hint({ unit: 5 }),
        rackId: `${id}-r1`,
      },
      {
        id: `${id}-s3`,
        kind: "server",
        name: "s3",
        modelId: "srv-1u-compute",
        hint: hint({ rackRef: `${id}-r2` }),
      },
    ],
    equipment: [
      { id: `${id}-crah1`, kind: "cooling_unit", name: "CRAH-1", modelId: "crah-100kw" },
      { id: `${id}-crah2`, kind: "cooling_unit", name: "CRAH-2", modelId: "crah-100kw" },
      { id: `${id}-pnl`, kind: "power_panel", name: "PNL", modelId: "panel-400a" },
    ],
    ...extra,
  };
}

function assemble(land?: { w: number; d: number }) {
  const asm = new BlueprintAssembler("t", "테스트", catalog, { source: "test" })
    .site("site", "사업장", land)
    .building("b1", "site", "1동")
    .floor("f1", "b1", "1F", 1)
    .room("f1", room("ra", { containment: "cold" }))
    .room("f1", room("rb"))
    .floorItem("f1", { id: "ups", kind: "ups", name: "UPS", modelId: "ups-500kva" })
    .virtual("vm", "vm", "vm-1")
    .link("runs_on", "vm", "ra-s1")
    .link("runs_on", "vm", "ra-s1");
  return asm.build();
}

describe("blueprint assembly [REQ-012] [REQ-013]", () => {
  test("rooms of racks become a valid world: no overlaps, units resolved, geometry derived", () => {
    const { blueprint, issues, notes } = assemble();
    // The assembler places things; wiring power and cooling is the source's job, so only warnings remain.
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(issues.map((i) => i.code)).toContain("W020");
    expect(() => World.fromBlueprint(blueprint, catalog)).not.toThrow();
    const index = new BlueprintIndex(blueprint);
    expect(index.entity("ra-s1").placement).toEqual({ type: "unit", u: 5 });
    expect(index.entity("ra-s2")).toMatchObject({
      placement: { type: "unit", u: 7 },
      props: { positionInferred: true },
    });
    expect(index.entity("ra-s3").parentId).toBe("ra-r2");
    expect(notes).toContain("ra 서버룸: ra-s2: unit already used, placed at U7");
    expect(blueprint.links).toEqual([
      { id: "l-runs_on-vm-ra-s1", kind: "runs_on", from: "vm", to: "ra-s1", props: {} },
    ]);
  });

  test("free-standing equipment is laid out by footprint, never overlapping", () => {
    const index = new BlueprintIndex(assemble().blueprint);
    const units = ["ra-crah1", "ra-crah2", "ra-pnl"].map((id) => index.entity(id));
    const spots = units.map((u) => (u.placement?.type === "spot" ? u.placement.x : Number.NaN));
    expect(spots[1]).toBeCloseTo(
      (spots[0] as number) + (footprint(units[0] as never, catalog)?.w ?? 0) + 0.6,
      6,
    );
    expect(spots[2]).toBeGreaterThan(spots[1] as number);
  });

  test("cold-aisle containment encloses the paired rows; racks sit inside it", () => {
    const index = new BlueprintIndex(assemble().blueprint);
    expect(index.entity("ra-ca1")).toMatchObject({
      kind: "containment",
      name: "ra 서버룸 냉복도 1",
      props: { aisle: "cold" },
    });
    expect(index.entity("ra-r1").parentId).toBe("ra-ca1");
    expect(index.entity("rb-r1").parentId).toBe("rb");
  });

  test("rooms are packed on the floor, the floor sized to them, floor equipment beside them", () => {
    const index = new BlueprintIndex(assemble().blueprint);
    const [a, b] = ["ra", "rb"].map(
      (id) => index.entity(id).placement as { x: number; y: number; w: number; d: number },
    );
    expect((b as { x: number }).x).toBeGreaterThanOrEqual(
      (a as { x: number; w: number }).x + (a as { w: number }).w,
    );
    const ups = index.entity("ups");
    expect(ups).toMatchObject({ parentId: "f1", placement: { type: "spot", rotation: 0 } });
    const upsY = (ups.placement as { y: number }).y;
    expect(upsY).toBeGreaterThanOrEqual(
      Math.max((a as { y: number; d: number }).y + (a as { d: number }).d, 0),
    );
  });

  test("a site too small for its buildings is enlarged, and the report says so", () => {
    const small = assemble({ w: 10, d: 10 });
    const site = small.blueprint.entities.find((e) => e.id === "site");
    expect(site?.placement).toMatchObject({ type: "land" });
    expect((site?.placement as { w: number }).w).toBeGreaterThan(10);
    expect(
      small.notes.some((n) => n.startsWith("사업장: 건물이 부지에 다 들어가지 않아 부지를")),
    ).toBe(true);
    expect(assemble({ w: 2000, d: 2000 }).notes.some((n) => n.startsWith("사업장:"))).toBe(false);
  });

  test("a floor without rooms and a building without floors still get a footprint", () => {
    const { blueprint, issues } = new BlueprintAssembler("e", "빈 곳", catalog)
      .site("s", "사업장")
      .building("b", "s", "1동")
      .building("b2", "s", "2동")
      .floor("f", "b", "1F", 1)
      .build();
    expect(issues).toEqual([]);
    expect(blueprint.entities.find((e) => e.id === "b2")?.placement).toMatchObject({
      w: 16,
      d: 16,
    });
  });
});
