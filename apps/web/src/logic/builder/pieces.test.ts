import { Catalog } from "@terrarium/core/catalog";
import { withJosa } from "@terrarium/core/kernel";
import {
  type Blueprint,
  BlueprintIndex,
  hasErrors,
  insideRoom,
  roomArea,
  roomOutline,
  roomRects,
  validateBlueprint,
} from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import {
  addBuilding,
  addPiece,
  addRoom,
  costDeltaM,
  draggedRect,
  emptyWorld,
  handleAt,
  handlePlan,
  handlesFor,
  type Level,
  levelStats,
  moveTo,
  placementProblem,
  placeRack,
  placeRackRow,
  removePiece,
  resizeArea,
  resizeBody,
  resizePiece,
  roomFull,
  sceneOf,
} from ".";

const catalog = new Catalog();
const at = (x: number, y: number) => ({ x, y, rotation: 0 as const });

/** A 12 x 9 m server room in a 40 x 30 m building with three racks in a row. */
function world() {
  let bp = emptyWorld("w", "시험", { w: 200, d: 150 }, "사업장");
  bp = addBuilding(bp, catalog, { x: 10, y: 10, w: 40, d: 30 }).blueprint;
  const floorId = new BlueprintIndex(bp).ofKind("floor")[0]?.id as string;
  bp = addRoom(bp, catalog, floorId, { x: 3, y: 3, w: 12, d: 9 }).blueprint;
  const roomId = new BlueprintIndex(bp).ofKind("room")[0]?.id as string;
  const racks = placeRackRow(bp, catalog, roomId, at(1.2, 1.2), 3);
  bp = racks.blueprint;
  return { bp, floorId, roomId, racks: racks.select, room: { kind: "room", id: roomId } as Level };
}
const roomOf = (bp: Blueprint, id: string) => new BlueprintIndex(bp).entity(id);
const ok = (bp: Blueprint) => !hasErrors(validateBlueprint(bp, catalog));

