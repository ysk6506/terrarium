/**
 * Where the tiles and pipes of a board go (REQ-078, ADR-0084): a column for each stage, left to right from the
 * source to the servers; in a column the tiles stand one under the other, the worst state first, and tiles of one
 * state in the order that keeps their pipes from crossing. The positions are in the units of the picture's viewBox.
 * A pipe is a curve from the right side of one tile to the left side of the next, as thick as the number of things
 * that lean on it.
 */
import type { Board, Edge, Tile } from "@terrarium/core/topology";
import { nounOf, num } from "@terrarium/core/topology";

/** The picture is this wide; its height follows the tallest column. */
export const BOARD_W = 1100;
const MARGIN_X = 96;
const TOP = 78;
const ROW = 108;
const BOTTOM = 52;
/** Half the width of a tile's base. */
export const TILE_HALF = 39;
/** A short column is centred against the tallest one, but not so far down that it leaves the first screen. */
const MAX_LIFT = 1.5 * ROW;
/** A pipe is named by what it carries only when that is a crowd of this many. */
const LABELLED = 10;

export interface Placed {
  readonly tile: Tile;
  readonly x: number;
  readonly y: number;
}

export interface Pipe {
  readonly key: string;
  readonly edge: Edge;
  /** The curve, as an SVG path. */
  readonly d: string;
  readonly width: number;
  /** "랙 408": what leans on this pipe, said with its noun; empty for a thin pipe. */
  readonly label: string;
  readonly labelX: number;
  readonly labelY: number;
}

export interface Column {
  readonly x: number;
  readonly label: string;
}

export interface Layout {
  readonly width: number;
  readonly height: number;
  readonly columns: readonly Column[];
  readonly tiles: readonly Placed[];
  readonly pipes: readonly Pipe[];
}

/** How thick a pipe is for this many things: it grows slowly, so a million does not hide the tiles. */
export const pipeWidth = (count: number): number => Math.min(10, 2 + Math.log2(count + 1) * 0.9);

const columnX = (stage: number, stages: number): number =>
  stages === 1 ? BOARD_W / 2 : MARGIN_X + (stage * (BOARD_W - 2 * MARGIN_X)) / (stages - 1);

const WORST: Record<Tile["state"], number> = { fault: 0, alarm: 1, impact: 3, ok: 4 };

/** The order of states in a column: the worst first, and what the agents touch before the quiet rest. */
const rankOf = (t: Tile): number => (t.touched && t.state === "ok" ? 2 : WORST[t.state]);

/** The rows of a stage, tiles of one state ordered by where their suppliers stand in the stage before. */
function ordered(
  tiles: readonly Tile[],
  suppliers: ReadonlyMap<string, readonly string[]>,
  rows: ReadonlyMap<string, number>,
) {
  const centre = (t: Tile): number => {
    const own = (suppliers.get(t.id) ?? []).flatMap((id) =>
      rows.has(id) ? [rows.get(id) as number] : [],
    );
    return own.length === 0
      ? Number.POSITIVE_INFINITY
      : own.reduce((a, b) => a + b, 0) / own.length;
  };
  const keyed = tiles.map((t, i) => ({ t, i, c: centre(t) }));
  return keyed.sort((a, b) => rankOf(a.t) - rankOf(b.t) || a.c - b.c || a.i - b.i).map((k) => k.t);
}

function pipeOf(edge: Edge, from: Placed, to: Placed, alone: boolean): Pipe {
  const x1 = from.x + TILE_HALF;
  const x2 = to.x - TILE_HALF;
  const mid = (x1 + x2) / 2;
  return {
    key: `${edge.from}>${edge.to}`,
    edge,
    d: `M${x1} ${from.y} C${mid} ${from.y} ${mid} ${to.y} ${x2} ${to.y}`,
    width: pipeWidth(edge.count),
    label: alone && edge.count >= LABELLED ? `${nounOf(to.tile.kind)} ${num(edge.count)}` : "",
    // At the receiving end, so that the labels of a fan of pipes do not pile up where they leave.
    labelX: x2 - 44,
    labelY: to.y - 8,
  };
}

export function layout(board: Board): Layout {
  const suppliers = new Map<string, string[]>();
  for (const e of board.edges) suppliers.set(e.to, [...(suppliers.get(e.to) ?? []), e.from]);
  const columns = board.stages.map((_, stage) => board.tiles.filter((t) => t.stage === stage));
  const tallest = Math.max(1, ...columns.map((c) => c.length));
  const rows = new Map<string, number>();
  const tiles: Placed[] = [];
  columns.forEach((column, stage) => {
    const lift = Math.min(((tallest - column.length) * ROW) / 2, MAX_LIFT);
    ordered(column, suppliers, rows).forEach((tile, row) => {
      rows.set(tile.id, row + (tallest - column.length) / 2);
      tiles.push({ tile, x: columnX(stage, board.stages.length), y: TOP + 34 + lift + row * ROW });
    });
  });
  const at = new Map(tiles.map((p) => [p.tile.id, p]));
  const pipes = board.edges.flatMap((edge) => {
    const from = at.get(edge.from);
    const to = at.get(edge.to);
    // A pipe says what it carries only where it is the one pipe into its tile: labels on a crowd of pipes overlap.
    return from && to ? [pipeOf(edge, from, to, (suppliers.get(edge.to)?.length ?? 0) === 1)] : [];
  });
  return {
    width: BOARD_W,
    height: TOP + tallest * ROW + BOTTOM,
    columns: board.stages.map((s, i) => ({ x: columnX(i, board.stages.length), label: s.label })),
    tiles,
    pipes,
  };
}
