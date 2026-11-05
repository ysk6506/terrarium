import { Catalog } from "@terrarium/core/catalog";
import { type Blueprint, BlueprintIndex, floorSpace, isSizeLocked } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import {
  addBuilding,
  addFloor,
  addPiece,
  addRoom,
  assertPower,
  emptyWorld,
  fillRoom,
  floorNote,
  floorNoteText,
  handlePlan,
  handlesFor,
  type Level,
  moreRacksText,
  mountDevice,
  moveTo,
  outsideWays,
  placeEquipment,
  placeRack,
  Refusal,
  racksGainText,
  replaceEntity,
  resizeBody,
  roomSources,
  siteUse,
  siteUseText,
} from ".";

const catalog = new Catalog();
const at = (x: number, y: number) => ({ x, y, rotation: 0 as const });

/** A 60 x 40 m building (2,400 m²) with two floors; the lower one holds a 20 x 15 m server room. */
function world(locked: boolean) {
  let bp = emptyWorld("w", "시험", { w: 300, d: 200 }, "사업장");
  bp = addBuilding(bp, catalog, { x: 10, y: 10, w: 60, d: 40 }).blueprint;
  const index = () => new BlueprintIndex(bp);
  const buildingId = index().ofKind("building")[0]?.id as string;
  if (locked)
    bp = replaceEntity(bp, buildingId, (e) => ({ ...e, props: { ...e.props, sizeLocked: true } }));
  bp = addFloor(bp, buildingId).blueprint;
  const [one, two] = index().ofKind("floor");
  const floorId = one?.id as string;
  const upperId = two?.id as string;
  bp = addRoom(bp, catalog, floorId, { x: 3, y: 3, w: 20, d: 15 }).blueprint;
  const roomId = index().ofKind("room")[0]?.id as string;
  return {
    bp,
    buildingId,
    floorId,
    upperId,
    roomId,
    level: { kind: "floor", id: floorId } as Level,
  };
}

describe("a building of real size [REQ-076]", () => {
  test("it is locked by the generator's flag, has no handles, and cannot be resized, only moved", () => {
    const { bp, buildingId, level } = world(true);
    const index = new BlueprintIndex(bp);
    expect(isSizeLocked(index.entity(buildingId))).toBe(true);
    expect(handlesFor(index, { kind: "site" }, index.entity(buildingId))).toEqual([]);
    expect(handlesFor(index, level, index.entity(buildingId))).toEqual([]);
    expect(() => resizeBody(bp, catalog, buildingId, { x: 10, y: 10, w: 70, d: 40 })).toThrow(
      "실제 크기",
    );
    const moved = moveTo(bp, catalog, level, buildingId, 20, 20);
    expect(new BlueprintIndex(moved.blueprint).entity(buildingId).placement).toMatchObject({
      x: 20,
      w: 60,
    });
  });

  test("a building drawn by hand keeps its handles and can still be widened", () => {
    const { bp, buildingId } = world(false);
    const index = new BlueprintIndex(bp);
    expect(handlesFor(index, { kind: "site" }, index.entity(buildingId)).length).toBeGreaterThan(0);
    expect(resizeBody(bp, catalog, buildingId, { x: 10, y: 10, w: 70, d: 40 })).toBeDefined();
  });

  test("the panel line tells the size is real, and how much floor is left here and on the other floors", () => {
    const { bp, buildingId, floorId } = world(true);
    const index = new BlueprintIndex(bp);
    const note = floorNote(index, catalog, buildingId, floorId);
    expect(note?.locked).toBe(true);
    const text = floorNoteText(note as NonNullable<typeof note>);
    const here = floorSpace(index, catalog, floorId)?.freeM2 ?? 0;
    expect(text).toContain("이 건물은 실제 크기예요");
    expect(text).toContain(`이 층 빈 바닥 ${Math.round(here).toLocaleString("ko-KR")} m²`);
    expect(text).toContain("다른 층 2,112 m²");
    const plain = floorNote(new BlueprintIndex(world(false).bp), catalog, buildingId, floorId);
    expect(floorNoteText(plain as NonNullable<typeof plain>)).not.toContain("실제 크기");
  });
});

