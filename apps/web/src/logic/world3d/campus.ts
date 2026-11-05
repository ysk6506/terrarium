/**
 * The campus around the buildings of a site (REQ-006, REQ-048). The blueprint holds the fabs, halls and
 * plant yards; a real campus also has streets, paved yards, offices, dormitories, car parks, the
 * utility plant, sports grounds, ponds and, on a growing site, building sites. They are not entities
 * anyone edits, so they are laid out here from the land alone: the land near the buildings is cut into
 * square blocks along a street grid, the ones that fit the land and keep clear of what stands on it get
 * a use, and each use is a fixed layout (`campus-layouts`). Everything follows from the land and the
 * buildings, so the same site always looks the same.
 */
import {
  type BlockUse,
  type LocalLot,
  type LocalTree,
  layoutOf,
  type Piece,
} from "./campus-layouts";
import { isStructure, type Plot, structuresOf } from "./campus-structures";
import { type Bounds, inflate, insidePolygon, overlapBounds, type Pt, unit } from "./plan";
import type { Car, ParkingLot, Tree } from "./scatter";

export type { BlockUse, Piece, PieceKind } from "./campus-layouts";

/** One block and the street around it: 96 m a side, 12 m of it street (half on each side). */
export const CELL_M = 96;
export const STREET_M = 12;
const MAX_BLOCKS = 200;
const MIN_REACH_M = 260;
const MAX_REACH_M = 620;
const LAMP_PITCH_M = 48;
const BAY_PITCH_M = 3.6;
const BAY_DEPTH_M = 5.4;
const PAINTS = 6;

export interface Block {
  readonly use: BlockUse;
  /** The block with half its streets. */
  readonly cell: Bounds;
  readonly centre: Pt;
  /** Quarter turns the layout was given, so the same use does not always face the same way. */
  readonly turn: number;
  readonly pieces: readonly Piece[];
}

export interface Street {
  readonly area: Bounds;
  /** The way it runs, for lane marks. */
  readonly along: "x" | "z";
}

export interface Campus {
  readonly blocks: readonly Block[];
  readonly streets: readonly Street[];
  /** Paved ground around each building, as far as the land allows. */
  readonly aprons: readonly Bounds[];
  /** Ground where the map shows a building this world does not build: cleared and left empty. */
  readonly cleared: readonly Bounds[];
  /** The buildings of the campus that the map shows and the world does not model, as pieces on their plots. */
  readonly structures: readonly Piece[];
  readonly lamps: readonly Pt[];
  readonly trees: readonly Tree[];
  readonly lots: readonly ParkingLot[];
  /** Everything a block holds, streets included: land the random forest keeps out of. */
  readonly occupied: readonly Bounds[];
}

export interface CampusInput {
  readonly outline: readonly Pt[];
  readonly buildings: readonly Bounds[];
  readonly yards: readonly Bounds[];
  readonly roads: readonly Bounds[];
  /** Land that is spoken for: parcels, parking lots. */
  readonly avoid: readonly Bounds[];
  /**
   * Where the map shows a fab, hall or tower that is not built: kept clear, and counted as a building to
   * build round. A plot with the kind of a campus building (an office, the plant, a substation) has that
   * building drawn on it instead of being left bare.
   */
  readonly reserved?: readonly Plot[];
  readonly cluster: Bounds;
  readonly landM2: number;
  readonly seed: number;
}

interface Cell {
  readonly i: number;
  readonly j: number;
  readonly rect: Bounds;
  readonly centre: Pt;
  /** Distance to the nearest building or yard. */
  readonly dist: number;
}

const key = (i: number, j: number): string => `${i},${j}`;

export function distanceTo(p: Pt, b: Bounds): number {
  return Math.hypot(Math.max(b.x0 - p.x, 0, p.x - b.x1), Math.max(b.z0 - p.z, 0, p.z - b.z1));
}

/** How far from the buildings the campus reaches: further on bigger land. */
export const reachOf = (landM2: number): number =>
  Math.min(MAX_REACH_M, Math.max(MIN_REACH_M, Math.sqrt(Math.max(0, landM2)) * 0.36));

function insideLand(area: Bounds, outline: readonly Pt[]): boolean {
  const mx = (area.x0 + area.x1) / 2;
  const mz = (area.z0 + area.z1) / 2;
  const xs = [area.x0, mx, area.x1];
  const zs = [area.z0, mz, area.z1];
  return xs.every((x) => zs.every((z) => insidePolygon({ x, z }, outline)));
}