describe("resizing a room and attaching pieces [REQ-075]", () => {
  test("the body widens and narrows by tiles from any side, and what stands inside keeps its place in the world", () => {
    const { bp, roomId } = world();
    const left = resizeBody(bp, catalog, roomId, { x: 1.8, y: 3, w: 13.2, d: 9 });
    const room = roomOf(left.blueprint, roomId).placement;
    expect(room).toMatchObject({ x: 1.8, w: 13.2 });
    const rack = new BlueprintIndex(left.blueprint).ofKind("rack")[0];
    // the rack stood 1.2 m into the room (4.2 m on the floor): now 2.4 m into the wider room
    expect(rack?.placement).toMatchObject({ x: 2.4 });
    expect(ok(left.blueprint)).toBe(true);
    const odd = resizeBody(bp, catalog, roomId, { x: 3, y: 3, w: 13.3, d: 9.1 });
    expect(roomOf(odd.blueprint, roomId).placement).toMatchObject({ w: 13.2, d: 9 });
  });

  test("shrinking over a rack is refused with the rack's name", () => {
    const { bp, roomId } = world();
    expect(() => resizeBody(bp, catalog, roomId, { x: 3, y: 3, w: 2.4, d: 9 })).toThrow(
      /랙 \d+[이가] 밖으로 나가게 돼요\. 먼저 옮겨 주세요/,
    );
  });

  test("a piece shares an edge with the body, the room stays one entity and the floor grows", () => {
    const { bp, roomId } = world();
    const grown = addPiece(bp, catalog, roomId, "right", { along: 4.8, out: 6 });
    const room = roomOf(grown.blueprint, roomId);
    expect(roomRects(room)).toHaveLength(2);
    expect(roomRects(room)[1]).toEqual({ x: 15, y: 3, w: 6, d: 4.8 });
    expect(roomArea(room)).toBeCloseTo(12 * 9 + 6 * 4.8, 9);
    expect(roomOutline(room)).toHaveLength(6);
    expect(insideRoom(room, { x: 18, y: 4 })).toBe(true);
    expect(insideRoom(room, { x: 18, y: 9 })).toBe(false);
    expect(new BlueprintIndex(grown.blueprint).ofKind("room")).toHaveLength(1);
    expect(ok(grown.blueprint)).toBe(true);
  });

  test("a piece can join another piece, giving a T or a hexagon", () => {
    const { bp, roomId } = world();
    const one = addPiece(bp, catalog, roomId, "right", { along: 4.8, out: 6 });
    const two = addPiece(one.blueprint, catalog, roomId, "bottom", { along: 3, out: 3 }, { to: 1 });
    expect(roomRects(roomOf(two.blueprint, roomId))).toHaveLength(3);
    expect(roomOutline(roomOf(two.blueprint, roomId))).toHaveLength(8);
    expect(ok(two.blueprint)).toBe(true);
    const hex = addPiece(bp, catalog, roomId, "left", { along: 9, out: 3 });
    const both = addPiece(hex.blueprint, catalog, roomId, "right", { along: 9, out: 3 });
    expect(roomOutline(roomOf(both.blueprint, roomId))).toHaveLength(4);
  });

  test("a piece that overlaps, leaves the building or lands on another room is refused with a reason", () => {
    const { bp, floorId, roomId } = world();
    const one = addPiece(bp, catalog, roomId, "right", { along: 4.8, out: 6 });
    const two = addPiece(one.blueprint, catalog, roomId, "bottom", { along: 6, out: 6 }, { to: 1 });
    expect(() =>
      addPiece(two.blueprint, catalog, roomId, "right", { along: 3, out: 6 }, { to: 0, offset: 6 }),
    ).toThrow(/조각이 서로 겹쳐요/);
    expect(() => addPiece(bp, catalog, roomId, "right", { along: 4.8, out: 30 })).toThrow(
      "건물이 꽉 찼어요. 건물을 넓혀요",
    );
    expect(() => addPiece(bp, catalog, roomId, "left", { along: 4.8, out: 6 })).toThrow(
      "건물이 꽉 찼어요",
    );
    const neighbour = addRoom(bp, catalog, floorId, { x: 15.6, y: 3, w: 6, d: 6 }).blueprint;
    expect(() => addPiece(neighbour, catalog, roomId, "right", { along: 4.8, out: 6 })).toThrow(
      /겹쳐요/,
    );
  });

  test("racks stand in a piece, and the room's own checks use the whole shape", () => {
    const { bp, roomId } = world();
    const grown = addPiece(bp, catalog, roomId, "right", { along: 4.8, out: 6 }).blueprint;
    // local x 12.6 m is inside the piece (body ends at 12 m)
    const rack = placeRack(grown, catalog, roomId, at(12.6, 1.2));
    expect(ok(rack.blueprint)).toBe(true);
    expect(
      placementProblem(grown, catalog, { kind: "room", id: roomId }, undefined, at(12.6, 6)),
    ).toMatch(/벗어나요/);
    // a rack straddling the seam between body and piece is inside the union
    expect(
      placementProblem(grown, catalog, { kind: "room", id: roomId }, undefined, at(11.4, 1.8)),
    ).toBeUndefined();
  });

  test("a piece with a rack on it cannot be taken off, and an empty one can", () => {
    const { bp, roomId } = world();
    const grown = addPiece(bp, catalog, roomId, "right", { along: 4.8, out: 6 }).blueprint;
    const withRack = placeRack(grown, catalog, roomId, at(13.8, 1.2)).blueprint;
    const name = new BlueprintIndex(withRack).ofKind("rack").at(-1)?.name as string;
    expect(() => removePiece(withRack, catalog, roomId, 0)).toThrow(
      `${withJosa(name, "이")} 밖으로 나가게 돼요`,
    );
    const bare = removePiece(grown, catalog, roomId, 0).blueprint;
    expect(roomRects(roomOf(bare, roomId))).toHaveLength(1);
    expect(roomOf(bare, roomId).placement).not.toHaveProperty("pieces");
  });

  test("taking off a piece that holds another piece up is refused, resizing a piece works", () => {
    const { bp, roomId } = world();
    const one = addPiece(bp, catalog, roomId, "right", { along: 4.8, out: 6 }).blueprint;
    const two = addPiece(
      one,
      catalog,
      roomId,
      "right",
      { along: 4.8, out: 3 },
      { to: 1 },
    ).blueprint;
    expect(() => removePiece(two, catalog, roomId, 0)).toThrow(/떨어져요/);
    const wider = resizePiece(two, catalog, roomId, 0, { x: 15, y: 3, w: 6, d: 7.2 });
    expect(roomRects(roomOf(wider.blueprint, roomId))[1]).toMatchObject({ d: 7.2 });
    expect(() => resizePiece(two, catalog, roomId, 5, { x: 0, y: 0, w: 1, d: 1 })).toThrow();
  });

  test("moving a room takes its pieces with it, resizing the body leaves them", () => {
    const { bp, roomId, floorId } = world();
    const grown = addPiece(bp, catalog, roomId, "right", { along: 4.8, out: 6 }).blueprint;
    const moved = moveTo(grown, catalog, { kind: "floor", id: floorId }, roomId, 4.2, 4.2);
    expect(roomRects(roomOf(moved.blueprint, roomId))[1]).toMatchObject({ x: 16.2, y: 4.2 });
    const resized = resizeArea(grown, catalog, roomId, { x: 3, y: 3, w: 12, d: 7.2 });
    expect(roomRects(roomOf(resized.blueprint, roomId))[1]).toMatchObject({ x: 15, y: 3 });
    expect(ok(moved.blueprint)).toBe(true);
  });

  test("the construction cost counts the whole floor of every piece at the real rate", () => {
    const { bp, roomId } = world();
    const grown = addPiece(bp, catalog, roomId, "right", { along: 4.8, out: 6 }).blueprint;
    const delta = costDeltaM(bp, grown, catalog, roomId);
    expect(delta).toBeCloseTo(6 * 4.8 * 1.2, 9);
    const before = levelStats(new BlueprintIndex(bp), catalog, world().room).costM;
    const after = levelStats(new BlueprintIndex(grown), catalog, {
      kind: "room",
      id: roomId,
    }).costM;
    expect(after - before).toBeCloseTo(delta, 9);
  });

  test("a building widens on its 5 m grid and refuses to cut a room off", () => {
    const { bp, floorId } = world();
    const building = new BlueprintIndex(bp).ofKind("building")[0]?.id as string;
    const wide = resizeBody(bp, catalog, building, { x: 10, y: 10, w: 60, d: 30 });
    expect(roomOf(wide.blueprint, building).placement).toMatchObject({ w: 60 });
    expect(() => resizeBody(bp, catalog, building, { x: 10, y: 10, w: 10, d: 10 })).toThrow(
      /밖으로 나가게 돼요/,
    );
    const left = resizeBody(bp, catalog, building, { x: 5, y: 10, w: 45, d: 30 });
    const room = new BlueprintIndex(left.blueprint).ofKind("room")[0];
    expect(room?.placement).toMatchObject({ x: 8, y: 3 });
    expect(floorId).toBeDefined();
  });
});

