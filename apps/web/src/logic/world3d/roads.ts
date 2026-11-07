/**
 * Roads for a site: from the gate to every building and yard, on a coarse grid. Each route is the
 * cheapest orthogonal path that keeps clear of what stands on the land, and reusing a road already laid
 * is cheap — so routes merge into trunks and branches the way real site roads do.
 */
import {
  type Bounds,
  boundsOf,
  inflate,
  insidePolygon,
  overlapBounds,
  type Pt,
  unionOf,
} from "./plan";

export const ROAD_CELL_M = 8;

export interface RoadTarget {
  readonly id: string;
  /** Where the road should end: just outside the thing it serves. */
  readonly door: Pt;
}

export interface RoadInput {
  readonly outline: readonly Pt[];
  readonly obstacles: readonly Bounds[];
  readonly targets: readonly RoadTarget[];
  readonly gate: Pt;
  /** Width of a road and of the grid cell it is laid on, metres; `ROAD_CELL_M` when left out. */
  readonly cell?: number;
  /** Points a trunk road passes through, in order, before any target is served (the spine of a campus). */
  readonly spine?: readonly Pt[];
}

export interface RoadPlan {
  readonly cell: number;
  /** Road surface as rectangles, runs of cells merged. */
  readonly rects: readonly Bounds[];
  /** Each route's centre line, corners only, for lane marks. */
  readonly routes: ReadonlyArray<{ readonly id: string; readonly line: readonly Pt[] }>;
  /** The road cell each target ended at. */
  readonly reached: ReadonlySet<string>;
}

interface Grid {
  readonly x0: number;
  readonly z0: number;
  readonly cols: number;
  readonly rows: number;
  readonly cell: number;
  readonly blocked: Uint8Array;
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const TURN_COST = 0.6;
const ROAD_COST = 0.3;
/** Weighted A*: a slightly greedy search that finds a good road, not always the cheapest one, in a fraction of the time. */
const HEURISTIC = 0.9;

function gridFor(input: RoadInput): Grid {
  const cell = input.cell ?? ROAD_CELL_M;
  const points = [input.gate, ...input.targets.map((t) => t.door), ...(input.spine ?? [])];
  const around = unionOf([boundsOf(points), ...input.obstacles]) as Bounds;
  const b = inflate(around, cell * 6);
  const cols = Math.ceil((b.x1 - b.x0) / cell);
  const rows = Math.ceil((b.z1 - b.z0) / cell);
  const blocked = new Uint8Array(cols * rows);
  const keepOff = input.obstacles.map((o) => inflate(o, cell * 0.75));
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const c = { x: b.x0 + (i + 0.5) * cell, z: b.z0 + (j + 0.5) * cell };
      const cellBox = { x0: c.x - 1, z0: c.z - 1, x1: c.x + 1, z1: c.z + 1 };
      if (!insidePolygon(c, input.outline) || keepOff.some((o) => overlapBounds(o, cellBox)))
        blocked[j * cols + i] = 1;
    }
  return { x0: b.x0, z0: b.z0, cols, rows, cell, blocked };
}

const cellOf = (g: Grid, p: Pt): [number, number] => [
  Math.min(g.cols - 1, Math.max(0, Math.floor((p.x - g.x0) / g.cell))),
  Math.min(g.rows - 1, Math.max(0, Math.floor((p.z - g.z0) / g.cell))),
];

/** The free cell nearest to a point (the point's own cell when it is free). */
function freeCellNear(g: Grid, p: Pt): number | undefined {
  const [ci, cj] = cellOf(g, p);
  for (let r = 0; r < 12; r++)
    for (let dj = -r; dj <= r; dj++)
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ci + di;
        const j = cj + dj;
        if (i >= 0 && j >= 0 && i < g.cols && j < g.rows && !g.blocked[j * g.cols + i])
          return j * g.cols + i;
      }
  return undefined;
}

/** A small binary min-heap on (cost, state). */
class Heap {
  private readonly costs: number[] = [];
  private readonly items: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(cost: number, item: number): void {
    let i = this.items.length;
    this.items.push(item);
    this.costs.push(cost);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((this.costs[parent] as number) <= cost) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.items[0] as number;
    const lastItem = this.items.pop() as number;
    const lastCost = this.costs.pop() as number;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.costs[0] = lastCost;
      this.sift(0);
    }
    return top;
  }

  private sift(start: number): void {
    let i = start;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < this.items.length && (this.costs[l] as number) < (this.costs[m] as number)) m = l;
      if (r < this.items.length && (this.costs[r] as number) < (this.costs[m] as number)) m = r;
      if (m === i) return;
      this.swap(i, m);
      i = m;
    }
  }

  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b] as number, this.items[a] as number];
    [this.costs[a], this.costs[b]] = [this.costs[b] as number, this.costs[a] as number];
  }
}

const inside = (g: Grid, i: number, j: number): boolean =>
  i >= 0 && j >= 0 && i < g.cols && j < g.rows;

