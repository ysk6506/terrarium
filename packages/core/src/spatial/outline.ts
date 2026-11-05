/**
 * Land outlines (REQ-048): the shape of a site as a polygon in metres, and what can be done with it —
 * test whether a building stands inside, find room for more buildings, read a shape from map data.
 * Shapes are approximate by design: relative proportions matter, not survey accuracy.
 */
import type { Point, Rect } from "./geometry";
import type { PackedItem, SizedItem } from "./packing";

export type Outline = readonly Point[];

/** Resolution of the grid used to find room for buildings, metres. */
const CELL_M = 5;

export function outlineBounds(outline: Outline): Rect {
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, d: Math.max(...ys) - y };
}

/** Area enclosed, m² (shoelace formula). */
export function outlineArea(outline: Outline): number {
  let sum = 0;
  outline.forEach((p, i) => {
    const q = outline[(i + 1) % outline.length] as Point;
    sum += p.x * q.y - q.x * p.y;
  });
  return Math.abs(sum) / 2;
}

/** Ray casting: whether a point lies inside the polygon. */
export function pointInOutline(p: Point, outline: Outline): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i] as Point;
    const b = outline[j] as Point;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

const SAMPLES = 8;

/**
 * Whether a rectangle lies inside the outline, give or take `tolerance` metres at the edge. Checked
 * on a grid of points over the rectangle, plus any outline corner poking into it.
 */
export function rectInOutline(rect: Rect, outline: Outline, tolerance = 3): boolean {
  const inset = Math.min(tolerance, rect.w / 3, rect.d / 3);
  const r = { x: rect.x + inset, y: rect.y + inset, w: rect.w - 2 * inset, d: rect.d - 2 * inset };
  for (let i = 0; i <= SAMPLES; i++)
    for (let j = 0; j <= SAMPLES; j++)
      if (!pointInOutline({ x: r.x + (r.w * i) / SAMPLES, y: r.y + (r.d * j) / SAMPLES }, outline))
        return false;
  return !outline.some((p) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.d);
}

/** `"x,y;x,y;…"`: how an outline is kept in an entity's props. */
export function encodeOutline(outline: Outline): string {
  return outline.map((p) => `${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10}`).join(";");
}

/** The outline stored in a prop, or undefined when it is missing or not a polygon. */
export function parseOutline(text: unknown): Outline | undefined {
  if (typeof text !== "string" || text === "") return undefined;
  const points = text.split(";").map((pair) => {
    const [x, y] = pair.split(",").map(Number);
    return { x: x as number, y: y as number };
  });
  const valid =
    points.length >= 3 && points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  return valid ? points : undefined;
}

/**
 * Whose ground a plot is. `fab`, `dc` and `lab` are places the map gives a fab, a data-centre building or a
 * research tower that this world does not build; `lot` is bare ground set aside (a planned site). The rest
 * are buildings of the campus the map shows but the world does not model (offices, plant, water works,
 * substations, a logistics centre, a building site): they are drawn where the map puts them.
 */
export type PlotKind = (typeof PLOT_KINDS)[number];

/** Ground where the map shows a building that this world does not build: kept clear, not built over. */
export interface ReservedPlot extends Rect {
  readonly kind: PlotKind;
}

export const PLOT_KINDS = [
  "fab",
  "dc",
  "lab",
  "lot",
  "office",
  "utility",
  "tanks",
  "substation",
  "warehouse",
  "construction",
] as const;

/** The kinds of plot that stay bare; every other kind is a building drawn on its ground. */
export const CLEARED_PLOT_KINDS: readonly PlotKind[] = ["fab", "dc", "lab", "lot"];

/** `"kind:x,y,w,d;…"`: how reserved plots are kept in an entity's props (corner and size, metres). */
export function encodeReserved(plots: readonly ReservedPlot[]): string {
  return plots.map((p) => `${p.kind}:${p.x},${p.y},${p.w},${p.d}`).join(";");
}

/** The plots stored in a prop; anything unreadable is left out. */
export function parseReserved(text: unknown): ReservedPlot[] {
  if (typeof text !== "string" || text === "") return [];
  return text.split(";").flatMap((part) => {
    const [kind, nums = ""] = part.split(":");
    const [x, y, w, d] = nums.split(",").map(Number);
    const plot = {
      kind: kind as PlotKind,
      x: x as number,
      y: y as number,
      w: w as number,
      d: d as number,
    };
    const ok =
      (PLOT_KINDS as readonly string[]).includes(plot.kind) &&
      [plot.x, plot.y, plot.w, plot.d].every(Number.isFinite);
    return ok && plot.w > 0 && plot.d > 0 ? [plot] : [];
  });
}

/** The outline moved so its bounding box starts at (0, 0) and scaled by `factor`. */
export function normalizeOutline(outline: Outline, factor = 1): Outline {
  const box = outlineBounds(outline);
  return outline.map((p) => ({ x: (p.x - box.x) * factor, y: (p.y - box.y) * factor }));
}