describe("a full room offers a way on [REQ-075]", () => {
  test("a room with no free place for a rack says so, naming 서버룸 넓히기, and widening makes room again", () => {
    let bp = emptyWorld("w", "시험", { w: 100, d: 100 }, "사업장");
    bp = addBuilding(bp, catalog, { x: 10, y: 10, w: 20, d: 20 }).blueprint;
    const floorId = new BlueprintIndex(bp).ofKind("floor")[0]?.id as string;
    bp = addRoom(bp, catalog, floorId, { x: 3, y: 3, w: 3.6, d: 3 }).blueprint;
    const roomId = new BlueprintIndex(bp).ofKind("room")[0]?.id as string;
    expect(roomFull(bp, catalog, roomId)).toBe(false);
    bp = placeRackRow(bp, catalog, roomId, at(0, 0), 6).blueprint;
    bp = placeRackRow(bp, catalog, roomId, at(0, 1.2), 6).blueprint;
    for (const x of [0, 1.2, 2.4])
      bp = placeRack(bp, catalog, roomId, { x, y: 2.4, rotation: 90 }).blueprint;
    expect(roomFull(bp, catalog, roomId)).toBe(true);
    expect(() => placeRack(bp, catalog, roomId, at(0, 0))).toThrow(/서버룸 넓히기/);
    const wider = addPiece(bp, catalog, roomId, "right", { along: 1.8, out: 3 }).blueprint;
    expect(roomFull(wider, catalog, roomId)).toBe(false);
    expect(placeRack(wider, catalog, roomId, at(3.6, 0)).blueprint).toBeDefined();
  });
});