describe("a room grows only into the bare floor of its storey [REQ-076]", () => {
  test("it grows while there is bare floor and stops with the other floor's free floor named when there is none", () => {
    const { bp, roomId, floorId, upperId } = world(true);
    const wide = resizeBody(bp, catalog, roomId, { x: 3, y: 3, w: 40, d: 30 });
    expect(wide.blueprint).toBeDefined();
    try {
      resizeBody(bp, catalog, roomId, { x: 0, y: 0, w: 60, d: 39.6 });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(Refusal);
      expect((err as Refusal).message).toMatch(/^이 층은 꽉 찼어요\. .+에 2,112 m² 비어 있어요$/);
      expect((err as Refusal).way).toEqual({ kind: "other-floor", entityId: upperId });
    }
    expect(floorSpace(new BlueprintIndex(bp), catalog, floorId)?.overM2).toBe(0);
  });

  test("the core takes its share: a room cannot cover the whole floor, even inside the building", () => {
    const { bp, roomId } = world(true);
    expect(() => resizeBody(bp, catalog, roomId, { x: 0, y: 0, w: 57.6, d: 39.6 })).toThrow(
      /이 층은 꽉 찼어요/,
    );
    const open = world(false);
    expect(() =>
      resizeBody(open.bp, catalog, open.roomId, { x: 0, y: 0, w: 57.6, d: 39.6 }),
    ).toThrow("건물이 꽉 찼어요. 건물을 넓혀요");
  });

  test("a piece, and a new room, are held to the same bare floor", () => {
    const { bp, roomId, floorId } = world(true);
    const crowded = addRoom(bp, catalog, floorId, { x: 24, y: 0, w: 36, d: 39.6 }).blueprint;
    expect(() => addPiece(crowded, catalog, roomId, "bottom", { along: 20, out: 21.6 })).toThrow(
      /이 층은 꽉 찼어요/,
    );
    expect(() => addRoom(crowded, catalog, floorId, { x: 3, y: 20, w: 20.4, d: 19.8 })).toThrow(
      /이 층은 꽉 찼어요/,
    );
    expect(addRoom(bp, catalog, floorId, { x: 24, y: 3, w: 20, d: 20 }).blueprint).toBeDefined();
  });

  test("a floor with no free floor on any other storey says so, with no way on", () => {
    const { bp, roomId, upperId } = world(true);
    const upper = addRoom(bp, catalog, upperId, { x: 0, y: 0, w: 60, d: 34 }).blueprint;
    const upperRoom = new BlueprintIndex(upper).childrenOf(upperId, "room")[0]?.id as string;
    // the room is made exactly as big as the storey allows: 60 x 35.2 m, so that not a rack's worth is left
    const full = replaceEntity(upper, upperRoom, (e) => ({
      ...e,
      placement: { type: "area", x: 0, y: 0, w: 60, d: 35.2 },
    }));
    try {
      resizeBody(full, catalog, roomId, { x: 0, y: 0, w: 60, d: 39.6 });
      expect.unreachable();
    } catch (err) {
      expect(err).not.toBeInstanceOf(Refusal);
      expect((err as Error).message).toBe(
        "이 층은 꽉 찼어요. 이 건물의 다른 층에도 빈 바닥이 없어요",
      );
    }
  });

  test("dragging a handle stops where the bare floor ends, applies as far as it went, and keeps the reason", () => {
    const { bp, roomId, floorId, upperId } = world(true);
    // a second room takes the right of the storey from top to bottom, so the floor runs out before the wall does
    const filled = addRoom(bp, catalog, floorId, { x: 24, y: 0, w: 36, d: 39.6 }).blueprint;
    const level: Level = { kind: "floor", id: floorId };
    const index = new BlueprintIndex(filled);
    const bottom = handlesFor(index, level, index.entity(roomId)).find((h) => h.key === "0:bottom");
    const plan = handlePlan(
      { bp: filled, index, catalog, level },
      bottom as never,
      (bottom as never as { at: { x: number; y: number } }).at,
      {
        x: 13,
        y: 100,
      },
    );
    expect(plan?.problem).toBeUndefined();
    expect(plan?.edit).toBeDefined();
    expect(plan?.label).toContain("여기가 끝이에요");
    expect(plan?.stopped?.message).toMatch(/^이 층은 꽉 찼어요\. .+에 [\d,]+ m² 비어 있어요$/);
    expect(plan?.stopped?.way).toEqual({ kind: "other-floor", entityId: upperId });
    const rect = plan?.rect;
    expect(rect && rect.d > 15 && rect.d < 37).toBe(true);
    const grown = floorSpace(
      new BlueprintIndex(plan?.edit?.blueprint as Blueprint),
      catalog,
      floorId,
    );
    expect(grown?.overM2).toBe(0);
    expect(racksGainText(filled, plan?.edit?.blueprint as Blueprint, roomId)).toMatch(
      /랙 \d+대가 더 들어가요/,
    );
  });

  test("a drag that meets the wall while the floor still has bare floor says so, not that the floor is full", () => {
    const { bp, roomId, level } = world(true);
    const index = new BlueprintIndex(bp);
    const right = handlesFor(index, level, index.entity(roomId)).find((h) => h.key === "0:right");
    const plan = handlePlan(
      { bp, index, catalog, level },
      right as never,
      { x: 23, y: 10 },
      { x: 223, y: 10 },
    );
    expect(plan?.stopped?.message).toMatch(
      /^건물 벽에 닿았어요\. 이 층 빈 바닥 [\d,]+ m²는 다른 쪽에 있어요$/,
    );
    expect(plan?.rect?.w).toBeCloseTo(57, 5);
  });

  test("a room made bigger says how many racks more it takes, a rack to 2.6 m²", () => {
    expect(moreRacksText(26)).toBe("랙 10대가 더 들어가요");
    expect(moreRacksText(2.5)).toBeUndefined();
    const { bp, roomId, level } = world(true);
    const body = new BlueprintIndex(bp).entity(roomId).placement as {
      x: number;
      y: number;
      w: number;
      d: number;
    };
    const grown = resizeBody(bp, catalog, roomId, { ...body, w: 30 });
    const gained = (30 - body.w) * body.d;
    expect(racksGainText(bp, grown.blueprint, roomId)).toBe(
      `랙 ${Math.floor(gained / 2.6)}대가 더 들어가요`,
    );
    expect(racksGainText(grown.blueprint, bp, roomId)).toBeUndefined();
    const index = new BlueprintIndex(bp);
    const right = handlesFor(index, level, index.entity(roomId)).find((h) => h.key === "0:right");
    const plan = handlePlan(
      { bp, index, catalog, level },
      right as never,
      { x: 23, y: 10 },
      { x: 33, y: 10 },
    );
    expect(plan?.label).toMatch(/랙 \d+대가 더 들어가요/);
  });
});

