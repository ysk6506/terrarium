/**
 * The builder under a random walk: buy land, build, add floors and rooms, fill them, stand equipment, move,
 * turn, resize, remove and undo, in any order. Whatever happens, a refused edit says why (an EditError) and
 * leaves the world as it was, and an accepted one leaves a world that validates and can be looked at and run.
 */
import { Catalog } from "@terrarium/core/catalog";
import type { Blueprint } from "@terrarium/core/world";
import {
  BlueprintIndex,
  BUILDING_PURPOSES,
  hasErrors,
  ROOM_PURPOSES,
  validateBlueprint,
} from "@terrarium/core/world";
import * as fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  addBuilding,
  addContainment,
  addFloor,
  addRoom,
  buyParcel,
  type Edit,
  EditError,
  FILL_AISLES,
  FILL_LOADS,
  fillRoom,
  type Level,
  levelArea,
  levelStats,
  moveTo,
  newSite,
  placeEquipment,
  placePlant,
  placeRack,
  placeRackRow,
  preview,
  rectangleOutline,
  remove,
  resizeArea,
  rotate,
} from ".";

const catalog = new Catalog();

const EQUIPMENT = [
  "crah-100kw",
  "inrow-30kw",
  "panel-400a",
  "panel-225a",
  "ups-500kva",
  "ups-200kva",
] as const;
const PLANTS = [
  "sy-transformer-2500kva",
  "tg-diesel-2mw",
  "gl-chiller-screw-2mw",
  "gl-drycooler-2mw",
] as const;
const ROTATIONS = [0, 90, 180, 270] as const;

const unit = fc.double({ min: 0, max: 1, noNaN: true });
const pick = fc.nat({ max: 1000 });

type Op =
  | { t: "buy"; i: number }
  | { t: "building"; a: number[]; purpose: number }
  | { t: "floor"; i: number }
  | { t: "room"; i: number; a: number[]; purpose: number }
  | { t: "hall"; i: number; a: number[] }
  | { t: "fill"; i: number; load: number; aisle: number }
  | { t: "contain"; i: number; a: number[]; hot: boolean }
  | { t: "rack"; i: number; a: number[]; rot: number; row: number }
  | { t: "equip"; i: number; model: number; a: number[]; rot: number }
  | { t: "plant"; model: number; a: number[]; rot: number }
  | { t: "move"; i: number; a: number[] }
  | { t: "rotate"; i: number }
  | { t: "resize"; i: number; a: number[] }
  | { t: "remove"; i: number }
  | { t: "undo" };

const four = fc.array(unit, { minLength: 4, maxLength: 4 });
const op: fc.Arbitrary<Op> = fc.oneof(
  { weight: 2, arbitrary: fc.record({ t: fc.constant("buy" as const), i: pick }) },
  {
    weight: 4,
    arbitrary: fc.record({ t: fc.constant("building" as const), a: four, purpose: pick }),
  },
  { weight: 2, arbitrary: fc.record({ t: fc.constant("floor" as const), i: pick }) },
  {
    weight: 5,
    arbitrary: fc.record({ t: fc.constant("room" as const), i: pick, a: four, purpose: pick }),
  },
  { weight: 5, arbitrary: fc.record({ t: fc.constant("hall" as const), i: pick, a: four }) },
  {
    weight: 4,
    arbitrary: fc.record({ t: fc.constant("fill" as const), i: pick, load: pick, aisle: pick }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      t: fc.constant("contain" as const),
      i: pick,
      a: four,
      hot: fc.boolean(),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      t: fc.constant("rack" as const),
      i: pick,
      a: four,
      rot: pick,
      row: fc.nat({ max: 8 }),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      t: fc.constant("equip" as const),
      i: pick,
      model: pick,
      a: four,
      rot: pick,
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({ t: fc.constant("plant" as const), model: pick, a: four, rot: pick }),
  },
  { weight: 3, arbitrary: fc.record({ t: fc.constant("move" as const), i: pick, a: four }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant("rotate" as const), i: pick }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant("resize" as const), i: pick, a: four }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant("remove" as const), i: pick }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant("undo" as const) }) },
);

const at = <T>(items: readonly T[], i: number): T | undefined =>
  items.length === 0 ? undefined : items[i % items.length];

