import { Catalog } from "@terrarium/core/catalog";
import { RACK_WIDTH_M } from "@terrarium/core/kernel";
import {
  type Blueprint,
  BlueprintIndex,
  hasErrors,
  validateBlueprint,
} from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import {
  addBuilding,
  addContainment,
  addFloor,
  addRoom,
  autoWireRack,
  autoWireRoom,
  candidates,
  crumbs,
  EditError,
  elevation,
  emptyWorld,
  firstFreeU,
  History,
  heatColor,
  type Level,
  levelArea,
  levelEntities,
  levelOf,
  levelStats,
  link,
  linkKindsFrom,
  linkProblem,
  mountDevice,
  moveTo,
  nextId,
  placeEquipment,
  placementProblem,
  placeRack,
  placeRackRow,
  preview,
  remount,
  remove,
  rename,
  resizeArea,
  rotate,
  sameLevel,
  sceneOf,
  setModel,
  setProp,
  snapRect,
  snapSpot,
  startLevel,
  unlink,
} from ".";

const catalog = new Catalog();
const at = (x: number, y: number, rotation: 0 | 90 | 180 | 270 = 0) => ({ x, y, rotation });

/** A small hall built step by step the way a person would in the builder. */
function hall() {
  let bp = emptyWorld("w", "시험 홀", { w: 200, d: 150 }, "평택사업장");
  bp = addBuilding(bp, catalog, { x: 10, y: 10, w: 40, d: 30 }).blueprint;
  const index0 = new BlueprintIndex(bp);
  const floorId = index0.ofKind("floor")[0]?.id as string;
  bp = addRoom(bp, catalog, floorId, { x: 1.2, y: 1.2, w: 18, d: 12 }).blueprint;
  const roomId = new BlueprintIndex(bp).ofKind("room")[0]?.id as string;
  const room: Level = { kind: "room", id: roomId };
  const row = placeRackRow(bp, catalog, roomId, at(2.4, 3.6), 4);
  bp = row.blueprint;
  bp = placeEquipment(bp, catalog, room, "crah-100kw", at(2.4, 9)).blueprint;
  bp = placeEquipment(bp, catalog, room, "panel-400a", at(14.4, 0.6)).blueprint;
  bp = placeEquipment(bp, catalog, room, "panel-400a", at(15.6, 0.6)).blueprint;
  bp = placeEquipment(
    bp,
    catalog,
    { kind: "floor", id: floorId },
    "ups-500kva",
    at(30, 20),
  ).blueprint;
  for (const rack of row.select) {
    bp = mountDevice(bp, catalog, rack, "pdu-17kw").blueprint;
    bp = mountDevice(bp, catalog, rack, "pdu-17kw").blueprint;
    bp = mountDevice(bp, catalog, rack, "sw-tor-48x25g", 42).blueprint;
    for (let i = 0; i < 4; i++) bp = mountDevice(bp, catalog, rack, "srv-2u-compute").blueprint;
  }
  return { bp, floorId, roomId, room, racks: row.select };
}