describe("a site has the power its connection gives [REQ-076]", () => {
  const withCapacity = (mw: number, estimated = false) => {
    const w = world(false);
    const siteId = new BlueprintIndex(w.bp).ofKind("site")[0]?.id as string;
    const bp = replaceEntity(w.bp, siteId, (e) => ({
      ...e,
      props: {
        ...e.props,
        powerCapacityMW: mw,
        ...(estimated ? { powerCapacityEstimated: true } : {}),
      },
    }));
    return { ...w, bp };
  };

  test("a world with no capacity has no limit, and one with a capacity says how much is in use", () => {
    const plain = world(false);
    expect(siteUse(plain.bp, catalog)).toBeUndefined();
    const { bp } = withCapacity(2, true);
    const use = siteUse(bp, catalog);
    expect(use?.usedW).toBe(0);
    expect(siteUseText(use as NonNullable<typeof use>)).toBe("2 MW(추정) 중 0 W");
  });

  test("a machine that would take the site past its capacity is refused with how much is in use", () => {
    const model = catalog.getOf("srv-2u-compute", "server");
    const oneW = model.idlePowerW + (model.maxPowerW - model.idlePowerW) * 0.6;
    // room for one server and not for two
    const { bp: empty, roomId } = withCapacity((oneW * 1.5) / 1e6);
    const bp = placeRack(empty, catalog, roomId, at(1.2, 1.2)).blueprint;
    const rackId = new BlueprintIndex(bp).ofKind("rack")[0]?.id as string;
    const one = mountDevice(bp, catalog, rackId, "srv-2u-compute").blueprint;
    expect(siteUse(one, catalog)?.usedW).toBeCloseTo(oneW, 6);
    expect(() => mountDevice(one, catalog, rackId, "srv-2u-compute")).toThrow(
      /^전력이 모자라요\. \d+ W 중 \d+ W를 쓰고 있어요 \(이 변경은 \d+ W를 더 써요\)$/,
    );
  });

  test("a site with room to spare takes the machine, and taking power away is never refused", () => {
    const { bp, roomId } = withCapacity(108);
    const rack = placeRack(bp, catalog, roomId, at(1.2, 1.2)).blueprint;
    const rackId = new BlueprintIndex(rack).ofKind("rack")[0]?.id as string;
    const one = mountDevice(rack, catalog, rackId, "srv-2u-compute").blueprint;
    expect(siteUse(one, catalog)?.usedW).toBeGreaterThan(0);
    expect(() => assertPower(one, rack, catalog)).not.toThrow();
  });

  test("filling a server room and placing a cooling unit go through the same check", () => {
    const { bp, roomId } = withCapacity(0.0005);
    expect(() =>
      fillRoom(bp, catalog, roomId, { aisle: "cold", load: "typical" } as never),
    ).toThrow(/전력이 모자라요/);
    expect(() =>
      placeEquipment(bp, catalog, { kind: "room", id: roomId }, "cv-crah-120kw-chw", at(5, 5)),
    ).toThrow(/전력이 모자라요/);
  });
});

