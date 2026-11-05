/**
 * The topology view's calculation (REQ-078, ADR-0084): what it reads of the builder's world at a moment of the run,
 * where the tiles and pipes go, which containers to open to look at something, and the words of the view.
 */
import { Catalog } from "@terrarium/core/catalog";
import { DEFAULT_CAMPUS, generateCampus } from "@terrarium/core/sources/worldgen";
import { fold, LAYER_IDS, type LayerId } from "@terrarium/core/topology";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { preview } from "../builder/preview";
import {
  BOARD_W,
  cutTo,
  drawnText,
  frameOf,
  layout,
  pathFor,
  pictureText,
  pipeWidth,
  sourceOf,
  TILE_HALF,
  TOPO_WORDS,
  tileText,
} from ".";

const catalog = new Catalog();
const blueprint = generateCampus(
  {
    ...DEFAULT_CAMPUS,
    site: "giheung",
    seed: 3,
    buildings: 1,
    floors: 1,
    hallsPerFloor: 1,
    podsPerHall: 4,
    detail: 1,
  },
  catalog,
).blueprint;
const index = new BlueprintIndex(blueprint);
const unit = index.ofKind("cooling_unit").find((u) => u.name.startsWith("CRAH")) as { id: string };
const run = preview(blueprint, catalog, 300, new Set([unit.id]));
if ("problems" in run) throw new Error(run.problems.join());

const board = (layer: LayerId, at?: number) => fold(sourceOf(index, catalog, run, at), { layer });

describe("the view reads the world at the moment of the time bar [REQ-078]", () => {
  test("before any run the world is as it was built: nothing is broken or alarming", () => {
    const source = sourceOf(index, catalog, undefined, undefined);
    expect(source.faults()).toEqual([]);
    expect(source.alarms()).toEqual([]);
    expect(source.earlier).toBeUndefined();
    const tiles = fold(source, { layer: "cooling" }).tiles;
    expect(tiles.every((t) => t.state === "ok")).toBe(true);
  });

  test("the last frame has the stopped unit as a fault, the first frame is before it", () => {
    const stopped = board("cooling").tiles.find((t) => t.id === unit.id);
    expect(stopped).toMatchObject({ state: "fault", group: false });
    expect(board("cooling", 0).tiles.every((t) => t.state !== "fault")).toBe(true);
    expect(sourceOf(index, catalog, run, 0).faults()).toEqual([]);
  });

  test("a frame shows its own temperatures, and knows the frame before it", () => {
    const rack = index.ofKind("rack")[0]?.id as string;
    const first = run.frames[0]?.racks.get(rack)?.inletC;
    const last = run.frames.at(-1)?.racks.get(rack)?.inletC;
    const at = (i: number) => {
      const s = sourceOf(index, catalog, run, i).stateOf(rack);
      return s.kind === "rack" ? s.inletC : undefined;
    };
    expect(at(0)).toBe(first);
    expect(at(run.frames.length - 1)).toBe(last);
    expect(sourceOf(index, catalog, run, 0).earlier).toBeUndefined();
    expect(sourceOf(index, catalog, run, 3).earlier?.t).toBe(run.frames[2]?.t);
  });

  test("the time bar's place is the last frame until it is dragged, and never outside the run", () => {
    expect(frameOf(run, undefined)).toBe(run.frames.length - 1);
    expect(frameOf(run, -4)).toBe(0);
    expect(frameOf(run, 999)).toBe(run.frames.length - 1);
  });
});