/** A rectangle somewhere in the level, as fractions of its area; a few metres at least. */
function rectIn(index: BlueprintIndex, level: Level, a: readonly number[], min = { w: 3, d: 3 }) {
  const area = levelArea(index, catalog, level);
  const w = min.w + (a[2] ?? 0) * Math.max(0, area.w * 0.8 - min.w);
  const d = min.d + (a[3] ?? 0) * Math.max(0, area.d * 0.8 - min.d);
  return {
    x: (a[0] ?? 0) * Math.max(0, area.w - w),
    y: (a[1] ?? 0) * Math.max(0, area.d - d),
    w,
    d,
  };
}

/** Every level a person could be looking at: the site, each floor, each room. */
function levels(index: BlueprintIndex): Level[] {
  return [
    { kind: "site" },
    ...index.ofKind("floor").map((f): Level => ({ kind: "floor", id: f.id })),
    ...index.ofKind("room").map((r): Level => ({ kind: "room", id: r.id })),
  ];
}

/** The edit an op asks for on this world, or undefined when there is nothing it could act on. */
function editFor(bp: Blueprint, o: Op): (() => Edit) | undefined {
  const index = new BlueprintIndex(bp);
  const floors = index.ofKind("floor");
  const rooms = index.ofKind("room");
  const movable = index
    .all()
    .filter((e) => e.placement?.type === "spot" || e.placement?.type === "area");
  switch (o.t) {
    case "buy": {
      const sale = index.ofKind("parcel").filter((p) => p.props.owned === false);
      const p = at(sale, o.i);
      return p && (() => buyParcel(bp, p.id));
    }
    case "building":
      return () =>
        addBuilding(
          bp,
          catalog,
          rectIn(index, { kind: "site" }, o.a, { w: 40, d: 40 }),
          at(BUILDING_PURPOSES, o.purpose),
        );
    case "floor": {
      const b = at(index.ofKind("building"), o.i);
      return b && (() => addFloor(bp, b.id));
    }
    case "room": {
      const f = at(floors, o.i);
      return (
        f &&
        (() =>
          addRoom(
            bp,
            catalog,
            f.id,
            rectIn(index, { kind: "floor", id: f.id }, o.a),
            at(ROOM_PURPOSES, o.purpose),
          ))
      );
    }
    case "hall": {
      // A server room big enough to fill: the walk would almost never draw one by chance.
      const f = at(floors, o.i);
      return (
        f &&
        (() =>
          addRoom(
            bp,
            catalog,
            f.id,
            rectIn(index, { kind: "floor", id: f.id }, o.a, { w: 16, d: 12 }),
            "data_hall",
          ))
      );
    }
    case "fill": {
      const r = at(rooms, o.i);
      const load = at(FILL_LOADS, o.load)?.value;
      const aisle = at(FILL_AISLES, o.aisle)?.value;
      return r && load && aisle && (() => fillRoom(bp, catalog, r.id, { load, aisle }));
    }
    case "contain": {
      const r = at(rooms, o.i);
      return (
        r &&
        (() =>
          addContainment(
            bp,
            catalog,
            r.id,
            rectIn(index, { kind: "room", id: r.id }, o.a),
            o.hot ? "hot" : "cold",
          ))
      );
    }
    case "rack": {
      const r = at(rooms, o.i);
      if (!r) return undefined;
      const area = levelArea(index, catalog, { kind: "room", id: r.id });
      const spot = {
        x: (o.a[0] ?? 0) * area.w,
        y: (o.a[1] ?? 0) * area.d,
        rotation: at(ROTATIONS, o.rot) ?? 0,
      };
      return () =>
        o.row > 1
          ? placeRackRow(bp, catalog, r.id, spot, o.row)
          : placeRack(bp, catalog, r.id, spot);
    }
    case "equip": {
      const level = at(
        levels(index).filter((l) => l.kind !== "site"),
        o.i,
      );
      const model = at(EQUIPMENT, o.model);
      if (!level || !model) return undefined;
      const area = levelArea(index, catalog, level);
      const spot = {
        x: (o.a[0] ?? 0) * area.w,
        y: (o.a[1] ?? 0) * area.d,
        rotation: at(ROTATIONS, o.rot) ?? 0,
      };
      return () => placeEquipment(bp, catalog, level, model, spot);
    }
    case "plant": {
      const model = at(PLANTS, o.model);
      const area = levelArea(index, catalog, { kind: "site" });
      const spot = {
        x: (o.a[0] ?? 0) * area.w,
        y: (o.a[1] ?? 0) * area.d,
        rotation: at(ROTATIONS, o.rot) ?? 0,
      };
      return model && (() => placePlant(bp, catalog, model, spot));
    }
    case "move": {
      const e = at(movable, o.i);
      const level = e && levelOf(index, e.id);
      if (!e || !level) return undefined;
      const area = levelArea(index, catalog, level);
      return () => moveTo(bp, catalog, level, e.id, (o.a[0] ?? 0) * area.w, (o.a[1] ?? 0) * area.d);
    }
    case "rotate": {
      const spots = index.all().filter((e) => e.placement?.type === "spot");
      const e = at(spots, o.i);
      const level = e && levelOf(index, e.id);
      return e && level && (() => rotate(bp, catalog, level, e.id));
    }
    case "resize": {
      const areas = index.all().filter((e) => e.placement?.type === "area");
      const e = at(areas, o.i);
      const level = e && levelOf(index, e.id);
      return e && level && (() => resizeArea(bp, catalog, e.id, rectIn(index, level, o.a)));
    }
    case "remove": {
      const e = at(
        index.all().filter((x) => x.kind !== "site" && x.kind !== "parcel"),
        o.i,
      );
      return e && (() => remove(bp, [e.id]));
    }
    case "undo":
      return undefined;
  }
}