/** Blocks that fit the land and keep off buildings, yards, unbuilt places, roads and land for sale, nearest first. */
function candidates(input: CampusInput): Cell[] {
  const built = [...input.buildings, ...input.yards];
  const reserved = input.reserved ?? [];
  const anchors = [...built, ...reserved];
  const reach = reachOf(input.landM2);
  const region = inflate(input.cluster, reach);
  const clear = [
    ...anchors.map((b) => inflate(b, 16)),
    ...input.roads.map((r) => inflate(r, 6)),
    ...input.avoid,
  ];
  const cells: Cell[] = [];
  for (let j = Math.floor(region.z0 / CELL_M); j <= Math.ceil(region.z1 / CELL_M); j++)
    for (let i = Math.floor(region.x0 / CELL_M); i <= Math.ceil(region.x1 / CELL_M); i++) {
      const rect = { x0: i * CELL_M, z0: j * CELL_M, x1: (i + 1) * CELL_M, z1: (j + 1) * CELL_M };
      const centre = { x: rect.x0 + CELL_M / 2, z: rect.z0 + CELL_M / 2 };
      const dist = Math.min(...anchors.map((b) => distanceTo(centre, b)));
      if (dist > reach) continue;
      const fit = inflate(rect, -2);
      if (!insideLand(fit, input.outline) || clear.some((c) => overlapBounds(c, fit))) continue;
      cells.push({ i, j, rect, centre, dist });
    }
  return cells.sort((a, b) => a.dist - b.dist || a.j - b.j || a.i - b.i).slice(0, MAX_BLOCKS);
}

/** The first blocks nearest the buildings, in this order, so every campus has the usual things. */
const FIRST: readonly BlockUse[] = [
  "office",
  "deck",
  "office",
  "dorm",
  "sports",
  "office",
  "pond",
  "dorm",
  "warehouse",
  "park",
];

type Band = "near" | "mid" | "far";

const WEIGHTS: Readonly<Record<Band, ReadonlyArray<readonly [BlockUse, number]>>> = {
  near: [
    ["office", 3],
    ["deck", 2],
    ["utility", 1.5],
    ["dorm", 1],
    ["tanks", 1],
  ],
  mid: [
    ["dorm", 3],
    ["office", 2],
    ["deck", 1],
    ["sports", 1.5],
    ["pond", 1],
    ["warehouse", 1.5],
    ["utility", 1],
    ["park", 1],
    ["construction", 1],
  ],
  far: [
    ["construction", 3],
    ["park", 1.5],
    ["lawn", 3],
    ["pond", 1],
    ["sports", 1],
    ["warehouse", 1],
  ],
};

const bandOf = (dist: number, reach: number): Band =>
  dist < reach * 0.3 ? "near" : dist < reach * 0.65 ? "mid" : "far";

function weighted(list: ReadonlyArray<readonly [BlockUse, number]>, u: number): BlockUse {
  const total = list.reduce((sum, [, w]) => sum + w, 0);
  let left = u * total;
  for (const [use, w] of list) {
    left -= w;
    if (left < 0) return use;
  }
  return (list[list.length - 1] as readonly [BlockUse, number])[0];
}

/** Every building gets the utility plant of a block next to it; the rest follow the order and the weights. */
export function assignUses(
  cells: readonly Cell[],
  buildings: readonly Bounds[],
  reach: number,
  seed: number,
): Map<string, BlockUse> {
  const uses = new Map<string, BlockUse>();
  for (const b of buildings) {
    const free = cells.filter((c) => !uses.has(key(c.i, c.j)));
    const best = free.reduce<Cell | undefined>(
      (a, c) => (!a || distanceTo(c.centre, b) < distanceTo(a.centre, b) ? c : a),
      undefined,
    );
    if (best) uses.set(key(best.i, best.j), "utility");
  }
  let n = 0;
  for (const c of cells) {
    if (uses.has(key(c.i, c.j))) continue;
    const use =
      FIRST[n] ?? weighted(WEIGHTS[bandOf(c.dist, reach)], unit(c.i * 7 + seed, c.j * 13));
    uses.set(key(c.i, c.j), use);
    n++;
  }
  return uses;
}

/** The street segments around the used blocks: runs of one block's length, each laid once. */
export function streetsOf(used: ReadonlySet<string>): Street[] {
  const half = STREET_M / 2;
  const edges = new Map<string, Street>();
  const across = (i: number, j: number) =>
    edges.set(`h${i},${j}`, {
      along: "x",
      area: {
        x0: i * CELL_M - half,
        x1: (i + 1) * CELL_M - half,
        z0: j * CELL_M - half,
        z1: j * CELL_M + half,
      },
    });
  const down = (i: number, j: number) =>
    edges.set(`v${i},${j}`, {
      along: "z",
      area: {
        x0: i * CELL_M - half,
        x1: i * CELL_M + half,
        z0: j * CELL_M + half,
        z1: (j + 1) * CELL_M - half,
      },
    });
  for (const id of used) {
    const [i, j] = id.split(",").map(Number) as [number, number];
    across(i, j);
    across(i, j + 1);
    down(i, j);
    down(i + 1, j);
  }
  return [...edges.values()].sort((a, b) => a.area.z0 - b.area.z0 || a.area.x0 - b.area.x0);
}