describe("building a world by hand [REQ-006] [REQ-005]", () => {
  test("site → building → room → racks, equipment and devices, then wired, is a valid world", () => {
    const { bp, roomId, racks } = hall();
    const wired = autoWireRoom(bp, catalog, roomId);
    expect(wired.added).toBeGreaterThan(20);
    const issues = validateBlueprint(wired.blueprint, catalog);
    expect(hasErrors(issues), JSON.stringify(issues.filter((i) => i.severity === "error"))).toBe(
      false,
    );
    const index = new BlueprintIndex(wired.blueprint);
    const server = index.childrenOf(racks[0] as string, "server")[0]?.id as string;
    expect(
      index
        .outgoing(server, "power")
        .map((l) => index.entity(l.to).name)
        .sort(),
    ).toEqual(["PDU A", "PDU B"]);
    expect(index.outgoing(server, "network")).toHaveLength(1);
    expect(index.outgoing(racks[0] as string, "cooling")).toHaveLength(1);
    const pdus = index.childrenOf(racks[0] as string, "pdu");
    const panels = pdus.map((p) => index.outgoing(p.id, "power")[0]?.to);
    expect(new Set(panels).size).toBe(2);
    const panel = panels[0] as string;
    expect(index.entity(index.outgoing(panel, "power")[0]?.to as string).kind).toBe("ups");
    // Wiring again adds nothing.
    expect(autoWireRoom(wired.blueprint, catalog, roomId).added).toBe(0);
  });

  test("the running world shows where it is hot", () => {
    const { bp, roomId } = hall();
    const result = preview(autoWireRoom(bp, catalog, roomId).blueprint, catalog, 300);
    if ("problems" in result) throw new Error(result.problems.join("; "));
    expect(result.heat.size).toBe(4);
    expect(result.hottest?.inletC).toBeGreaterThan(15);
    expect(result.rooms.get(roomId)).toBeGreaterThan(15);
    const broken = preview(
      {
        ...bp,
        entities: [
          ...bp.entities,
          { id: "x", kind: "rack", name: "x", parentId: "nope", props: {} },
        ],
      },
      catalog,
    );
    expect("problems" in broken && broken.problems.length).toBeGreaterThan(0);
  });

  test("names and ids follow the kind; rooms get letters", () => {
    const { bp, floorId } = hall();
    const index = new BlueprintIndex(bp);
    expect(index.ofKind("rack").map((r) => r.name)).toEqual(["랙 1", "랙 2", "랙 3", "랙 4"]);
    expect(index.ofKind("cooling_unit")[0]?.name).toBe("항온항습기 1");
    expect(index.ofKind("room")[0]?.name).toBe("서버룸 A");
    expect(nextId(index, "rack")).toBe("rack-5");
    const second = addRoom(bp, catalog, floorId, { x: 22, y: 1.2, w: 10, d: 10 });
    expect(new BlueprintIndex(second.blueprint).entity(second.select[0] as string).name).toBe(
      "서버룸 B",
    );
    expect(addFloor(bp, index.ofKind("building")[0]?.id as string).select).toEqual(["fl-2"]);
    expect(new BlueprintIndex(addFloor(bp, "bld-1").blueprint).entity("fl-2").name).toBe("2층");
  });

  test("things cannot overlap, leave their space, or be turned into a wall", () => {
    const { bp, room, roomId } = hall();
    expect(placementProblem(bp, catalog, room, undefined, at(2.4, 3.6))).toBe("랙 1과 겹쳐요");
    expect(placementProblem(bp, catalog, room, undefined, at(17.8, 3.6))).toBe(
      "이 자리가 들어갈 자리를 벗어나요",
    );
    expect(placementProblem(bp, catalog, room, undefined, at(6, 6))).toBeUndefined();
    expect(() => placeRackRow(bp, catalog, roomId, at(0.6, 3.6), 4)).toThrow(
      "4번째 랙: 랙 1과 겹쳐요",
    );
    expect(() => placeRackRow(bp, catalog, roomId, at(6, 6), 0)).toThrow(EditError);
    expect(() => placeRack(bp, catalog, roomId, at(2.4, 3.6))).toThrow("랙 1과 겹쳐요");
    expect(() => placeEquipment(bp, catalog, { kind: "site" }, "crah-100kw", at(1, 1))).toThrow(
      "설비는 건물 안에 둬요",
    );
    expect(() =>
      placeEquipment(bp, catalog, { kind: "floor", id: "fl-1" }, "crah-100kw", at(1, 1)),
    ).toThrow("냉방기는 서버룸 안에 둬요");
    expect(() => placeEquipment(bp, catalog, room, "srv-1u-compute", at(6, 6))).toThrow(
      "바닥에 세우는 설비가 아니에요",
    );
    expect(() => addBuilding(bp, catalog, { x: 20, y: 20, w: 20, d: 20 })).toThrow(
      "건물 1과 겹쳐요",
    );
    expect(() => addRoom(bp, catalog, "fl-1", { x: 2, y: 2, w: 5, d: 5 })).toThrow(
      "서버룸 A와 겹쳐요",
    );
    expect(() =>
      addBuilding(emptyWorld("w", "w", { w: 10, d: 10 }), catalog, { x: 0, y: 0, w: 50, d: 50 }),
    ).toThrow("벗어나요");
  });

  test("move, turn, rename, re-model and remove — with everything inside and every cable", () => {
    const { bp, room, roomId, racks } = hall();
    const rack = racks[3] as string;
    const moved = moveTo(bp, catalog, room, rack, 10.2, 3.6);
    expect(new BlueprintIndex(moved.blueprint).entity(rack).placement).toMatchObject({
      x: 10.2,
      y: 3.6,
    });
    expect(() => moveTo(bp, catalog, room, rack, 2.4, 3.6)).toThrow("랙 1과 겹쳐요");
    expect(() => moveTo(bp, catalog, room, "srv-1", 1, 1)).toThrow("옮길 수 없어요");
    const turned = rotate(moved.blueprint, catalog, room, rack);
    expect(new BlueprintIndex(turned.blueprint).entity(rack).placement).toMatchObject({
      rotation: 90,
    });
    expect(() => rotate(bp, catalog, room, racks[1] as string)).toThrow("돌리면");
    expect(() => rotate(bp, catalog, room, roomId)).toThrow("돌릴 수 없어요");
    const wide = resizeArea(bp, catalog, roomId, { x: 1.2, y: 1.2, w: 24, d: 12 });
    expect(new BlueprintIndex(wide.blueprint).entity(roomId).placement).toMatchObject({ w: 24 });
    expect(() => resizeArea(bp, catalog, roomId, { x: 1.2, y: 1.2, w: 4, d: 4 })).toThrow(
      "밖으로 나가게 돼요",
    );
    expect(() => resizeArea(bp, catalog, rack, { x: 0, y: 0, w: 1, d: 1 })).toThrow(
      "크기를 바꿀 수 없어요",
    );
    expect(
      moveTo(bp, catalog, { kind: "floor", id: "fl-1" }, roomId, 1.8, 1.2).blueprint,
    ).toBeDefined();
    expect(new BlueprintIndex(rename(bp, rack, " 코어 랙 ").blueprint).entity(rack).name).toBe(
      "코어 랙",
    );
    expect(() => rename(bp, rack, "  ")).toThrow("이름을 적어 주세요");
    expect(() => rename(bp, rack, "x".repeat(61))).toThrow("60자까지예요");
    expect(
      new BlueprintIndex(setProp(bp, rack, "units", 48).blueprint).entity(rack).props.units,
    ).toBe(48);
    const server = new BlueprintIndex(bp).childrenOf(rack, "server")[0]?.id as string;
    expect(
      new BlueprintIndex(setModel(bp, catalog, server, "srv-1u-compute").blueprint).entity(server)
        .modelId,
    ).toBe("srv-1u-compute");
    expect(() => setModel(bp, catalog, server, "pdu-11kw")).toThrow("서버 모델이 아니에요");
    const wired = autoWireRoom(bp, catalog, roomId).blueprint;
    const gone = remove(wired, [rack]).blueprint;
    const index = new BlueprintIndex(gone);
    expect(index.find(rack)).toBeUndefined();
    expect(index.find(server)).toBeUndefined();
    expect(gone.links.some((l) => l.from === server || l.to === rack)).toBe(false);
    expect(() => remove(bp, ["site-1"])).toThrow("사업장은 지울 수 없어요");
    expect(remove(bp, ["nope"]).blueprint.entities).toHaveLength(bp.entities.length);
  });

  test("containments wrap the racks under them", () => {
    const { bp, roomId, racks } = hall();
    const made = addContainment(bp, catalog, roomId, { x: 2.4, y: 3.6, w: 2.4, d: 2.4 }, "cold");
    const index = new BlueprintIndex(made.blueprint);
    const containment = index.entity(made.select[0] as string);
    expect(containment).toMatchObject({ name: "냉복도 1", props: { aisle: "cold" } });
    expect(index.childrenOf(containment.id, "rack").map((r) => r.id)).toEqual(racks);
    expect(
      levelEntities(index, { kind: "room", id: roomId }).filter((e) => e.kind === "rack"),
    ).toHaveLength(4);
    const next = placeRack(made.blueprint, catalog, roomId, at(2.4, 4.8));
    expect(new BlueprintIndex(next.blueprint).entity(next.select[0] as string).parentId).toBe(
      containment.id,
    );
    expect(() =>
      addContainment(made.blueprint, catalog, roomId, { x: 3, y: 3.6, w: 2.4, d: 2.4 }, "hot"),
    ).toThrow("겹쳐요");
  });
});