/** The level an entity is looked at on (where it stands). */
function levelOf(index: BlueprintIndex, id: string): Level | undefined {
  const e = index.find(id);
  const parent = e?.parentId ? index.find(e.parentId) : undefined;
  if (!parent) return undefined;
  if (parent.kind === "site") return { kind: "site" };
  if (parent.kind === "building") return { kind: "site" };
  if (parent.kind === "floor") return { kind: "floor", id: parent.id };
  if (parent.kind === "room" || parent.kind === "containment") {
    const room = parent.kind === "room" ? parent : index.enclosing(parent.id, "room");
    return room ? { kind: "room", id: room.id } : undefined;
  }
  return undefined;
}

function start(): Blueprint {
  return newSite({
    name: "무작위 시험",
    siteName: "시험사업장",
    outline: rectangleOutline(600, 400),
    forSale: true,
    market: "general",
  });
}

describe("the builder under a random walk [REQ-006] [REQ-043] [REQ-048]", () => {
  test("edits are accepted into a valid world, or refused with a reason that leaves it unchanged", () => {
    fc.assert(
      fc.property(fc.array(op, { minLength: 10, maxLength: 60 }), (ops) => {
        let bp = start();
        const past: Blueprint[] = [];
        for (const o of ops) {
          if (o.t === "undo") {
            const back = past.pop();
            if (back) bp = back;
            continue;
          }
          const make = editFor(bp, o);
          if (!make) continue;
          try {
            const edit = make();
            past.push(bp);
            bp = edit.blueprint;
          } catch (err) {
            expect(err, `${JSON.stringify(o)}: ${(err as Error).stack}`).toBeInstanceOf(EditError);
            continue;
          }
          const errors = validateBlueprint(bp, catalog).filter((i) => i.severity === "error");
          expect(
            errors.map((i) => `${i.code} ${i.message}`),
            JSON.stringify(o),
          ).toEqual([]);
        }
        // What the screens ask of any world: totals at every level.
        const index = new BlueprintIndex(bp);
        for (const level of levels(index)) {
          const stats = levelStats(index, catalog, level);
          expect(Number.isFinite(stats.costM)).toBe(true);
          expect(stats.costM).toBeGreaterThanOrEqual(0);
        }
        expect(hasErrors(validateBlueprint(bp, catalog))).toBe(false);
      }),
      { numRuns: 1500, seed: 20261104, endOnFailure: false },
    );
  }, 240_000);

  test("what the walk builds can be run: the preview finishes with finite temperatures", () => {
    fc.assert(
      fc.property(fc.array(op, { minLength: 30, maxLength: 60 }), (ops) => {
        let bp = start();
        for (const o of ops) {
          const make = editFor(bp, o);
          if (!make) continue;
          try {
            bp = make().blueprint;
          } catch (err) {
            expect(err).toBeInstanceOf(EditError);
          }
        }
        const result = preview(bp, catalog, 120);
        if ("problems" in result) throw new Error(result.problems.join("; "));
        for (const c of result.heat.values()) expect(Number.isFinite(c)).toBe(true);
      }),
      { numRuns: 150, seed: 7 },
    );
  }, 240_000);
});
