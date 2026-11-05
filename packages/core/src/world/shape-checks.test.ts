import { Catalog } from "@terrarium/core/catalog";
import { describe, expect, test } from "vitest";
import { type Blueprint, BlueprintIndex, type Entity, validateBlueprint } from ".";
import { structureCostM } from "./construction";
import { checkRoomShapes } from "./validate-room";

const catalog = new Catalog();
const e = (
  id: string,
  kind: Entity["kind"],
  parentId: string | undefined,
  extra: Partial<Entity> = {},
): Entity => ({
  id,
  kind,
  name: id,
  props: {},
  ...(parentId ? { parentId } : {}),
  ...extra,
});
const index = (entities: Entity[]) =>
  new BlueprintIndex({
    schemaVersion: 1,
    id: "b",
    name: "b",
    entities,
    links: [],
    meta: {},
  } as Blueprint);

const site = e("site", "site", undefined, { placement: { type: "land", w: 100, d: 100 } });
const building = e("bldg", "building", "site", {
  placement: { type: "area", x: 0, y: 0, w: 40, d: 20 },
});
const floor = e("fl", "floor", "bldg", { placement: { type: "level", level: 1, height: 4 } });
const room = (
  pieces?: Array<{ x: number; y: number; w: number; d: number }>,
  body = { x: 2, y: 2, w: 10, d: 6 },
) =>
  e("hall", "room", "fl", { placement: { type: "area", ...body, ...(pieces ? { pieces } : {}) } });

describe("what the structure of a thing costs [REQ-059]", () => {
  test("a floor costs its building's footprint at the building's rate; with no building around it, nothing", () => {
    const world = index([site, building, floor, e("loose", "floor", undefined)]);
    expect(structureCostM(world, catalog, floor)).toBeGreaterThan(0);
    expect(structureCostM(world, catalog, e("loose", "floor", undefined))).toBe(0);
  });

  test("a room costs its fit-out by area, pieces included; a containment its frame; anything else is free", () => {
    const plain = index([site, building, floor, room()]);
    const pieced = index([site, building, floor, room([{ x: 12, y: 2, w: 4, d: 6 }])]);
    const one = structureCostM(plain, catalog, room());
    const both = structureCostM(pieced, catalog, room([{ x: 12, y: 2, w: 4, d: 6 }]));
    expect(both).toBeGreaterThan(one);
    const pod = e("pod", "containment", "hall", {
      placement: { type: "area", x: 1, y: 1, w: 4, d: 2 },
    });
    expect(structureCostM(plain, catalog, pod)).toBeCloseTo(8 * 0.9);
    expect(structureCostM(plain, catalog, site)).toBe(0);
  });

  test("a containment or room that has no place has no floor to price", () => {
    const world = index([site, building, floor]);
    expect(structureCostM(world, catalog, e("pod", "containment", "fl"))).toBe(0);
    expect(structureCostM(world, catalog, e("r", "room", "fl"))).toBe(0);
  });
});

describe("a room made of pieces is checked for its shape [REQ-075]", () => {
  const problems = (r: Entity, parts: Entity[] = [site, building, floor]) =>
    checkRoomShapes(index([...parts, r]), catalog).map((i) => i.message);

  test("a plain rectangle and a good L are fine", () => {
    expect(problems(room())).toEqual([]);
    expect(problems(room([{ x: 12, y: 2, w: 4, d: 3 }]))).toEqual([]);
  });

  test("a piece with no size, overlapping, apart, or closing round a gap is named", () => {
    expect(problems(room([{ x: 12, y: 2, w: 0, d: 3 }]))[0]).toContain("0 이하");
    expect(problems(room([{ x: 8, y: 2, w: 4, d: 3 }]))[0]).toContain("겹쳐요");
    expect(problems(room([{ x: 20, y: 2, w: 4, d: 3 }]))[0]).toContain("붙어 있지 않아요");
    const ring = room(
      [
        { x: 6, y: 2, w: 2, d: 2 },
        { x: 6, y: 6, w: 2, d: 2 },
        { x: 8, y: 2, w: 2, d: 6 },
      ],
      { x: 2, y: 2, w: 4, d: 6 },
    );
    expect(problems(ring).join(" ")).toContain("빈 자리를 둘러싸요");
  });

  test("a piece that sticks out of the building is told to come in, and so is it by the whole validation", () => {
    const out = room([{ x: 40, y: 2, w: 4, d: 6 }], { x: 30, y: 2, w: 10, d: 6 });
    expect(problems(out).join(" ")).toContain("건물 바닥 밖으로");
    const codes = validateBlueprint(
      {
        schemaVersion: 1,
        id: "b",
        name: "b",
        entities: [site, building, floor, out],
        links: [],
        meta: {},
      },
      catalog,
    ).map((i) => i.code);
    expect(codes).toContain("W056");
  });

  test("a room on no floor or in no building has nothing to stand inside, and a plain room is not checked", () => {
    const lonely = e("hall", "room", undefined, {
      placement: { type: "area", x: 0, y: 0, w: 10, d: 5, pieces: [{ x: 10, y: 0, w: 5, d: 5 }] },
    });
    expect(problems(lonely, [site])).toEqual([]);
    const noBuilding = e("hall", "room", "fl", {
      placement: { type: "area", x: 0, y: 0, w: 10, d: 5, pieces: [{ x: 10, y: 0, w: 5, d: 5 }] },
    });
    expect(
      problems(noBuilding, [
        site,
        e("fl", "floor", "site", { placement: { type: "level", level: 1, height: 4 } }),
      ]),
    ).toEqual([]);
    expect(problems(e("hall", "room", "fl"), [site, building, floor])).toEqual([]);
  });
});