describe("a rack's front [REQ-006]", () => {
  test("units, free runs, PDUs and the power budget", () => {
    const { bp, racks } = hall();
    const index = new BlueprintIndex(bp);
    const ev = elevation(index, catalog, racks[0] as string);
    expect(ev.units).toBe(42);
    expect(ev.pdus.map((p) => p.name)).toEqual(["PDU A", "PDU B"]);
    expect(ev.slots[0]).toMatchObject({
      u: 42,
      height: 1,
      device: { name: expect.stringMatching(/^스위치/) },
    });
    expect(ev.slots.filter((s) => s.device).map((s) => s.u)).toEqual([42, 7, 5, 3, 1]);
    expect(ev.freeUnits).toBe(42 - 1 - 8);
    expect(ev.demandW).toBe(4 * 750 + 350);
    expect(ev.supplyW).toBe(17_300);
    expect(firstFreeU(index, catalog, racks[0] as string, 2)).toBe(9);
  });

  test("devices go where they fit, and say why when they do not", () => {
    const { bp, racks } = hall();
    const rack = racks[0] as string;
    expect(() => mountDevice(bp, catalog, rack, "pdu-11kw")).toThrow("둘(A, B)까지예요");
    expect(() => mountDevice(bp, catalog, rack, "srv-4u-gpu", 41)).toThrow(
      "42U 안에 들어가지 않아요",
    );
    expect(() => mountDevice(bp, catalog, rack, "srv-2u-compute", 2)).toThrow(
      /^U2에 서버 \d+[이가] 있어요$/,
    );
    expect(() => mountDevice(bp, catalog, rack, "crah-100kw")).toThrow("랙에 다는 장비가 아니에요");
    expect(() => mountDevice(bp, catalog, "room-1", "srv-1u-compute")).toThrow(
      "장비는 랙에 달아요",
    );
    let full = bp;
    for (let i = 0; i < 16; i++)
      full = mountDevice(full, catalog, rack, "srv-2u-compute").blueprint;
    expect(() => mountDevice(full, catalog, rack, "srv-2u-compute")).toThrow(
      "2U가 비어 있는 곳이 없어요",
    );
    const server = new BlueprintIndex(bp).childrenOf(rack, "server")[0]?.id as string;
    const up = remount(bp, catalog, server, 20);
    expect(new BlueprintIndex(up.blueprint).entity(server).placement).toEqual({
      type: "unit",
      u: 20,
    });
    expect(() => remount(bp, catalog, server, 42)).toThrow("42U 안에 들어가지 않아요");
    expect(() => remount(bp, catalog, server, 3)).toThrow(/^U3에 서버/);
  });
});

