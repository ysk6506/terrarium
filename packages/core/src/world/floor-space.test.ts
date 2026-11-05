import { Catalog } from "@terrarium/core/catalog";
import { describe, expect, test } from "vitest";
import {
  type Blueprint,
  BlueprintIndex,
  bareRects,
  buildingFloorSpaces,
  CORE_SHARE,
  designDrawW,
  type Entity,
  emptyBlueprint,
  floorSpace,
  isSizeLocked,
  powerCapacityOf,
  RACK_AREA_M2,
  racksThatFit,
  roomiestOtherFloor,
  siteDrawW,
  WHITE_FLOOR_SHARE,
} from ".";

const catalog = new Catalog();

const area = (
  id: string,
  kind: Entity["kind"],
  parentId: string,
  r: number[],
  props = {},
): Entity => ({
  id,
  kind,
  name: id,
  parentId,
  placement: {
    type: "area",
    x: r[0] as number,
    y: r[1] as number,
    w: r[2] as number,
    d: r[3] as number,
  },
  props,
});

/** A site with a 40 x 30 m building of two floors; the lower floor has a 12 x 9 hall and a 20 x 10 cleanroom bay. */
function world(buildingProps: Record<string, string | number | boolean> = {}): Blueprint {
  const bp = emptyBlueprint("w", "시험");
  const level = (id: string, n: number): Entity => ({
    id,
    kind: "floor",
    name: `${n}층`,
    parentId: "b1",
    placement: { type: "level", level: n, height: 4.5 },
    props: {},
  });
  return {
    ...bp,
    entities: [
      {
        id: "s",
        kind: "site",
        name: "사업장",
        placement: { type: "land", w: 200, d: 150 },
        props: {},
      },
      area("b1", "building", "s", [10, 10, 40, 30], buildingProps),
      level("f1", 1),
      level("f2", 2),
      area("hall", "room", "f1", [3, 3, 12, 9]),
      area("bay", "room", "f1", [20, 3, 20, 10], { purpose: "cleanroom" }),
    ],
  };
}

describe("the bare floor of a storey [REQ-076]", () => {
  test("the floor less the bays, the rooms and the core is what a room may still take", () => {
    const space = floorSpace(new BlueprintIndex(world()), catalog, "f1");
    expect(space).toMatchObject({ floorM2: 1200, bayM2: 200, roomsM2: 108 });
    expect(space?.coreM2).toBeCloseTo(1200 * CORE_SHARE, 9);
    expect(space?.freeM2).toBeCloseTo(1200 - 200 - 108 - 1200 * CORE_SHARE, 9);
    expect(space?.overM2).toBe(0);
  });

  test("an empty storey has only the core taken, and a storey that is not one has no numbers", () => {
    const index = new BlueprintIndex(world());
    expect(floorSpace(index, catalog, "f2")?.freeM2).toBeCloseTo(1200 * (1 - CORE_SHARE), 9);
    expect(floorSpace(index, catalog, "hall")).toBeUndefined();
    expect(floorSpace(index, catalog, "nowhere")).toBeUndefined();
  });

  test("rooms past what the floor allows leave no free floor and say by how much", () => {
    const bp = world();
    const crowded: Blueprint = {
      ...bp,
      entities: [...bp.entities, area("big", "room", "f1", [0, 0, 40, 30])],
    };
    const space = floorSpace(new BlueprintIndex(crowded), catalog, "f1");
    expect(space?.freeM2).toBe(0);
    expect(space?.overM2).toBeCloseTo(200 + 108 + 1200 + 144 - 1200, 9);
  });

  test("the bare floor is the part no room covers, in rectangles that add up to it", () => {
    const space = floorSpace(new BlueprintIndex(world()), catalog, "f1");
    const bare = (space?.bare ?? []).reduce((n, r) => n + r.w * r.d, 0);
    expect(bare).toBeCloseTo(1200 - 200 - 108, 9);
    expect(bareRects({ x: 0, y: 0, w: 10, d: 10 }, [])).toEqual([{ x: 0, y: 0, w: 10, d: 10 }]);
    const ring = bareRects({ x: 0, y: 0, w: 10, d: 10 }, [{ x: 4, y: 4, w: 2, d: 2 }]);
    expect(ring.reduce((n, r) => n + r.w * r.d, 0)).toBeCloseTo(96, 9);
  });

  test("a building's floors are listed lowest first, and the roomiest other floor is found", () => {
    const index = new BlueprintIndex(world());
    expect(buildingFloorSpaces(index, catalog, "b1").map((f) => f.floorId)).toEqual(["f1", "f2"]);
    expect(roomiestOtherFloor(index, catalog, "b1", "f1")?.floorId).toBe("f2");
    expect(roomiestOtherFloor(index, catalog, "b1", "f2")?.floorId).toBe("f1");
    const onlyOne = new BlueprintIndex({
      ...world(),
      entities: world().entities.filter((e) => e.id !== "f2"),
    });
    expect(roomiestOtherFloor(onlyOne, catalog, "b1", "f1")).toBeUndefined();
  });
});

