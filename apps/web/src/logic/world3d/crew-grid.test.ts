import { describe, expect, test } from "vitest";
import {
  aislesOf,
  along,
  equipBlocks,
  Grid,
  onAisle,
  podBlocks,
  polyOf,
  rackBlocks,
  routeOf,
} from "./crew-route";
import type { Bounds } from "./plan";
import type { RoomScene } from "./room";

/** A bare room: only what the walking code reads (its size and, when asked for, pieces, pods, machines, rack sets). */
const room = (w: number, d: number, extra: Record<string, unknown> = {}): RoomScene =>
  ({ w, d, pods: [], equipment: [], sets: [], ...extra }) as unknown as RoomScene;
const box = (x0: number, z0: number, x1: number, z1: number): Bounds => ({ x0, z0, x1, z1 });

describe("which spots of a floor are free to stand on [REQ-074]", () => {
  test("the floor inside the walls is free, outside is not, and a block takes its spot", () => {
    const grid = new Grid(room(10, 8), [box(4, 3, 6, 5)]);
    expect(grid.free(1, 1)).toBe(true);
    expect(grid.free(5, 4)).toBe(false);
    expect(grid.free(-1, 1)).toBe(false);
    expect(grid.free(11, 1)).toBe(false);
    grid.block(box(0, 0, 2, 2));
    expect(grid.free(1, 1)).toBe(false);
  });

  test("a room made of pieces is walkable only on its pieces", () => {
    const l = room(10, 10, { rects: [box(0, 0, 10, 4), box(0, 4, 4, 10)] });
    const grid = new Grid(l, []);
    expect(grid.free(8, 2)).toBe(true);
    expect(grid.free(2, 8)).toBe(true);
    expect(grid.free(8, 8)).toBe(false);
  });

  test("a room with its own bounds is gridded from the bounds' corner", () => {
    const grid = new Grid(
      room(10, 8, { bounds: box(20, 20, 30, 28), rects: [box(20, 20, 30, 28)] }),
      [],
    );
    expect(grid.free(25, 24)).toBe(true);
    expect(grid.free(5, 5)).toBe(false);
  });

  test("a straight way is clear only while nothing stands on it", () => {
    const grid = new Grid(room(10, 8), [box(4, 0, 6, 8)]);
    expect(grid.clear({ x: 1, z: 4 }, { x: 3, z: 4 })).toBe(true);
    expect(grid.clear({ x: 1, z: 4 }, { x: 9, z: 4 })).toBe(false);
    expect(grid.clear({ x: 1, z: 4 }, { x: 1, z: 4 })).toBe(true);
  });
});

describe("the nearest free spot looks outward ring by ring [REQ-074]", () => {
  test("a free point is its own nearest spot, a blocked one moves to the edge of the block", () => {
    const grid = new Grid(room(10, 8), [box(4, 3, 6, 5)]);
    const same = grid.nearestFree({ x: 1.05, z: 1.05 });
    expect(same && Math.hypot(same.x - 1.05, same.z - 1.05)).toBeLessThan(0.3);
    const moved = grid.nearestFree({ x: 5, z: 4 });
    expect(moved).toBeDefined();
    expect(grid.free(moved?.x as number, moved?.z as number)).toBe(true);
    expect(Math.hypot((moved?.x as number) - 5, (moved?.z as number) - 4)).toBeLessThan(2.5);
  });

  test("no spot within reach gives nothing", () => {
    const grid = new Grid(room(10, 8), [box(-1, -1, 11, 9)]);
    expect(grid.nearestFree({ x: 5, z: 4 })).toBeUndefined();
    expect(
      new Grid(room(10, 8), [box(0, 0, 10, 8)]).nearestFree({ x: 5, z: 4 }, 1),
    ).toBeUndefined();
  });

  test("a point off the floor is pulled back onto it", () => {
    const grid = new Grid(room(10, 8), []);
    const back = grid.nearestFree({ x: -2, z: 4 }) as { x: number; z: number };
    expect(back.x).toBeGreaterThanOrEqual(0);
  });
});