describe("cables [REQ-006] [REQ-005]", () => {
  test("what a thing can plug into, nearest first, and why some links are not allowed", () => {
    const { bp, racks } = hall();
    const index = new BlueprintIndex(bp);
    const server = index.childrenOf(racks[0] as string, "server")[0]?.id as string;
    const power = candidates(index, catalog, server, "power");
    expect(power[0]?.entity.parentId).toBe(racks[0]);
    expect(power.map((c) => c.entity.kind)).toContain("power_panel");
    expect(linkKindsFrom("server").sort()).toEqual(["member_of", "network", "power"]);
    expect(linkKindsFrom("rack")).toEqual(["cooling"]);
    expect(linkProblem(index, "power", server, server)).toBe("자기 자신에게는 연결할 수 없어요");
    expect(linkProblem(index, "cooling", server, "cu-1")).toBe(
      "서버에서 냉방기로는 이 연결을 만들 수 없어요",
    );
    expect(linkProblem(index, "power", "nope", server)).toBe("없는 장비예요");
    const linked = link(bp, "power", "panel-1", "ups-1").blueprint;
    expect(linkProblem(new BlueprintIndex(linked), "power", "panel-1", "ups-1")).toBe(
      "이미 연결되어 있어요",
    );
    const loop = link(
      link(bp, "power", "pdu-1", "panel-1").blueprint,
      "power",
      "panel-1",
      "ups-1",
    ).blueprint;
    expect(() => link(loop, "power", "ups-1", "pdu-1")).toThrow();
    const id = linked.links.at(-1)?.id as string;
    expect(unlink(linked, id).blueprint.links).toHaveLength(bp.links.length);
    expect(unlink(bp, "nope").select).toEqual([]);
  });

  test("one rack can be wired on its own", () => {
    const { bp, racks } = hall();
    const result = autoWireRack(bp, catalog, racks[1] as string);
    expect(result.added).toBe(4 * 2 + 1 * 2 + 4 + 1);
    expect(autoWireRack(result.blueprint, catalog, racks[1] as string).added).toBe(0);
  });
});

