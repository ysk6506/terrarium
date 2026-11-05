import { Catalog } from "@terrarium/core/catalog";
import { describe, expect, test } from "vitest";
import { bundleTexts, NAMED_MODELS, type ToolView, toolsFor } from ".";

const catalog = new Catalog();
const view: ToolView = { buildings: 1, forSale: 4, rooms: 1, roomFull: false };
const site = { kind: "site" } as const;
const floor = { kind: "floor", id: "floor-1" } as const;
const room = { kind: "room", id: "room-1" } as const;

describe("the left panel offers what can be done here, in bundles [REQ-077]", () => {
  test("each place has its own bundles: land, buildings and plant on the site; rooms and power on a floor; racks, cooling and power in a room", () => {
    expect(toolsFor(site, catalog, view).map((b) => b.id)).toEqual(["land", "building", "outside"]);
    expect(toolsFor(floor, catalog, view).map((b) => b.id)).toEqual(["rooms", "power"]);
    expect(toolsFor(room, catalog, view).map((b) => b.id)).toEqual(["racks", "cooling", "power"]);
  });

  test("a bundle's big button says its result, and its list is named by use, with no price in it", () => {
    for (const level of [site, floor, room])
      for (const bundle of toolsFor(level, catalog, view)) {
        if (bundle.main) expect(bundle.main.label).toMatch(/(올리기|사기|놓기|만들기|넓히기)$/);
        for (const pick of bundle.picks) expect(pick.label).not.toMatch(/원|\$|억|만 /);
      }
    const cooling = toolsFor(room, catalog, view).find((b) => b.id === "cooling");
    expect(cooling?.picks.map((p) => p.label)).toEqual([
      "냉방기 — 인로우 30kW",
      "냉방기 — 항온항습기 100kW",
    ]);
  });

  test("every model a bundle names is in the catalog", () => {
    for (const id of NAMED_MODELS) expect(catalog.has(id)).toBe(true);
  });

  test("with nowhere to put anything a bundle says so in one line and keeps its button", () => {
    const bare = toolsFor(site, catalog, { ...view, buildings: 0, forSale: 0 });
    expect(bare.find((b) => b.id === "building")).toMatchObject({
      line: "여기엔 아직 건물이 없어요",
      picks: [],
      main: { label: "건물 올리기" },
    });
    expect(bare.find((b) => b.id === "land")).toMatchObject({
      line: "팔고 있는 땅을 모두 샀어요",
    });
    expect(bare.find((b) => b.id === "land")?.main).toBeUndefined();
    const noRooms = toolsFor(floor, catalog, { ...view, rooms: 0 });
    expect(noRooms[0]).toMatchObject({
      line: "이 층엔 아직 방이 없어요",
      main: { label: "서버룸 만들기" },
    });
  });

  test("a full room's rack bundle leads to widening instead of putting a rack down", () => {
    const racks = toolsFor(room, catalog, { ...view, roomFull: true }).find(
      (b) => b.id === "racks",
    );
    expect(racks).toMatchObject({
      line: "랙 놓을 자리가 없어요",
      main: { kind: "widen", label: "서버룸 넓히기" },
      picks: [],
    });
    const open = toolsFor(room, catalog, view).find((b) => b.id === "racks");
    expect(open?.main).toMatchObject({ kind: "tool", label: "랙 놓기" });
    expect(open?.note).toBe("컨테인먼트는 랙 줄을 덮는 칸이에요");
  });

  test("the words of every bundle at every level are collected for the style check", () => {
    const texts = [site, floor, room].flatMap((l) => bundleTexts(toolsFor(l, catalog, view)));
    expect(texts).toContain("건물 올리기");
    expect(texts.every((t) => t.length > 0)).toBe(true);
  });
});