describe("where a room's cooling and power come from [REQ-076]", () => {
  test("it lists the units that cool and feed the racks with where they stand, and the ways to put more outside the room", () => {
    const { bp, roomId, floorId } = world(true);
    let next = addRoom(bp, catalog, floorId, { x: 26, y: 3, w: 12, d: 9 }, "mechanical").blueprint;
    next = addRoom(next, catalog, floorId, { x: 26, y: 14, w: 12, d: 9 }, "electrical").blueprint;
    const index = new BlueprintIndex(next);
    const mech = index.ofKind("room").find((r) => r.props.purpose === "mechanical");
    const placed = placeEquipment(
      next,
      catalog,
      { kind: "room", id: mech?.id as string },
      "aq-cdu-500kw",
      at(1, 1),
    );
    const sources = roomSources(new BlueprintIndex(placed.blueprint), catalog, roomId);
    expect(sources).toEqual({ cooling: [], power: [] });
    const ways = outsideWays(index, roomId, "cooling");
    expect(ways.map((w) => w.label)).toEqual([
      "기계실 A에 냉각 설비 놓기",
      "건물 밖 마당에 냉각 플랜트 놓기",
    ]);
    expect(ways[0]?.level).toEqual({ kind: "room", id: mech?.id });
    expect(ways.at(-1)?.tool).toEqual({ kind: "plant", modelId: "gl-chiller-screw-1mw" });
    expect(outsideWays(index, roomId, "power")[0]?.tool).toEqual({
      kind: "equipment",
      modelId: "sy-switchgear-2000a",
    });
  });
});