describe("levels and the way back up [REQ-006]", () => {
  test("each thing lives on a level; crumbs lead back to the site", () => {
    const { bp, floorId, roomId, racks } = hall();
    const index = new BlueprintIndex(bp);
    expect(levelOf(index, racks[0] as string)).toEqual({ kind: "room", id: roomId });
    expect(levelOf(index, "ups-1")).toEqual({ kind: "floor", id: floorId });
    expect(levelOf(index, "bld-1")).toEqual({ kind: "floor", id: floorId });
    expect(levelOf(index, "site-1")).toEqual({ kind: "site" });
    expect(levelOf(index, "nope")).toEqual({ kind: "site" });
    expect(startLevel(index)).toEqual({ kind: "room", id: roomId });
    expect(startLevel(new BlueprintIndex(emptyWorld("w", "w", { w: 1, d: 1 })))).toEqual({
      kind: "site",
    });
    expect(crumbs(index, { kind: "room", id: roomId }).map((c) => c.label)).toEqual([
      "평택사업장",
      "건물 1 1층",
      "서버룸 A",
    ]);
    expect(levelArea(index, catalog, { kind: "floor", id: floorId })).toEqual({
      x: 0,
      y: 0,
      w: 40,
      d: 30,
    });
    expect(levelArea(index, catalog, { kind: "site" })).toEqual({ x: 0, y: 0, w: 200, d: 150 });
    expect(sameLevel({ kind: "room", id: "a" }, { kind: "room", id: "a" })).toBe(true);
    expect(sameLevel({ kind: "site" }, { kind: "room", id: "a" })).toBe(false);
    expect(snapRect({ x: 3, y: 3, w: -2, d: 7 }, 5, 5)).toEqual({ x: 0, y: 5, w: 5, d: 5 });
    expect(snapSpot(2.5, 3.7, 90)).toEqual({ x: 2.4, y: 3.6, rotation: 90 });
  });
});

describe("totals and warnings, tycoon style [REQ-006]", () => {
  test("cost, heat against cooling, and what is not connected", () => {
    const { bp, room, roomId } = hall();
    const index = new BlueprintIndex(bp);
    const stats = levelStats(index, catalog, room);
    expect(stats.racks).toBe(4);
    expect(stats.servers).toBe(16);
    expect(stats.coolingKw).toBe(100);
    expect(stats.costM).toBeGreaterThan(0);
    expect(stats.warnings).toContain(`전원에 연결되지 않은 장비가 20대 있어요`);
    const wired = levelStats(
      new BlueprintIndex(autoWireRoom(bp, catalog, roomId).blueprint),
      catalog,
      room,
    );
    expect(wired.warnings).toEqual([]);
    const noCooling = remove(bp, ["cu-1"]).blueprint;
    expect(levelStats(new BlueprintIndex(noCooling), catalog, room).warnings[0]).toBe(
      "냉방기가 없어 장비의 열을 식힐 수 없어요",
    );
    expect(levelStats(index, catalog, { kind: "site" }).racks).toBe(4);
  });
});