describe("real size and the rack rule [REQ-076]", () => {
  test("a building is locked only when the generator said so", () => {
    const index = new BlueprintIndex(world({ sizeLocked: true }));
    expect(isSizeLocked(index.entity("b1"))).toBe(true);
    expect(isSizeLocked(new BlueprintIndex(world()).entity("b1"))).toBe(false);
    expect(isSizeLocked(index.entity("hall"))).toBe(false);
    expect(isSizeLocked(undefined)).toBe(false);
  });

  test("a rack takes 2.6 m² with its share of the aisles, and a server storey's white floor is 55 to 60 %", () => {
    expect(RACK_AREA_M2).toBe(2.6);
    expect(WHITE_FLOOR_SHARE).toEqual({ low: 0.55, high: 0.6 });
    expect(racksThatFit(26)).toBe(10);
    expect(racksThatFit(25.9)).toBe(9);
    expect(racksThatFit(0)).toBe(0);
    expect(racksThatFit(-5)).toBe(0);
  });
});

describe("what a site draws against its grid connection [REQ-076]", () => {
  const site = (props: Record<string, string | number | boolean>): Entity => ({
    id: "s",
    kind: "site",
    name: "사업장",
    placement: { type: "land", w: 100, d: 100 },
    props,
  });

  test("a site carries its capacity, an estimate says so, and one without is unlimited", () => {
    expect(powerCapacityOf(site({ powerCapacityMW: 108 }))).toEqual({ mw: 108, estimated: false });
    expect(powerCapacityOf(site({ powerCapacityMW: 20, powerCapacityEstimated: true }))).toEqual({
      mw: 20,
      estimated: true,
    });
    expect(powerCapacityOf(site({}))).toBeUndefined();
    expect(powerCapacityOf(site({ powerCapacityMW: 0 }))).toBeUndefined();
    expect(powerCapacityOf(undefined)).toBeUndefined();
  });

  test("a machine draws by its power curve at the design load, a cooling unit by its fans", () => {
    const server = catalog.list("server")[0];
    const at = (modelId: string | undefined, kind: Entity["kind"]): Entity => ({
      id: "x",
      kind,
      name: "x",
      ...(modelId ? { modelId } : {}),
      props: {},
    });
    const model = catalog.getOf(server?.id as string, "server");
    expect(designDrawW(at(model.id, "server"), catalog, 1)).toBeCloseTo(model.maxPowerW, 6);
    expect(designDrawW(at(model.id, "server"), catalog, 0)).toBeCloseTo(model.idlePowerW, 6);
    const crah = catalog.list("cooling_unit")[0];
    expect(designDrawW(at(crah?.id, "cooling_unit"), catalog)).toBe(
      catalog.getOf(crah?.id as string, "cooling_unit").fanPowerW,
    );
    expect(designDrawW(at(undefined, "room"), catalog)).toBe(0);
    expect(designDrawW(at(undefined, "rack"), catalog)).toBe(0);
  });

  test("the server rooms of a fab are not on the data-centre connection", () => {
    const model = catalog.list("server")[0]?.id as string;
    const rack = (id: string, parent: string): Entity => ({
      id,
      kind: "server",
      name: id,
      parentId: parent,
      modelId: model,
      placement: { type: "unit", u: 1 },
      props: {},
    });
    const floor = (id: string, parent: string): Entity => ({
      id,
      kind: "floor",
      name: id,
      parentId: parent,
      placement: { type: "level", level: 1, height: 4.5 },
      props: {},
    });
    const bp: Blueprint = {
      ...emptyBlueprint("w", "시험"),
      entities: [
        site({}),
        area("dc", "building", "s", [0, 0, 20, 20], { purpose: "data_center" }),
        area("fab", "building", "s", [30, 0, 20, 20], { purpose: "fab" }),
        floor("dcf", "dc"),
        floor("fabf", "fab"),
        area("dcr", "room", "dcf", [1, 1, 10, 10]),
        area("fabr", "room", "fabf", [1, 1, 10, 10]),
        {
          id: "dcrack",
          kind: "rack",
          name: "r",
          parentId: "dcr",
          placement: { type: "spot", x: 1, y: 1, rotation: 0 },
          props: {},
        },
        {
          id: "fabrack",
          kind: "rack",
          name: "r",
          parentId: "fabr",
          placement: { type: "spot", x: 1, y: 1, rotation: 0 },
          props: {},
        },
        rack("a", "dcrack"),
        rack("b", "fabrack"),
      ],
    };
    const one = designDrawW(rack("a", "dcrack"), catalog);
    expect(siteDrawW(new BlueprintIndex(bp), catalog)).toBeCloseTo(one, 6);
  });
});
