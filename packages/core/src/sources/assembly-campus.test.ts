import { Catalog } from "@terrarium/core/catalog";
import { EMPTY_HINT } from "@terrarium/core/spatial";
import { type Entity, footprint } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { BlueprintAssembler, type RoomSpec } from ".";

const catalog = new Catalog();
const at = (x: number, y: number, row = 1, column = 1) => ({
  x,
  y,
  rotation: 0 as const,
  row,
  column,
});

/** A hall with two liquid-cooled racks in one pod, a server high in the 48U rack, and a CDU. */
function hall(): RoomSpec {
  return {
    id: "h",
    name: "AI 홀",
    purpose: "data_hall",
    size: { w: 30, d: 20 },
    racks: [
      { id: "r1", name: "R1", hint: EMPTY_HINT, modelId: "aq-48u-dlc", at: at(2, 3) },
      { id: "r2", name: "R2", hint: EMPTY_HINT, modelId: "aq-48u-dlc", at: at(3, 3, 1, 2) },
    ],
    devices: [
      {
        id: "s1",
        kind: "server",
        name: "s1",
        modelId: "ax-4u-8gpu-dlc",
        hint: { floorInfo: {}, unit: 44, unitSpan: 4 },
        rackId: "r1",
      },
    ],
    equipment: [{ id: "cdu", kind: "cdu", name: "CDU", modelId: "aq-cdu-500kw", at: at(12, 3) }],
    pods: [{ id: "p1", name: "포드 1", aisle: "cold", racks: ["r1", "r2"] }],
  };
}

function campus() {
  const asm = new BlueprintAssembler("c", "캠퍼스", catalog, {});
  asm.site("s", "사업장", { w: 900, d: 700 }, {}, true).building("b", "s", "DC1");
  asm.floor("f", "b", "1F", 1).room("f", hall());
  asm.yardItem("s", "발전기 마당", {
    id: "g1",
    kind: "generator",
    name: "G1",
    modelId: "tg-diesel-2mw",
  });
  asm.yardItem("s", "발전기 마당", {
    id: "g2",
    kind: "generator",
    name: "G2",
    modelId: "tg-diesel-2mw",
  });
  asm.yardItem("s", "냉각 플랜트", {
    id: "ch1",
    kind: "chiller",
    name: "CH1",
    modelId: "gl-chiller-screw-1mw",
  });
  return asm.build();
}

const byId = (entities: readonly Entity[], id: string) =>
  entities.find((e) => e.id === id) as Entity;

describe("assembling a campus: known places, pods, yard and parcels [REQ-043]", () => {
  const { blueprint, issues } = campus();
  const e = blueprint.entities;

  test("racks stand exactly where the generator put them, with their model, inside their pod", () => {
    expect(byId(e, "r1")).toMatchObject({
      parentId: "p1",
      modelId: "aq-48u-dlc",
      placement: { type: "spot", x: 2, y: 3, rotation: 0 },
    });
    expect(byId(e, "r2").placement).toMatchObject({ x: 3, y: 3 });
    // The pod encloses its racks; the 48U rack takes a server above U42.
    const pod = byId(e, "p1");
    expect(pod).toMatchObject({ kind: "containment", parentId: "h", props: { aisle: "cold" } });
    expect(byId(e, "s1").placement).toEqual({ type: "unit", u: 44 });
    const rect = footprint(pod, catalog);
    const r1 = footprint(byId(e, "r1"), catalog);
    expect(rect && r1 && rect.x < r1.x && rect.y < r1.y).toBe(true);
    expect(rect && r1 && rect.x + rect.w > r1.x + r1.w).toBe(true);
  });

  test("a room keeps its purpose and is at least as big as asked", () => {
    const room = byId(e, "h");
    expect(room.props.purpose).toBe("data_hall");
    expect(room.placement).toMatchObject({ type: "area" });
    const { w, d } = room.placement as { w: number; d: number };
    expect(w).toBeGreaterThanOrEqual(30);
    expect(d).toBeGreaterThanOrEqual(20);
    expect(byId(e, "cdu")).toMatchObject({
      kind: "cdu",
      parentId: "h",
      placement: { x: 12, y: 3 },
    });
  });

  test("yard plant stands below the buildings in groups, without overlapping", () => {
    const building = footprint(byId(e, "b"), catalog);
    const plant = ["g1", "g2", "ch1"].map((id) => byId(e, id));
    for (const p of plant) {
      expect(p.parentId).toBe("s");
      expect((footprint(p, catalog) as { y: number }).y).toBeGreaterThanOrEqual(
        (building as { y: number; d: number }).y + (building as { d: number }).d,
      );
    }
    expect(plant.map((p) => p.props.yard)).toEqual(["발전기 마당", "발전기 마당", "냉각 플랜트"]);
    expect(issues.filter((i) => i.code === "W008")).toEqual([]);
  });

  test("the land in use is owned; the rest of the preset land is for sale at a price", () => {
    const parcels = e.filter((x) => x.kind === "parcel");
    const owned = parcels.filter((p) => p.props.owned !== false);
    const forSale = parcels.filter((p) => p.props.owned === false);
    expect(owned.map((p) => p.name)).toEqual(["본 부지"]);
    expect(forSale.length).toBeGreaterThan(0);
    for (const p of forSale) {
      expect(p.props.priceM).toBeGreaterThan(0);
      expect(p.props.areaM2).toBeGreaterThan(5000);
    }
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  test("building the same description twice gives the same world", () => {
    expect(campus().blueprint).toEqual(blueprint);
  });
});