describe("the handles of a selected room [REQ-075]", () => {
  test("a room on its floor has an edge handle and a plus handle on every side, and dragging one gives a priced plan", () => {
    const { bp, roomId, floorId } = world();
    const index = new BlueprintIndex(bp);
    const level: Level = { kind: "floor", id: floorId };
    const handles = handlesFor(index, level, index.entity(roomId));
    expect(handles).toHaveLength(8);
    const right = handles.find((h) => h.key === "0:right") as (typeof handles)[number];
    expect(right.at).toEqual({ x: 15, y: 7.5 });
    expect(handleAt(handles, { x: 15.3, y: 7.3 }, 0.6)?.key).toBe("0:right");
    const plan = handlePlan(
      { bp, index, catalog, level },
      right,
      { x: 15, y: 7.5 },
      { x: 18.1, y: 7.5 },
    );
    expect(plan?.problem).toBeUndefined();
    expect(plan?.rect).toMatchObject({ x: 3, w: 15 });
    expect(plan?.label).toContain("15 × 9 m");
    expect(plan?.label).toContain("타일");
    expect(plan?.label).toMatch(/건설비 \+/);
    const plus = handles.find((h) => h.key === "0:bottom+") as (typeof handles)[number];
    const piece = handlePlan({ bp, index, catalog, level }, plus, plus.at, {
      x: plus.at.x,
      y: plus.at.y + 4,
    });
    expect(piece?.edit).toBeDefined();
    expect(piece?.label).toMatch(/조각/);
  });

  test("a drag that would spill a rack shows the reason in the plan", () => {
    const { bp, roomId, floorId } = world();
    const index = new BlueprintIndex(bp);
    const level: Level = { kind: "floor", id: floorId };
    const right = handlesFor(index, level, index.entity(roomId)).find((h) => h.key === "0:right");
    const plan = handlePlan(
      { bp, index, catalog, level },
      right as never,
      { x: 15, y: 7.5 },
      { x: 4, y: 7.5 },
    );
    expect(plan?.problem).toMatch(/랙 \d+[이가] 밖으로 나가게 돼요/);
    expect(plan?.edit).toBeUndefined();
  });

  test("inside the room the plan starts at the body's corner, and dragging the left edge keeps the racks where they are", () => {
    const { bp, roomId, room } = world();
    const index = new BlueprintIndex(bp);
    const left = handlesFor(index, room, index.entity(roomId)).find((h) => h.key === "0:left");
    expect(left?.at).toEqual({ x: 0, y: 4.5 });
    const plan = handlePlan(
      { bp, index, catalog, level: room },
      left as never,
      { x: 0, y: 4.5 },
      { x: -1.2, y: 4.5 },
    );
    expect(plan?.rect).toMatchObject({ x: -1.2, w: 13.2 });
    expect(plan?.edit).toBeDefined();
  });

  test("dragging a side is kept to the grid and to at least one step", () => {
    expect(draggedRect({ x: 0, y: 0, w: 6, d: 6 }, "right", 1.4, 0, 0.6)).toMatchObject({ w: 7.2 });
    expect(draggedRect({ x: 0, y: 0, w: 6, d: 6 }, "left", 99, 0, 0.6)).toMatchObject({
      x: 5.4,
      w: 0.6,
    });
    expect(draggedRect({ x: 10, y: 10, w: 40, d: 30 }, "bottom", 0, 12, 5)).toMatchObject({
      d: 40,
    });
  });

  test("the builder's plan draws every piece of a room", () => {
    const { bp, roomId, floorId } = world();
    const grown = addPiece(bp, catalog, roomId, "right", { along: 4.8, out: 6 }).blueprint;
    const index = new BlueprintIndex(grown);
    const scene = sceneOf(index, catalog, { kind: "floor", id: floorId });
    const group = scene.groups.find((g) => g.key === "room");
    expect(group?.ids).toEqual([roomId, roomId]);
  });
});

/** A small deterministic generator, so a failure can be replayed. */
function walk(seed: number) {
  let s = seed;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("any sequence of piece edits leaves a valid world or changes nothing [REQ-075]", () => {
  test("a random walk of attach, resize, remove and body resize", () => {
    const { bp: start, roomId } = world();
    const rnd = walk(75);
    let bp = start;
    const sides = ["left", "right", "top", "bottom"] as const;
    let accepted = 0;
    for (let n = 0; n < 400; n++) {
      const rects = roomRects(roomOf(bp, roomId));
      const pick = Math.floor(rnd() * 4);
      const tiles = (k: number) => 0.6 * (1 + Math.floor(rnd() * k));
      const attempt = () => {
        if (pick === 0)
          return addPiece(
            bp,
            catalog,
            roomId,
            sides[Math.floor(rnd() * 4)] as never,
            { along: tiles(10), out: tiles(10) },
            { to: Math.floor(rnd() * rects.length), offset: tiles(8) - 0.6 },
          );
        if (pick === 1 && rects.length > 1)
          return removePiece(bp, catalog, roomId, Math.floor(rnd() * (rects.length - 1)));
        if (pick === 2 && rects.length > 1) {
          const i = Math.floor(rnd() * (rects.length - 1));
          const r = rects[i + 1] as (typeof rects)[number];
          return resizePiece(bp, catalog, roomId, i, { ...r, w: tiles(12), d: tiles(12) });
        }
        const b = rects[0] as (typeof rects)[number];
        return resizeBody(bp, catalog, roomId, {
          x: b.x + 0.6 * Math.floor(rnd() * 5 - 2),
          y: b.y,
          w: tiles(30),
          d: tiles(25),
        });
      };
      let edit: ReturnType<typeof attempt> | undefined;
      try {
        edit = attempt();
      } catch (err) {
        expect((err as Error).message.length).toBeGreaterThan(0);
        continue;
      }
      bp = edit.blueprint;
      accepted++;
      const issues = validateBlueprint(bp, catalog).filter((i) => i.severity === "error");
      expect(issues, `step ${n}: ${JSON.stringify(issues)}`).toEqual([]);
    }
    expect(accepted).toBeGreaterThan(40);
  });
});
