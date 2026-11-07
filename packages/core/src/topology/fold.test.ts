import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { fold } from "./fold";
import { layerShape } from "./layers";
import { alarm, fault, gridWorld } from "./test-support/grid";
import { type Board, LAYER_IDS, type LayerId, MAX_TILES } from "./types";

const SPEC = { buildings: 3, floors: 2, rooms: 3, racks: 12, servers: 2 };
const RACKS = 3 * 2 * 3 * 12;

const tilesOf = (board: Board, stage: string) =>
  board.tiles.filter((t) => board.stages[t.stage]?.id === stage);

/** Every piece of equipment is in exactly one tile: what the stage holds is what its tiles count. */
function expectConserved(board: Board, source: ReturnType<typeof gridWorld>): void {
  const shape = layerShape(source.index, board.layer);
  board.stages.forEach((_, stage) => {
    const counted = board.tiles.filter((t) => t.stage === stage).reduce((n, t) => n + t.count, 0);
    expect(counted).toBe(shape.members[stage]?.length);
  });
}

describe("what is the same is folded, what differs stands alone [REQ-078]", () => {
  test("a healthy campus is a handful of group tiles however many racks it has", () => {
    const source = gridWorld(SPEC);
    // the accelerator layer (REQ-107) is empty in a campus with no GPUs
    for (const layer of LAYER_IDS.filter((l) => l !== "accel")) {
      const board = fold(source, { layer });
      expect(board.tiles.length).toBeLessThan(40);
      expect(board.stats.entities).toBeGreaterThan(RACKS);
      expectConserved(board, source);
    }
    const racks = tilesOf(fold(source, { layer: "cooling" }), "rack");
    expect(racks).toHaveLength(1);
    expect(racks[0]).toMatchObject({
      group: true,
      count: RACKS,
      state: "ok",
      name: `정상 랙 ${RACKS}대`,
    });
  });

  test("a small world is drawn whole: there is nothing to fold", () => {
    const source = gridWorld({ buildings: 1, floors: 1, rooms: 1, racks: 3, servers: 1 });
    const board = fold(source, { layer: "cooling" });
    expect(board.tiles.every((t) => !t.group)).toBe(true);
    expect(board.tiles.filter((t) => board.stages[t.stage]?.id === "rack")).toHaveLength(3);
  });

  test("the broken, the alarming and the touched stand alone; the rest of each kind is one tile", () => {
    const source = gridWorld(SPEC, {
      faults: [fault("cooling_unit_failure", "b0f0r0-u1")],
      alarms: [alarm("b0f0r0-k3")],
      touched: new Set(["b1f1r1-u2"]),
      states: { "b0f0r0-u1": { running: false } },
    });
    const board = fold(source, { layer: "cooling" });
    const named = (id: string) => board.tiles.find((t) => t.id === id);
    expect(named("b0f0r0-u1")).toMatchObject({ state: "fault", group: false });
    expect(named("b0f0r0-k3")).toMatchObject({ state: "alarm", group: false });
    expect(named("b1f1r1-u2")).toMatchObject({ touched: true, group: false });
    const units = tilesOf(board, "unit").filter((t) => t.group);
    expect(units.map((t) => t.name).join()).toContain("정상 냉방기");
    const racks = tilesOf(board, "rack");
    expect(racks.some((t) => t.group && t.state === "impact")).toBe(true);
    expectConserved(board, source);
  });

  test("the tiles come in the order of the stages, and within a stage the worst first", () => {
    const source = gridWorld(SPEC, {
      alarms: [alarm("b2f1r2-k5")],
      faults: [fault("breaker_trip", "b0f0r0-k0-pdu")],
    });
    const board = fold(source, { layer: "power" });
    const stages = board.tiles.map((t) => t.stage);
    expect(stages).toEqual([...stages].sort((a, b) => a - b));
    const pdus = tilesOf(board, "pdu");
    expect(pdus[0]?.state).toBe("fault");
  });
});

