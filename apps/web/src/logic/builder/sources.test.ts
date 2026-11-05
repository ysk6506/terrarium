import { Catalog } from "@terrarium/core/catalog";
import { type Blueprint, BlueprintIndex, type Entity } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import {
  addBuilding,
  addRoom,
  assertFloorRoom,
  emptyWorld,
  floorFullRefusal,
  floorNote,
  floorNoteText,
  link,
  megawatts,
  outsideWays,
  placeEquipment,
  placePlant,
  placeRack,
  replaceEntity,
  roomSources,
  siteUseText,
} from ".";

const catalog = new Catalog();
const at = (x: number, y: number) => ({ x, y, rotation: 0 as const });

/** A building with a server room, a mechanical room and an electrical room on its one floor. */
function world() {
  let bp = emptyWorld("w", "시험", { w: 300, d: 200 }, "사업장");
  bp = addBuilding(bp, catalog, { x: 10, y: 10, w: 60, d: 40 }).blueprint;
  const index = () => new BlueprintIndex(bp);
  const floorId = index().ofKind("floor")[0]?.id as string;
  bp = addRoom(bp, catalog, floorId, { x: 3, y: 3, w: 12, d: 9 }).blueprint;
  bp = addRoom(bp, catalog, floorId, { x: 20, y: 3, w: 9, d: 9 }, "mechanical").blueprint;
  bp = addRoom(bp, catalog, floorId, { x: 31, y: 3, w: 9, d: 9 }, "electrical").blueprint;
  const room = (purpose?: string) =>
    index()
      .ofKind("room")
      .find((r) => (r.props.purpose ?? "data_hall") === (purpose ?? "data_hall")) as Entity;
  return {
    bp,
    index,
    floorId,
    hall: room().id,
    mech: room("mechanical").id,
    elec: room("electrical").id,
  };
}

const only = (bp: Blueprint, kind: Entity["kind"], model?: string): Entity =>
  new BlueprintIndex(bp)
    .ofKind(kind)
    .find((e) => model === undefined || e.modelId === model) as Entity;