describe("the 3D scene stays light [REQ-036]", () => {
  function bigRoom(racks: number): Blueprint {
    const side = Math.ceil(Math.sqrt(racks));
    const bp = emptyWorld("big", "큰 홀", { w: 500, d: 500 });
    const entities = [
      ...bp.entities,
      {
        id: "bld-1",
        kind: "building",
        name: "건물 1",
        parentId: "site-1",
        placement: { type: "area", x: 0, y: 0, w: 200, d: 200 },
        props: {},
      },
      {
        id: "fl-1",
        kind: "floor",
        name: "1층",
        parentId: "bld-1",
        placement: { type: "level", level: 1, height: 4.5 },
        props: {},
      },
      {
        id: "room-1",
        kind: "room",
        name: "서버룸 A",
        parentId: "fl-1",
        placement: { type: "area", x: 0, y: 0, w: 190, d: 190 },
        props: {},
      },
    ] as Blueprint["entities"][number][];
    for (let i = 0; i < racks; i++)
      entities.push({
        id: `rack-${i + 1}`,
        kind: "rack",
        name: `랙 ${i + 1}`,
        parentId: "room-1",
        placement: {
          type: "spot",
          x: (i % side) * RACK_WIDTH_M * 1.5,
          y: Math.floor(i / side) * 2.4,
          rotation: 0,
        },
        props: {},
      });
    return { ...bp, entities };
  }

  test("2,000 racks are one draw call, built well within a frame budget", () => {
    const small = sceneOf(new BlueprintIndex(bigRoom(2)), catalog, { kind: "room", id: "room-1" });
    const bp = bigRoom(2000);
    const index = new BlueprintIndex(bp);
    const started = performance.now();
    const scene = sceneOf(index, catalog, { kind: "room", id: "room-1" });
    const ms = performance.now() - started;
    expect(scene.groups.length).toBe(small.groups.length);
    const racks = scene.groups.find((g) => g.key === "rack");
    expect(racks?.ids).toHaveLength(2000);
    expect(racks?.boxes).toHaveLength(2000 * 6);
    expect(racks?.colors).toHaveLength(2000 * 3);
    expect(ms).toBeLessThan(1000);
    const where = scene.where.get("rack-2000");
    expect(where?.group).toBe("rack");
    expect(racks?.ids[where?.index ?? -1]).toBe("rack-2000");
  });

  test("heat and alarms recolour without changing the shape of the scene", () => {
    const { bp, room } = hall();
    const index = new BlueprintIndex(bp);
    const plain = sceneOf(index, catalog, room);
    const hot = sceneOf(index, catalog, room, {
      heat: new Map([["rack-1", 35]]),
      alarmed: new Set(["cu-1"]),
    });
    expect(hot.groups.map((g) => g.key)).toEqual(plain.groups.map((g) => g.key));
    const rack = hot.groups.find((g) => g.key === "rack");
    expect(Array.from(rack?.colors.slice(0, 3) ?? []).map((c) => Math.round(c * 255))).toEqual([
      196, 61, 43,
    ]);
    const cooling = hot.groups.find((g) => g.key === "cooling_unit");
    expect(Math.round((cooling?.colors[0] ?? 0) * 255)).toBe(196);
    expect(heatColor(10)).toEqual(heatColor(18));
    expect(
      heatColor(26).every(
        (c, i) => c >= Math.min(heatColor(24)[i] as number, heatColor(28)[i] as number) - 1e-9,
      ),
    ).toBe(true);
    const site = sceneOf(index, catalog, { kind: "site" });
    expect(site.groups.map((g) => g.key)).toEqual(["building"]);
    expect(site.labels[0]).toMatchObject({ text: "건물 1" });
    const floor = sceneOf(index, catalog, { kind: "floor", id: "fl-1" });
    expect(floor.groups.map((g) => g.key).sort()).toEqual(["room", "ups"]);
  });
});

describe("undo and redo [REQ-041]", () => {
  test("go back and forth; a new change drops what was undone", () => {
    const h = new History(1, 3);
    expect(h.undo()).toBe(1);
    h.push(2);
    h.push(3);
    h.push(3);
    expect(h.canUndo).toBe(true);
    expect(h.undo()).toBe(2);
    expect(h.canRedo).toBe(true);
    expect(h.redo()).toBe(3);
    expect(h.redo()).toBe(3);
    h.undo();
    h.push(9);
    expect(h.canRedo).toBe(false);
    for (let i = 10; i < 20; i++) h.push(i);
    let steps = 0;
    while (h.canUndo) {
      h.undo();
      steps++;
    }
    expect(steps).toBe(3);
    h.reset(0);
    expect([h.current, h.canUndo, h.canRedo]).toEqual([0, false, false]);
  });
});