/**
 * An outline from map coordinates ([longitude, latitude] pairs, e.g. one GeoJSON ring): a flat
 * projection around the shape's centre, north up, in metres, starting at (0, 0).
 */
export function outlineFromLonLat(ring: ReadonlyArray<readonly [number, number]>): Outline {
  const ring2 =
    ring.length > 3 && sameCorner(ring[0], ring[ring.length - 1]) ? ring.slice(0, -1) : ring;
  const lat0 = ring2.reduce((s, p) => s + p[1], 0) / ring2.length;
  const mPerLon = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  return normalizeOutline(ring2.map((p) => ({ x: p[0] * mPerLon, y: -p[1] * 110_540 })));
}

function sameCorner(a?: readonly [number, number], b?: readonly [number, number]): boolean {
  return a !== undefined && b !== undefined && a[0] === b[0] && a[1] === b[1];
}

interface Grid {
  readonly box: Rect;
  readonly nx: number;
  readonly ny: number;
  readonly free: Uint8Array;
}

/** Shortest distance from a point to the outline's edge, metres. */
export function edgeDistance(p: Point, outline: Outline): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[j] as Point;
    const b = outline[i] as Point;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t =
      len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

/** The cells of the land that are inside the outline and at least `setback` metres from its edge. */
function rasterize(outline: Outline, setback = 0): Grid {
  const box = outlineBounds(outline);
  const nx = Math.ceil(box.w / CELL_M);
  const ny = Math.ceil(box.d / CELL_M);
  const free = new Uint8Array(nx * ny);
  for (let iy = 0; iy < ny; iy++)
    for (let ix = 0; ix < nx; ix++) {
      const at = { x: box.x + (ix + 0.5) * CELL_M, y: box.y + (iy + 0.5) * CELL_M };
      const inside = pointInOutline(at, outline);
      free[iy * nx + ix] = inside && (setback <= 0 || edgeDistance(at, outline) >= setback) ? 1 : 0;
    }
  return { box, nx, ny, free };
}

/** Running totals so "is this block of cells all free" is a constant-time question. */
function prefixSums(grid: Grid): Int32Array {
  const stride = grid.nx + 1;
  const sums = new Int32Array(stride * (grid.ny + 1));
  for (let iy = 0; iy < grid.ny; iy++)
    for (let ix = 0; ix < grid.nx; ix++)
      sums[(iy + 1) * stride + ix + 1] =
        (grid.free[iy * grid.nx + ix] as number) +
        (sums[iy * stride + ix + 1] as number) +
        (sums[(iy + 1) * stride + ix] as number) -
        (sums[iy * stride + ix] as number);
  return sums;
}

function firstFit(grid: Grid, sums: Int32Array, cw: number, cd: number) {
  const stride = grid.nx + 1;
  for (let iy = 0; iy + cd <= grid.ny; iy++)
    for (let ix = 0; ix + cw <= grid.nx; ix++) {
      const total =
        (sums[(iy + cd) * stride + ix + cw] as number) -
        (sums[iy * stride + ix + cw] as number) -
        (sums[(iy + cd) * stride + ix] as number) +
        (sums[iy * stride + ix] as number);
      if (total === cw * cd) return { ix, iy };
    }
  return undefined;
}

export interface OutlinePacking {
  readonly placed: PackedItem[];
  /** Ids of the items that found no room. */
  readonly unplaced: string[];
}

/**
 * Place rectangles inside an outline, big ones first, each at the first free spot reading from the
 * top-left, with `gap` metres kept between them and the edge. Same input, same result.
 */
export function packInOutline(
  items: readonly SizedItem[],
  outline: Outline,
  gap: number,
): OutlinePacking {
  const grid = rasterize(outline);
  const order = [...items].sort((a, b) => b.w * b.d - a.w * a.d || (a.id < b.id ? -1 : 1));
  const placed: PackedItem[] = [];
  const unplaced: string[] = [];
  for (const item of order) {
    const cw = Math.ceil((item.w + gap) / CELL_M);
    const cd = Math.ceil((item.d + gap) / CELL_M);
    const spot = firstFit(grid, prefixSums(grid), cw, cd);
    if (!spot) {
      unplaced.push(item.id);
      continue;
    }
    for (let y = spot.iy; y < spot.iy + cd; y++)
      for (let x = spot.ix; x < spot.ix + cw; x++) grid.free[y * grid.nx + x] = 0;
    placed.push({
      id: item.id,
      x: grid.box.x + spot.ix * CELL_M + gap / 2,
      y: grid.box.y + spot.iy * CELL_M + gap / 2,
      w: item.w,
      d: item.d,
    });
  }
  return { placed: placed.sort((a, b) => (a.id < b.id ? -1 : 1)), unplaced: unplaced.sort() };
}

/** A rectangle to place; `near` is where it would like to stand (the middle of the free ground when omitted). */
export interface SpreadItem extends SizedItem {
  readonly near?: Point;
}