describe("the ways people walk [REQ-074]", () => {
  test("a way is points and the metres walked at each; a point along it faces where it heads", () => {
    const way = polyOf([
      { x: 0, z: 0 },
      { x: 0, z: 4 },
      { x: 3, z: 4 },
    ]);
    expect(way.length).toBe(7);
    expect(along(way, 2)).toMatchObject({ x: 0, z: 2, rot: 0 });
    expect(along(way, 5.5).rot).toBeCloseTo(Math.PI / 2);
    expect(along(way, -3)).toMatchObject({ x: 0, z: 0 });
    expect(along(way, 99)).toMatchObject({ x: 3, z: 4 });
    expect(
      along(
        polyOf([
          { x: 1, z: 1 },
          { x: 1, z: 1 },
        ]),
        0,
      ),
    ).toMatchObject({ x: 1, z: 1 });
  });

  test("the nearest point on an aisle, clamped to its ends; a zero-length aisle is its point", () => {
    const aisle = { a: { x: 0, z: 0 }, b: { x: 10, z: 0 } };
    expect(onAisle(aisle, { x: 4, z: 3 })).toEqual({ x: 4, z: 0 });
    expect(onAisle(aisle, { x: -5, z: 3 })).toEqual({ x: 0, z: 0 });
    expect(onAisle(aisle, { x: 50, z: 3 })).toEqual({ x: 10, z: 0 });
    expect(onAisle({ a: { x: 2, z: 2 }, b: { x: 2, z: 2 } }, { x: 9, z: 9 })).toEqual({
      x: 2,
      z: 2,
    });
  });

  test("the footprints of racks, turned racks swapping their width and depth, machines on the floor, and pods", () => {
    const scene = room(20, 10, {
      sets: [{ ids: ["a", "b"], kind: { w: 0.6, d: 1.2 }, at: [5, 0, 5, 0, 8, 0, 5, Math.PI / 2] }],
      equipment: [
        { x: 1, z: 1, w: 1, d: 1, style: "crah" },
        { x: 3, z: 3, w: 1, d: 1, style: "busway" },
      ],
      pods: [{ enclosure: box(10, 2, 12, 6) }],
    });
    const racks = rackBlocks(scene);
    expect(racks).toHaveLength(2);
    expect(racks[0]).toEqual(box(4.7, 4.4, 5.3, 5.6));
    expect(racks[1]).toEqual(box(7.4, 4.7, 8.6, 5.3));
    expect(podBlocks(scene)).toEqual([box(10, 2, 12, 6)]);
  });
});

describe("a way round what stands in the road [REQ-074]", () => {
  const grid = (blocks: Bounds[]) => new Grid(room(20, 10), blocks);

  test("a free straight way is the straight way", () => {
    const g = grid([]);
    const from = { x: 1, z: 5 };
    const to = { x: 19, z: 5 };
    expect(routeOf(room(20, 10), g, [], from, to).pts).toEqual([from, to]);
  });

  test("a wall with a gap sends the way through the gap, by the corners and aisle ends", () => {
    const scene = room(20, 10);
    const g = grid([box(9, 0, 11, 4), box(9, 6, 11, 10)]);
    const aisle = { a: { x: 7, z: 5 }, b: { x: 13, z: 5 } };
    const way = routeOf(scene, g, [aisle], { x: 1, z: 1 }, { x: 19, z: 1 });
    expect(way.pts.length).toBeGreaterThan(2);
    for (let i = 1; i < way.pts.length; i++)
      expect(g.clear(way.pts[i - 1] as never, way.pts[i] as never)).toBe(true);
  });

  test("a wall with no gap leaves the straight line, which is better than nothing", () => {
    const scene = room(20, 10);
    const g = grid([box(9, -1, 11, 11)]);
    const from = { x: 1, z: 5 };
    const to = { x: 19, z: 5 };
    expect(routeOf(scene, g, [], from, to).pts).toEqual([from, to]);
  });
});

describe("the aisles of a hall [REQ-074]", () => {
  const rack = (x: number, z: number) => box(x - 0.3, z - 0.6, x + 0.3, z + 0.6);
  const rows = (zs: number[]) =>
    zs.flatMap((z) => Array.from({ length: 10 }, (_, i) => rack(3 + i * 0.7, z)));

  test("an aisle runs between two rows that leave room, and in front of the first and behind the last", () => {
    const scene = room(20, 14);
    const racks = rows([4, 8]);
    const g = new Grid(scene, racks);
    const out = aislesOf(scene, g, racks);
    expect(out.length).toBe(3);
    for (const a of out) expect(a.a.z).toBe(a.b.z);
    expect(out.map((a) => a.a.z).sort((p, q) => p - q)[1]).toBeCloseTo(6, 0);
  });

  test("rows too close together leave no aisle between them", () => {
    const scene = room(20, 14);
    const racks = rows([4, 5.5]);
    const out = aislesOf(scene, new Grid(scene, racks), racks);
    expect(out.every((a) => Math.abs(a.a.z - 4.75) > 0.5)).toBe(true);
  });

  test("a hall with no racks gets one line across its widest piece", () => {
    const scene = room(12, 8);
    const out = aislesOf(scene, new Grid(scene, []), []);
    expect(out).toHaveLength(1);
    expect(out[0]?.a.z).toBeCloseTo(4);
    const pieces = room(12, 12, { rects: [box(0, 0, 4, 12), box(4, 0, 12, 6)] });
    const widest = aislesOf(pieces, new Grid(pieces, []), [])[0];
    expect(widest?.b.x).toBeGreaterThan(8);
  });

  test("a hall where nothing is free has no aisle at all", () => {
    const scene = room(12, 8);
    const full = [box(-1, -1, 13, 9)];
    expect(aislesOf(scene, new Grid(scene, full), [])).toEqual([]);
  });

  test("machines on the floor count, an overhead busway does not", () => {
    const scene = room(10, 10, {
      equipment: [
        { x: 2, z: 2, w: 2, d: 2, style: "crah" },
        { x: 6, z: 6, w: 2, d: 2, style: "busway" },
      ],
    });
    expect(equipBlocks(scene)).toHaveLength(1);
  });
});