/** Lamps along both sides of a street, one every `LAMP_PITCH_M`, alternating. */
export function lampsOf(streets: readonly Street[], outline: readonly Pt[]): Pt[] {
  const side = STREET_M / 2 + 0.6;
  const lamps: Pt[] = [];
  for (const s of streets) {
    const a = s.area;
    const [from, to] = s.along === "x" ? [a.x0, a.x1] : [a.z0, a.z1];
    const mid = s.along === "x" ? (a.z0 + a.z1) / 2 : (a.x0 + a.x1) / 2;
    for (let t = from + LAMP_PITCH_M / 2, k = 0; t < to; t += LAMP_PITCH_M, k++) {
      const off = k % 2 === 0 ? -side : side;
      const p = s.along === "x" ? { x: t, z: mid + off } : { x: mid + off, z: t };
      if (insidePolygon(p, outline)) lamps.push(p);
    }
  }
  return lamps;
}

/** Paved ground around a building: as wide as the land lets it be, up to 22 m. */
export function apronOf(b: Bounds, outline: readonly Pt[]): Bounds | undefined {
  for (const margin of [22, 12, 6]) {
    const apron = inflate(b, margin);
    if (insideLand(apron, outline)) return apron;
  }
  return undefined;
}

const QUARTER_COS = [1, 0, -1, 0] as const;
const QUARTER_SIN = [0, 1, 0, -1] as const;

/** A point of a block's frame turned by whole quarter turns about the vertical axis. */
export function turned(x: number, z: number, quarter: number): Pt {
  const c = QUARTER_COS[quarter] as number;
  const s = QUARTER_SIN[quarter] as number;
  // `+ 0` turns a negative zero into a plain one.
  return { x: x * c + z * s + 0, z: -x * s + z * c + 0 };
}

function carsOf(lot: LocalLot, centre: Pt, quarter: number, seed: number): Car[] {
  const perRow = Math.floor(lot.w / BAY_PITCH_M);
  const rowZ = lot.d / 2 - BAY_DEPTH_M / 2 - 1;
  const cars: Car[] = [];
  for (const [row, z] of [-rowZ, rowZ].entries())
    for (let i = 0; i < perRow; i++) {
      if (unit(i + row * 97, seed) > lot.fill) continue;
      const at = turned(lot.x - lot.w / 2 + (i + 0.5) * BAY_PITCH_M, lot.z + z, quarter);
      cars.push({
        x: centre.x + at.x,
        z: centre.z + at.z,
        rot: Math.PI / 2 + (row === 0 ? 0 : Math.PI) + (quarter * Math.PI) / 2,
        paint: Math.floor(unit(i, seed + row) * PAINTS),
        ...(lot.y > 0 ? { y: lot.y } : {}),
      });
    }
  return cars;
}

function lotBounds(lot: LocalLot, centre: Pt, quarter: number): Bounds {
  const c = turned(lot.x, lot.z, quarter);
  const swap = quarter % 2 === 1;
  const hw = (swap ? lot.d : lot.w) / 2;
  const hd = (swap ? lot.w : lot.d) / 2;
  return {
    x0: centre.x + c.x - hw,
    z0: centre.z + c.z - hd,
    x1: centre.x + c.x + hw,
    z1: centre.z + c.z + hd,
  };
}

function treeOf(t: LocalTree, centre: Pt, quarter: number): Tree {
  const at = turned(t.x, t.z, quarter);
  return { x: centre.x + at.x, z: centre.z + at.z, scale: t.scale, tint: t.tint };
}

function blockOf(cell: Cell, use: BlockUse, seed: number) {
  const s = (cell.i * 1009 + cell.j * 9173 + seed) | 0;
  const quarter = Math.floor(unit(cell.i + 3, cell.j - 5) * 4);
  const layout = layoutOf(use, s);
  const centre = cell.centre;
  const pieces = layout.pieces.map((p) => {
    const at = turned(p.x, p.z, quarter);
    return { ...p, x: centre.x + at.x, z: centre.z + at.z, rot: p.rot + (quarter * Math.PI) / 2 };
  });
  const block: Block = { use, cell: cell.rect, centre, turn: quarter, pieces };
  const trees = layout.trees.map((t) => treeOf(t, centre, quarter));
  const lots: ParkingLot[] = layout.lots.map((lot, n) => ({
    forId: `block:${cell.i},${cell.j}`,
    area: lotBounds(lot, centre, quarter),
    cars: carsOf(lot, centre, quarter, s + n * 31),
  }));
  return { block, trees, lots };
}

/** The campus of a site: blocks and streets near the buildings, paved aprons, lamps, trees and cars. */
export function planCampus(input: CampusInput): Campus {
  const cells = candidates(input);
  const uses = assignUses(cells, input.buildings, reachOf(input.landM2), input.seed);
  const made = cells.map((c) => blockOf(c, uses.get(key(c.i, c.j)) as BlockUse, input.seed));
  const streets = streetsOf(new Set(cells.map((c) => key(c.i, c.j))));
  return {
    blocks: made.map((m) => m.block),
    streets,
    aprons: input.buildings.flatMap((b) => apronOf(b, input.outline) ?? []),
    cleared: (input.reserved ?? []).filter((p) => !isStructure(p.kind)),
    structures: structuresOf(input.reserved ?? []),
    lamps: lampsOf(streets, input.outline),
    trees: made.flatMap((m) => m.trees),
    lots: made.flatMap((m) => m.lots),
    occupied: cells.map((c) => inflate(c.rect, 2)),
  };
}
