import { Catalog } from "@terrarium/core/catalog";
import { type Blueprint, BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { builder } from "..";

const catalog = new Catalog();
const small = builder.smallStart({ name: "내 사업장", siteName: "내 사업장" }, catalog);
const idx = (bp: Blueprint) => new BlueprintIndex(bp);
const roomId = idx(small).ofKind("room")[0]?.id ?? "";
const filled = builder.fillRoom(small, catalog, roomId, { load: "half", aisle: "cold" }).blueprint;
const site = { kind: "site" } as const;
const inRoom = { kind: "room", id: roomId } as const;

const card = (bp: Blueprint, level: builder.Level, ran = false, pick?: string) => {
  const index = idx(bp);
  return builder.describePick(bp, index, catalog, level, pick ? index.find(pick) : undefined, ran);
};

describe("the one main button is chosen by the state [REQ-077]", () => {
  test("an empty server room is filled, one with racks is run", () => {
    expect(card(small, inRoom)).toMatchObject({
      name: "서버룸 A",
      status: "랙 0대 · 비어 있어요",
      primary: { id: "fill", label: "서버룸 채우기" },
    });
    expect(card(filled, inRoom)).toMatchObject({
      status: "랙 24대 · 서버 288대",
      primary: { id: "run", label: builder.RUN },
    });
    expect(card(filled, inRoom, true).primary?.label).toBe(builder.RUN_OFF);
  });

  test("a room with something else in it cannot be filled, and the button says why", () => {
    const withPanel: Blueprint = {
      ...small,
      entities: [
        ...small.entities,
        {
          id: "panel-9",
          kind: "power_panel",
          name: "분전반 9",
          parentId: roomId,
          modelId: "panel-225a",
          placement: { type: "spot", x: 1, y: 1, rot: 0 },
          props: {},
        } as never,
      ],
    };
    const { primary } = card(withPanel, inRoom);
    expect(primary).toMatchObject({ id: "fill", label: "서버룸 채우기" });
    expect(primary?.why).toBe("이미 놓은 것이 있어요. 지우고 비운 서버룸에서 채워요");
  });

  test("a building is entered; the site and a floor lead to the next thing before running", () => {
    const building = idx(small).ofKind("building")[0]?.id;
    expect(card(small, site, false, building).primary).toMatchObject({
      id: "enter",
      label: "들어가기",
    });
    expect(card(small, site).primary).toMatchObject({ id: "next", label: "서버룸 채우기" });
    expect(card(filled, site).primary).toMatchObject({ id: "run" });
    const floor = idx(small).ofKind("floor")[0]?.id ?? "";
    expect(card(small, { kind: "floor", id: floor }).primary?.id).toBe("next");
    const land = builder.newSite({
      name: "땅",
      siteName: "땅",
      outline: builder.rectangleOutline(300, 200),
      forSale: false,
      market: "general",
    });
    expect(card(land, site).primary).toMatchObject({ id: "build", label: "건물 올리기" });
  });

  test("a rack or a room that holds no servers has nothing of its own to do", () => {
    const rack = idx(filled).ofKind("rack")[0]?.id;
    expect(card(filled, inRoom, false, rack).primary).toBeUndefined();
    expect(card(filled, inRoom, false, rack).status).toMatch(/^서버 \d+대 · 빈 곳 \d+U$/);
  });
});

describe("the numbers over the picture are the ones an experiment runs on, and no money [REQ-077]", () => {
  test("racks, servers, heat against cooling, power left, in that order", () => {
    const stats = builder.levelStats(idx(filled), catalog, inRoom);
    const items = builder.hudItems(stats);
    expect(items.map((i) => i.label)).toEqual(["랙", "서버", "발열 / 냉방", "전원 여유"]);
    expect(items[0]?.value).toBe("24대");
    expect(items.map((i) => i.value).join(" ")).not.toMatch(/원/);
  });

  test("heat above cooling, or power over its limit, is marked", () => {
    const stats = builder.levelStats(idx(filled), catalog, inRoom);
    expect(builder.hudItems(stats).some((i) => i.bad)).toBe(false);
    const hot = builder.hudItems({ ...stats, coolingKw: 1 });
    expect(hot.find((i) => i.label === "발열 / 냉방")?.bad).toBe(true);
    const over = builder.hudItems({ ...stats, pduW: 1000, itMaxW: 5000 });
    expect(over.find((i) => i.label === "전원 여유")).toMatchObject({ bad: true });
    expect(over.find((i) => i.label === "전원 여유")?.value).toMatch(/^−/);
    const none = builder.hudItems(builder.levelStats(idx(small), catalog, inRoom));
    expect(none.find((i) => i.label === "전원 여유")?.value).toBe("아직 없어요");
  });
});

describe("저장은 자동 [REQ-077]", () => {
  const base = { mine: true, dirty: true, saving: false, errors: 0 };
  test("a change is saved on its own, by its owner, when it has no errors and nothing is in flight", () => {
    expect(builder.shouldAutosave(base)).toBe(true);
    expect(builder.shouldAutosave({ ...base, mine: false })).toBe(false);
    expect(builder.shouldAutosave({ ...base, dirty: false })).toBe(false);
    expect(builder.shouldAutosave({ ...base, saving: true })).toBe(false);
    expect(builder.shouldAutosave({ ...base, errors: 1 })).toBe(false);
  });

  test("the bar has one word for how the world stands", () => {
    const now = Date.parse("2026-11-06T09:00:30Z");
    const at = "2026-11-06T09:00:00Z";
    expect(builder.saveStatus({ ...base, dirty: false }, at, now)).toMatch(/^저장됨 · /);
    expect(builder.saveStatus({ ...base, saving: true }, at, now)).toBe("저장하는 중");
    expect(builder.saveStatus(base, at, now)).toBe("곧 저장돼요");
    expect(builder.saveStatus({ ...base, errors: 2 }, at, now)).toBe(
      "고칠 곳이 있어서 저장하지 못했어요",
    );
    expect(builder.saveStatus({ ...base, mine: false }, at, now)).toBe(
      "고친 것은 내 사본으로 저장해요",
    );
    expect(builder.AUTOSAVE_MS).toBeGreaterThan(500);
  });
});