describe("opening a container takes the groups under it apart a level [REQ-078]", () => {
  const source = gridWorld(SPEC);

  test("opening the site splits the racks by building, opening a building splits it by floor", () => {
    const closed = fold(source, { layer: "cooling" });
    const site = fold(source, { layer: "cooling", path: ["site"] });
    const building = fold(source, { layer: "cooling", path: ["site", "b1"] });
    const racks = (b: Board) => tilesOf(b, "rack").filter((t) => t.group);
    expect(racks(closed)).toHaveLength(1);
    expect(
      racks(site)
        .map((t) => t.where)
        .sort(),
    ).toEqual(["b0", "b1", "b2"]);
    expect(
      racks(building)
        .map((t) => t.where)
        .sort(),
    ).toEqual(["b0", "b1f0", "b1f1", "b2"].sort());
    expectConserved(site, source);
    expectConserved(building, source);
  });

  test("a group says how to open it, and the path it gives is the way in", () => {
    const site = fold(source, { layer: "cooling", path: ["site"] });
    const group = tilesOf(site, "rack").find((t) => t.where === "b2");
    expect(group?.open).toEqual(["site", "b2"]);
    const next = fold(source, { layer: "cooling", path: group?.open });
    expect(next.path.map((c) => c.name)).toEqual(["site", "b2"]);
    expect(tilesOf(next, "rack").some((t) => t.where === "b2f0")).toBe(true);
  });

  test("opened all the way down, the racks of a room stand on their own", () => {
    const board = fold(source, {
      layer: "cooling",
      path: ["site", "b0", "b0f0", "b0f0r0", "b0f0r0-ca"],
    });
    const alone = tilesOf(board, "rack").filter((t) => !t.group);
    expect(alone).toHaveLength(12);
    expectConserved(board, source);
  });

  test("a group whose opening would change nothing gives no way in", () => {
    const path = ["site", "b0", "b0f0", "b0f0r0", "b0f0r0-ca"];
    const board = fold(source, { layer: "cooling", path });
    const groups = board.tiles.filter((t) => t.group);
    expect(groups.length).toBeGreaterThan(0);
    for (const t of groups) {
      if (!t.open) continue;
      const prefix = t.open.length <= path.length && t.open.every((id, i) => id === path[i]);
      expect(prefix).toBe(false);
    }
  });
});

describe("the picked equipment and its neighbours are drawn on their own [REQ-078]", () => {
  const source = gridWorld(SPEC);

  test("a picked rack is a tile of its own, flagged, even when it is as healthy as the rest", () => {
    const board = fold(source, { layer: "cooling", focus: { id: "b1f0r1-k4" } });
    const tile = board.tiles.find((t) => t.id === "b1f0r1-k4");
    expect(tile).toMatchObject({ focus: true, group: false });
    expectConserved(board, source);
  });

  test("a rack looks up at what it leans on; a unit looks down at what leans on it", () => {
    const up = fold(source, { layer: "cooling", focus: { id: "b1f0r1-k4", hops: 2 } });
    expect(up.tiles.some((t) => t.id === "b1f0r1")).toBe(true);
    expect(up.tiles.some((t) => t.id === "b1f0r1-u1")).toBe(true);
    const down = fold(source, { layer: "cooling", focus: { id: "b1f0r1-u1", hops: 1 } });
    expect(down.tiles.some((t) => t.id === "b1f0r1")).toBe(true);
    expect(down.tiles.some((t) => t.id === "b1f0r1-k4")).toBe(false);
  });

  test("the neighbours of a picked room stand on their own six to a stage, the rest stay folded", () => {
    const board = fold(source, { layer: "cooling", focus: { id: "b1f0r1", hops: 2 } });
    const racks = tilesOf(board, "rack");
    expect(racks.filter((t) => !t.group)).toHaveLength(6);
    expect(racks.filter((t) => t.group).reduce((n, t) => n + t.count, 0)).toBe(RACKS - 6);
  });

  test("a pick that is not in the layer draws nothing extra", () => {
    const plain = fold(source, { layer: "cooling" });
    const board = fold(source, { layer: "cooling", focus: { id: "b0f0" } });
    expect(board.tiles.length).toBe(plain.tiles.length);
    expect(board.tiles.some((t) => t.focus)).toBe(false);
  });
});