/** Cheapest path (cells, start first) from one cell to another, turns and fresh ground costing more. */
function route(g: Grid, road: Uint8Array, from: number, to: number): number[] | undefined {
  const states = g.cols * g.rows * 4;
  const best = new Float64Array(states).fill(Number.POSITIVE_INFINITY);
  const prev = new Int32Array(states).fill(-1);
  const heap = new Heap();
  const toI = to % g.cols;
  const toJ = Math.floor(to / g.cols);
  const estimate = (cell: number) =>
    (Math.abs((cell % g.cols) - toI) + Math.abs(Math.floor(cell / g.cols) - toJ)) * HEURISTIC;
  for (let d = 0; d < 4; d++) {
    best[from * 4 + d] = 0;
    heap.push(estimate(from), from * 4 + d);
  }
  while (heap.size > 0) {
    const state = heap.pop();
    const cell = state >> 2;
    const dir = state & 3;
    if (cell === to) return trace(prev, state);
    const i = cell % g.cols;
    const j = Math.floor(cell / g.cols);
    for (let nd = 0; nd < 4; nd++) {
      const [di, dj] = DIRS[nd] as readonly [number, number];
      const ni = i + di;
      const nj = j + dj;
      if (!inside(g, ni, nj)) continue;
      const next = nj * g.cols + ni;
      if (g.blocked[next] && next !== to) continue;
      const step = (road[next] ? ROAD_COST : 1) + (nd === dir ? 0 : TURN_COST);
      const cost = (best[state] as number) + step;
      const ns = next * 4 + nd;
      if (cost < (best[ns] as number)) {
        best[ns] = cost;
        prev[ns] = state;
        heap.push(cost + estimate(next), ns);
      }
    }
  }
  return undefined;
}

function trace(prev: Int32Array, end: number): number[] {
  const cells: number[] = [];
  for (let s = end; s >= 0; s = prev[s] as number) cells.push(s >> 2);
  return cells.reverse();
}

/** A path's corners, in plan coordinates. */
function corners(g: Grid, cells: readonly number[]): Pt[] {
  const at = (c: number): Pt => ({
    x: g.x0 + ((c % g.cols) + 0.5) * g.cell,
    z: g.z0 + (Math.floor(c / g.cols) + 0.5) * g.cell,
  });
  const out: Pt[] = [];
  for (let k = 0; k < cells.length; k++) {
    const p = at(cells[k] as number);
    const a = out.at(-2);
    const b = out.at(-1);
    if (a && b && ((a.x === b.x && b.x === p.x) || (a.z === b.z && b.z === p.z)))
      out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

/** Cells of road as rectangles: each row's runs, stacked where they repeat. */
function rectsOf(g: Grid, road: Uint8Array): Bounds[] {
  const rects: Bounds[] = [];
  let open = new Map<string, { i0: number; i1: number; j0: number }>();
  const close = (r: { i0: number; i1: number; j0: number }, j1: number) =>
    rects.push({
      x0: g.x0 + r.i0 * g.cell,
      z0: g.z0 + r.j0 * g.cell,
      x1: g.x0 + (r.i1 + 1) * g.cell,
      z1: g.z0 + j1 * g.cell,
    });
  for (let j = 0; j <= g.rows; j++) {
    const now = new Map<string, { i0: number; i1: number; j0: number }>();
    for (let i = 0; j < g.rows && i < g.cols; i++) {
      if (!road[j * g.cols + i]) continue;
      let k = i;
      while (k + 1 < g.cols && road[j * g.cols + k + 1]) k++;
      const key = `${i}-${k}`;
      now.set(key, open.get(key) ?? { i0: i, i1: k, j0: j });
      i = k;
    }
    for (const [key, r] of open) if (!now.has(key)) close(r, j);
    open = now;
  }
  return rects;
}

/** Lay roads from the gate: the spine first if there is one, then to every target. */
export function planRoads(input: RoadInput): RoadPlan {
  const g = gridFor(input);
  const road = new Uint8Array(g.cols * g.rows);
  const routes: Array<{ id: string; line: Pt[] }> = [];
  const reached = new Set<string>();
  const start = freeCellNear(g, input.gate);
  if (start === undefined) return { cell: g.cell, rects: [], routes, reached };
  road[start] = 1;
  // Each end of the spine is its own road from the gate, so no vehicle has to turn right round on it.
  for (const [n, wp] of (input.spine ?? []).entries()) {
    const to = freeCellNear(g, wp);
    const cells = to === undefined ? undefined : route(g, road, start, to);
    if (!cells) continue;
    for (const c of cells) road[c] = 1;
    routes.push({ id: `spine:${n}`, line: corners(g, cells) });
  }
  const ordered = [...input.targets].sort(
    (a, b) =>
      Math.hypot(a.door.x - input.gate.x, a.door.z - input.gate.z) -
      Math.hypot(b.door.x - input.gate.x, b.door.z - input.gate.z),
  );
  for (const target of ordered) {
    const to = freeCellNear(g, target.door);
    const cells = to === undefined ? undefined : route(g, road, start, to);
    if (!cells) continue;
    for (const c of cells) road[c] = 1;
    routes.push({ id: target.id, line: corners(g, cells) });
    reached.add(target.id);
  }
  return { cell: g.cell, rects: rectsOf(g, road), routes, reached };
}