describe("where a room's cooling and power come from [REQ-076]", () => {
  test("every unit that cools or feeds the racks is listed with what it is and where it stands", () => {
    const w = world();
    let bp = placeRack(w.bp, catalog, w.hall, at(1.2, 1.2)).blueprint;
    const hall = { kind: "room", id: w.hall } as const;
    bp = placeEquipment(bp, catalog, hall, "crah-100kw", at(1.2, 5)).blueprint;
    bp = placeEquipment(bp, catalog, hall, "inrow-30kw", at(5, 5)).blueprint;
    bp = placeEquipment(
      bp,
      catalog,
      { kind: "room", id: w.mech },
      "aq-cdu-500kw",
      at(1, 1),
    ).blueprint;
    bp = placeEquipment(
      bp,
      catalog,
      { kind: "room", id: w.elec },
      "panel-400a",
      at(1, 1),
    ).blueprint;
    bp = placeEquipment(
      bp,
      catalog,
      { kind: "room", id: w.elec },
      "ups-500kva",
      at(4, 1),
    ).blueprint;
    bp = placeEquipment(
      bp,
      catalog,
      { kind: "floor", id: w.floorId },
      "sy-ats-1600a",
      at(45, 20),
    ).blueprint;
    bp = placePlant(bp, catalog, "gl-chiller-screw-1mw", at(100, 100)).blueprint;
    bp = placePlant(bp, catalog, "gl-drycooler-2mw", at(100, 120)).blueprint;
    bp = placePlant(bp, catalog, "gl-tower-4mw", at(100, 140)).blueprint;
    bp = placePlant(bp, catalog, "tg-diesel-1mw", at(150, 100)).blueprint;
    bp = placePlant(bp, catalog, "sy-transformer-2500kva", at(150, 120)).blueprint;
    const rack = only(bp, "rack").id;
    const crah = only(bp, "cooling_unit", "crah-100kw").id;
    const to = (from: string, target: Entity, kind: "cooling" | "power") => {
      bp = link(bp, kind, from, target.id).blueprint;
    };
    to(rack, only(bp, "cooling_unit", "crah-100kw"), "cooling");
    to(rack, only(bp, "cooling_unit", "inrow-30kw"), "cooling");
    to(rack, only(bp, "cdu"), "cooling");
    to(crah, only(bp, "chiller", "gl-chiller-screw-1mw"), "cooling");
    to(crah, only(bp, "chiller", "gl-drycooler-2mw"), "cooling");
    to(crah, only(bp, "chiller", "gl-tower-4mw"), "cooling");
    to(rack, only(bp, "power_panel", "panel-400a"), "power");
    to(only(bp, "power_panel", "panel-400a").id, only(bp, "ups"), "power");
    to(only(bp, "ups").id, only(bp, "power_panel", "sy-ats-1600a"), "power");
    to(only(bp, "power_panel", "sy-ats-1600a").id, only(bp, "generator"), "power");
    to(
      only(bp, "power_panel", "sy-ats-1600a").id,
      only(bp, "power_panel", "sy-transformer-2500kva"),
      "power",
    );
    const sources = roomSources(new BlueprintIndex(bp), catalog, w.hall);
    const text = (g: { what: string; count: number; where: string }) =>
      `${g.what} ${g.count} ${g.where}`;
    expect(sources.cooling.map(text).sort()).toEqual(
      [
        "항온항습기 1 이 방 안",
        "인로우 냉방기 1 이 방 안",
        "CDU(냉각수 분배) 1 1층 기계실 A",
        "냉동기 1 건물 밖 마당",
        "드라이쿨러 1 건물 밖 마당",
        "냉각탑 1 건물 밖 마당",
      ].sort(),
    );
    expect(sources.power.map(text).sort()).toEqual(
      [
        "분전반 1 1층 전기실 A",
        "UPS 1 1층 전기실 A",
        "절체 스위치(ATS) 1 1층 바닥",
        "발전기 1 건물 밖 마당",
        "변압기 1 건물 밖 마당",
      ].sort(),
    );
  });

  test("a plant on the roof is on the roof, and a room with no links lists nothing", () => {
    const w = world();
    let bp = placeRack(w.bp, catalog, w.hall, at(1.2, 1.2)).blueprint;
    bp = placePlant(bp, catalog, "gl-chiller-screw-1mw", at(100, 100)).blueprint;
    const chiller = only(bp, "chiller");
    const building = only(bp, "building");
    bp = replaceEntity(bp, chiller.id, (e) => ({ ...e, parentId: building.id }));
    bp = link(bp, "cooling", only(bp, "rack").id, chiller.id).blueprint;
    const roof = roomSources(new BlueprintIndex(bp), catalog, w.hall).cooling;
    expect(roof).toEqual([{ what: "냉동기", where: "건물 옥상", count: 1 }]);
    expect(roomSources(new BlueprintIndex(w.bp), catalog, w.hall)).toEqual({
      cooling: [],
      power: [],
    });
  });

  test("the ways to put more outside are the same floor's rooms and the yard, and only for a room on a floor", () => {
    const w = world();
    const index = w.index();
    expect(outsideWays(index, w.hall, "cooling").map((x) => x.key)).toEqual([
      `cooling:${w.mech}`,
      "cooling:yard",
    ]);
    expect(outsideWays(index, w.hall, "power").map((x) => x.key)).toEqual([
      `power:${w.elec}`,
      "power:yard",
    ]);
    expect(outsideWays(index, "nowhere", "power")).toEqual([]);
    expect(outsideWays(index, w.floorId, "power")).toEqual([]);
  });
});

describe("the words of a full floor and of power [REQ-076]", () => {
  test("a floor that is not in a building has nothing to say, and a building with one floor says only its own", () => {
    const w = world();
    const index = w.index();
    expect(floorFullRefusal(index, catalog, "nowhere").message).toBe("이 층은 꽉 찼어요");
    expect(() => assertFloorRoom(w.bp, w.bp, catalog, undefined)).not.toThrow();
    expect(floorNote(index, catalog, w.hall)).toBeUndefined();
    const note = floorNote(index, catalog, only(w.bp, "building").id, w.floorId);
    expect(floorNoteText(note as NonNullable<typeof note>)).toMatch(/^이 층 빈 바닥 [\d,]+ m²$/);
    const all = floorNote(index, catalog, only(w.bp, "building").id);
    expect(floorNoteText(all as NonNullable<typeof all>)).toMatch(
      /^층마다 합쳐 빈 바닥 [\d,]+ m²$/,
    );
  });

  test("power reads in the unit that fits, and a capacity that is a guess says so", () => {
    expect(megawatts(108e6)).toBe("108 MW");
    expect(megawatts(107.5e6)).toBe("107.5 MW");
    expect(megawatts(2400)).toBe("2.4 kW");
    expect(siteUseText({ capacity: { mw: 20, estimated: true }, usedW: 19.9e6 })).toBe(
      "20 MW(추정) 중 19.9 MW",
    );
    expect(siteUseText({ capacity: { mw: 108, estimated: false }, usedW: 107.5e6 })).toBe(
      "108 MW 중 107.5 MW",
    );
  });
});