export interface SpreadOptions {
  /** Metres between one building and the next (the road and plant between them). */
  readonly gap: number;
  /** Metres kept clear between a building and the edge of the land. */
  readonly setback: number;
  /** Rectangles that already stand, in the outline's frame: new buildings keep clear of them. */
  readonly taken?: readonly Rect[];
  /** An item with a `near` is left unplaced rather than put farther than this from it, metres. */
  readonly reach?: number;
}

/** Take the cells under a rectangle (and `margin` metres around it) out of the free ones. */
function block(grid: Grid, rect: Rect, margin: number): void {
  const x0 = Math.max(0, Math.floor((rect.x - margin - grid.box.x) / CELL_M));
  const y0 = Math.max(0, Math.floor((rect.y - margin - grid.box.y) / CELL_M));
  const x1 = Math.min(grid.nx, Math.ceil((rect.x + rect.w + margin - grid.box.x) / CELL_M));
  const y1 = Math.min(grid.ny, Math.ceil((rect.y + rect.d + margin - grid.box.y) / CELL_M));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) grid.free[y * grid.nx + x] = 0;
}

/** Where the free cells are on average, or the middle of the box when none are. */
function centreOfFree(grid: Grid): Point {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let iy = 0; iy < grid.ny; iy++)
    for (let ix = 0; ix < grid.nx; ix++)
      if (grid.free[iy * grid.nx + ix]) {
        sx += ix + 0.5;
        sy += iy + 0.5;
        n++;
      }
  if (n === 0) return { x: grid.box.x + grid.box.w / 2, y: grid.box.y + grid.box.d / 2 };
  return { x: grid.box.x + (sx / n) * CELL_M, y: grid.box.y + (sy / n) * CELL_M };
}

/** The free spot for a block of cw × cd cells whose middle is nearest `target`. */
function nearestFit(
  grid: Grid,
  sums: Int32Array,
  cw: number,
  cd: number,
  target: Point,
  reach = Number.POSITIVE_INFINITY,
) {
  const stride = grid.nx + 1;
  let best: { ix: number; iy: number } | undefined;
  let bestD = reach * reach;
  for (let iy = 0; iy + cd <= grid.ny; iy++)
    for (let ix = 0; ix + cw <= grid.nx; ix++) {
      const total =
        (sums[(iy + cd) * stride + ix + cw] as number) -
        (sums[iy * stride + ix + cw] as number) -
        (sums[(iy + cd) * stride + ix] as number) +
        (sums[iy * stride + ix] as number);
      if (total !== cw * cd) continue;
      const mx = grid.box.x + (ix + cw / 2) * CELL_M;
      const my = grid.box.y + (iy + cd / 2) * CELL_M;
      const d = (mx - target.x) ** 2 + (my - target.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { ix, iy };
      }
    }
  return best;
}

/**
 * Place rectangles inside an outline the way a campus is laid out: well in from the edge of the land,
 * with a road's width between them, gathered round the middle of the free ground (or round what
 * already stands) instead of piled against one corner. Big ones first; same input, same result.
 */
export function packSpread(
  items: readonly SpreadItem[],
  outline: Outline,
  options: SpreadOptions,
): OutlinePacking {
  const { gap, setback, taken = [], reach } = options;
  const grid = rasterize(outline, setback);
  for (const rect of taken) block(grid, rect, gap / 2);
  const around = taken.length > 0 ? centreOfTaken(taken) : centreOfFree(grid);
  const order = [...items].sort((a, b) => b.w * b.d - a.w * a.d || (a.id < b.id ? -1 : 1));
  const placed: PackedItem[] = [];
  const unplaced: string[] = [];
  for (const item of order) {
    const cw = Math.ceil((item.w + gap) / CELL_M);
    const cd = Math.ceil((item.d + gap) / CELL_M);
    const spot = item.near
      ? nearestFit(grid, prefixSums(grid), cw, cd, item.near, reach)
      : nearestFit(grid, prefixSums(grid), cw, cd, around);
    if (!spot) {
      unplaced.push(item.id);
      continue;
    }
    for (let y = spot.iy; y < spot.iy + cd; y++)
      for (let x = spot.ix; x < spot.ix + cw; x++) grid.free[y * grid.nx + x] = 0;
    placed.push({
      id: item.id,
      x: grid.box.x + spot.ix * CELL_M + gap / 2,
      y: grid.box.y + spot.iy * CELL_M + gap / 2,
      w: item.w,
      d: item.d,
    });
  }
  return { placed: placed.sort((a, b) => (a.id < b.id ? -1 : 1)), unplaced: unplaced.sort() };
}

function centreOfTaken(rects: readonly Rect[]): Point {
  const n = rects.length;
  return {
    x: rects.reduce((s, r) => s + r.x + r.w / 2, 0) / n,
    y: rects.reduce((s, r) => s + r.y + r.d / 2, 0) / n,
  };
}