describe("the pipes and the bars say what leans on what [REQ-078]", () => {
  test("every pipe joins two tiles of the board, the receiver counts each piece once", () => {
    const source = gridWorld(SPEC, { alarms: [alarm("b0f0r0-k1")] });
    for (const layer of LAYER_IDS) {
      const board = fold(source, { layer });
      const byId = new Map(board.tiles.map((t) => [t.id, t]));
      for (const e of board.edges) {
        expect(byId.has(e.from)).toBe(true);
        expect(byId.has(e.to)).toBe(true);
        expect(e.count).toBeLessThanOrEqual(byId.get(e.to)?.count ?? 0);
      }
    }
  });

  test("a stopped unit's pipe is cut, and the pipe into a warm room is hot", () => {
    const source = gridWorld(SPEC, {
      faults: [fault("cooling_unit_failure", "b0f0r0-u1")],
      alarms: [alarm("b0f0r0", "critical")],
      states: { "b0f0r0-u1": { running: false } },
    });
    const board = fold(source, { layer: "cooling" });
    const out = board.edges.filter((e) => e.from === "b0f0r0-u1");
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((e) => !e.live)).toBe(true);
    expect(board.edges.some((e) => e.to === "b0f0r0" && e.kind === "hot")).toBe(true);
    expect(board.edges.filter((e) => e.kind === "cold").length).toBeGreaterThan(0);
  });

  test("the bar under a room is how its racks are doing", () => {
    const source = gridWorld(SPEC, { alarms: [alarm("b0f0r0-k1"), alarm("b0f0r0-k2")] });
    const board = fold(source, { layer: "cooling", focus: { id: "b0f0r0" } });
    const room = board.tiles.find((t) => t.id === "b0f0r0");
    const alarmed = room?.bar.find(([, state]) => state === "alarm");
    expect(alarmed?.[0]).toBeCloseTo(2 / 12, 5);
    expect(room?.bar.reduce((n, [share]) => n + share, 0)).toBeCloseTo(1, 5);
  });

  test("power and network pipes carry their own kind", () => {
    const source = gridWorld(SPEC);
    expect(new Set(fold(source, { layer: "power" }).edges.map((e) => e.kind))).toEqual(
      new Set(["power"]),
    );
    expect(new Set(fold(source, { layer: "network" }).edges.map((e) => e.kind))).toEqual(
      new Set(["net"]),
    );
  });
});

describe("a board never holds more than 150 tiles [REQ-078]", () => {
  const source = gridWorld({ buildings: 4, floors: 3, rooms: 4, racks: 20, servers: 1 });
  const racks = source.index.ofKind("rack").map((r) => r.id);

  test("every rack alarming at once still fits, with the worst standing alone", () => {
    const everyRack = gridWorld(
      { buildings: 4, floors: 3, rooms: 4, racks: 20, servers: 1 },
      { alarms: racks.map((id) => alarm(id)) },
    );
    for (const layer of LAYER_IDS) {
      const board = fold(everyRack, { layer });
      expect(board.tiles.length).toBeLessThanOrEqual(MAX_TILES);
      expectConserved(board, everyRack);
    }
  });

  test("a smaller limit is kept too, down to a few tiles for each stage", () => {
    for (const limit of [30, 60, 100]) {
      const board = fold(source, { layer: "power", limit, path: ["site", "b0", "b0f0"] });
      expect(board.tiles.length).toBeLessThanOrEqual(limit);
    }
  });

  test("whatever is broken, alarming, touched, picked or opened, the board fits and loses nothing", () => {
    const equipment = source.blueprint.entities.map((e) => e.id);
    const spaces = source.blueprint.entities.filter((e) =>
      ["building", "floor", "room"].includes(e.kind),
    );
    fc.assert(
      fc.property(
        fc.constantFrom<LayerId>(...LAYER_IDS),
        fc.array(fc.constantFrom(...equipment), { maxLength: 60 }),
        fc.array(fc.constantFrom(...equipment), { maxLength: 60 }),
        fc.constantFrom(...spaces),
        fc.constantFrom(...equipment),
        (layer, broken, alarming, space, pick) => {
          const world = gridWorld(SPEC, {
            faults: broken.map((id) => fault("breaker_trip", id)),
            alarms: alarming.map((id) => alarm(id)),
            touched: new Set(broken.slice(0, 5)),
          });
          const chain = [
            ...world.index
              .ancestors(space.id)
              .map((e) => e.id)
              .reverse(),
            space.id,
          ];
          const board = fold(world, { layer, path: chain, focus: { id: pick, hops: 3 } });
          expect(board.tiles.length).toBeLessThanOrEqual(MAX_TILES);
          const shape = layerShape(world.index, layer);
          board.stages.forEach((_, stage) => {
            const counted = board.tiles
              .filter((t) => t.stage === stage)
              .reduce((n, t) => n + t.count, 0);
            expect(counted).toBe(shape.members[stage]?.length);
          });
        },
      ),
      { numRuns: 60 },
    );
  });

  test("the same world and the same question give the same board", () => {
    const options = { layer: "cooling", path: ["site", "b1"], focus: { id: "b1f0r0-k0" } } as const;
    expect(fold(source, options)).toEqual(fold(source, options));
  });
});
