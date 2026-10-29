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

function rasterize(outline: Outline): Grid {
  const box = outlineBounds(outline);
  const nx = Math.ceil(box.w / CELL_M);
  const ny = Math.ceil(box.d / CELL_M);
  const free = new Uint8Array(nx * ny);
  for (let iy = 0; iy < ny; iy++)
    for (let ix = 0; ix < nx; ix++)
      free[iy * nx + ix] = pointInOutline(
        { x: box.x + (ix + 0.5) * CELL_M, y: box.y + (iy + 0.5) * CELL_M },
        outline,
      )
        ? 1
        : 0;
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