describe("the tiles and pipes are laid out in columns [REQ-078]", () => {
  for (const id of LAYER_IDS) {
    test(`${id}: a column for each stage, the worst state first, pipes from right to left`, () => {
      const b = board(id);
      const placed = layout(b);
      expect(placed.columns.map((c) => c.label)).toEqual(b.stages.map((s) => s.label));
      const xs = placed.columns.map((c) => c.x);
      expect(xs).toEqual([...xs].sort((a, c) => a - c));
      for (const t of placed.tiles) {
        expect(t.x).toBe(xs[t.tile.stage]);
        expect(t.y).toBeLessThan(placed.height);
      }
      for (const stage of b.stages.keys()) {
        const column = placed.tiles.filter((t) => t.tile.stage === stage);
        const ys = column.map((t) => t.y);
        expect(ys).toEqual([...ys].sort((a, c) => a - c));
      }
      for (const pipe of placed.pipes) {
        const from = placed.tiles.find((t) => t.tile.id === pipe.edge.from);
        const to = placed.tiles.find((t) => t.tile.id === pipe.edge.to);
        expect(pipe.d.startsWith(`M${(from?.x ?? 0) + TILE_HALF} ${from?.y}`)).toBe(true);
        expect(pipe.d.endsWith(`${(to?.x ?? 0) - TILE_HALF} ${to?.y}`)).toBe(true);
      }
      expect(placed.width).toBe(BOARD_W);
    });
  }

  test("a pipe is as thick as the number of things it carries, slowly, and never thicker than ten", () => {
    expect(pipeWidth(1)).toBeLessThan(pipeWidth(10));
    expect(pipeWidth(10)).toBeLessThan(pipeWidth(1000));
    expect(pipeWidth(1e9)).toBe(10);
  });
});

describe("which containers to open, and the way back out [REQ-078]", () => {
  const room = index.ofKind("room").find((r) => r.props.purpose === "data_hall") as { id: string };
  const rack = index.ofKind("rack").find((r) => index.enclosing(r.id, "room")?.id === room.id) as {
    id: string;
  };
  const floor = index.enclosing(room.id, "floor") as { id: string };
  const building = index.enclosing(room.id, "building") as { id: string };

  test("a room is looked at from its floor, so the room stands as a tile of its own", () => {
    expect(pathFor(index, room.id).at(-1)).toBe(floor.id);
    expect(pathFor(index, rack.id)).toEqual(pathFor(index, room.id));
  });

  test("a building opens to its site and a floor to its building: one step wider than the thing", () => {
    expect(pathFor(index, building.id)).toEqual([index.ofKind("site")[0]?.id]);
    expect(pathFor(index, floor.id).at(-1)).toBe(building.id);
    expect(pathFor(index, undefined)).toEqual([]);
    expect(pathFor(index, "nowhere")).toEqual([]);
    expect(pathFor(index, index.ofKind("site")[0]?.id)).toEqual([]);
  });

  test("cutting the path to a container takes the steps after it away; no container clears it", () => {
    const path = pathFor(index, room.id);
    expect(cutTo(path, path[0])).toEqual([path[0]]);
    expect(cutTo(path, undefined)).toEqual([]);
    expect(cutTo(path, "elsewhere")).toEqual(path);
  });
});

describe("the words of the view follow the glossary [REQ-078]", () => {
  const retired = [
    "도구",
    "삭제",
    "수정",
    "취소",
    "월드",
    "배점",
    "까닭",
    "경보",
    "가동",
    "한도",
    "노출",
    "장애",
    "주입",
    "위험",
    "주의",
  ];
  const sentences = (): string[] => {
    const out: string[] = Object.values(TOPO_WORDS);
    for (const id of LAYER_IDS) {
      const b = board(id);
      out.push(pictureText(b), drawnText(b), ...b.tiles.map(tileText));
    }
    return out;
  };

  test("no word the glossary retired, no ending in ~니다 or ~다", () => {
    for (const text of sentences()) {
      for (const word of retired) expect(text).not.toContain(word);
      expect(text).not.toMatch(/니다\.?$/);
    }
  });

  test("the picture has one sentence, the drawn count says how much is folded", () => {
    const b = board("cooling");
    expect(pictureText(b)).toContain("냉방 토폴로지예요");
    expect(pictureText(b)).toContain("고장 1곳");
    expect(drawnText(b)).toMatch(
      /^타일 \d+개를 모두 그렸어요$|^그린 타일 [\d,]+개 · 접힌 것 [\d,]+개$/,
    );
  });

  test("a tile says its name and its line, and a group that opens says so", () => {
    const b = board("cooling");
    const group = b.tiles.find((t) => t.group && t.open);
    if (group) expect(tileText(group)).toContain(TOPO_WORDS.openHint);
    const one = b.tiles.find((t) => !t.group) as NonNullable<(typeof b.tiles)[number]>;
    expect(tileText(one).startsWith(one.name)).toBe(true);
  });
});
