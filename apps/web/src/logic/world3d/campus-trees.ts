/**
 * Trees of the campus plan (REQ-105): a line along the fence (3 to 4 m apart, 1.5 m inside), a line down
 * each side of every road (every 8 m, 3.2 m off its edge), and small groves on grass nobody uses. No tree
 * stands within 3 m of a building, an apron, a road, a lot or a yard, and none within 3 m of another.
 */
import { Keep, rng, Spread } from "./campus-geom";
import type { PlanTree } from "./campus-plan-types";
import { type Bounds, boundsOf, inflate, insidePolygon, type Pt } from "./plan";

export const TREE_GAP_M = 3;
export const CLEAR_M = 3;
const FENCE_IN_M = 1.5;
const ROAD_SIDE_M = 3.2;
const ROAD_PITCH_M = 8;
const GROVE_CELL_M = 6;
const GROVE_MIN_M2 = 100;
const GROVE_REACH_M = 130;
export const TREES_MAX = 2600;

export interface TreeInput {
  readonly outline: readonly Pt[];
  readonly gate: Pt;
  /** Ground trees keep 3 m off: buildings and their aprons, roads, lots, yards, land for sale, blocks. */
  readonly keep: readonly Bounds[];
  /** Centre lines of the roads, corners only, and the road's width. */
  readonly lines: ReadonlyArray<readonly Pt[]>;
  readonly roadWidth: number;
  readonly cluster: Bounds;
  readonly seed: number;
}

class Planter {
  readonly trees: PlanTree[] = [];
  private readonly spread = new Spread(TREE_GAP_M);
  private readonly keep = new Keep(CLEAR_M + 1);
  readonly random: () => number;

  constructor(private readonly input: TreeInput) {
    for (const b of input.keep) this.keep.add(b);
    this.random = rng(input.seed * 6151 + 29);
  }

  clear(p: Pt): boolean {
    return !this.keep.near(p, CLEAR_M);
  }

  /** Plant a tree if the spot is on the land, clear of everything and 3 m from the others. */
  try(p: Pt, row: PlanTree["row"], scale: readonly [number, number]): boolean {
    if (this.trees.length >= TREES_MAX) return false;
    if (!insidePolygon(p, this.input.outline) || !this.clear(p)) return false;
    if (!this.spread.free(p)) return false;
    this.spread.add(p);
    this.trees.push({
      x: p.x,
      z: p.z,
      scale: scale[0] + (scale[1] - scale[0]) * this.random(),
      tint: this.random(),
      row,
    });
    return true;
  }
}

/** The fence: trees 3 to 4 m apart, 1.5 m inside the boundary, with a gap at the gate. */
function fenceLine(pl: Planter, input: TreeInput): void {
  const { outline, gate } = input;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i] as Pt;
    const c = outline[(i + 1) % outline.length] as Pt;
    const length = Math.hypot(c.x - a.x, c.z - a.z);
    if (length < 1) continue;
    const dx = (c.x - a.x) / length;
    const dz = (c.z - a.z) / length;
    for (let t = 1.5; t < length - 1; t += 3 + pl.random()) {
      const on = { x: a.x + dx * t, z: a.z + dz * t };
      if (Math.hypot(on.x - gate.x, on.z - gate.z) < 12) continue;
      // The inward side is the one that is inside the land.
      const left = { x: on.x - dz * FENCE_IN_M, z: on.z + dx * FENCE_IN_M };
      const right = { x: on.x + dz * FENCE_IN_M, z: on.z - dx * FENCE_IN_M };
      const p = insidePolygon(left, outline) ? left : right;
      pl.try(p, "fence", [0.8, 1.3]);
    }
  }
}

/** Both sides of every road, on a lattice of 8 m so two routes sharing a road plant it once. */
function roadLines(pl: Planter, input: TreeInput): void {
  const off = input.roadWidth / 2 + ROAD_SIDE_M;
  for (const line of input.lines)
    for (let k = 1; k < line.length; k++) {
      const a = line[k - 1] as Pt;
      const c = line[k] as Pt;
      const horizontal = Math.abs(c.z - a.z) < Math.abs(c.x - a.x);
      const [from, to] = horizontal
        ? [Math.min(a.x, c.x), Math.max(a.x, c.x)]
        : [Math.min(a.z, c.z), Math.max(a.z, c.z)];
      for (let t = Math.ceil(from / ROAD_PITCH_M) * ROAD_PITCH_M; t <= to; t += ROAD_PITCH_M)
        for (const s of [-1, 1]) {
          const p = horizontal ? { x: t, z: a.z + s * off } : { x: a.x + s * off, z: t };
          pl.try(p, "road", [0.9, 1.2]);
        }
    }
}

interface Grass {
  readonly x0: number;
  readonly z0: number;
  readonly cols: number;
  readonly rows: number;
  readonly free: Uint8Array;
}

/** Cells of grass nobody uses: on the land, 6 m clear of everything, near the developed part. */
function grassOf(input: TreeInput): Grass {
  const area = boundsOf(input.outline);
  const near = inflate(input.cluster, GROVE_REACH_M);
  const x0 = Math.max(area.x0, near.x0);
  const z0 = Math.max(area.z0, near.z0);
  const cols = Math.max(0, Math.ceil((Math.min(area.x1, near.x1) - x0) / GROVE_CELL_M));
  const rows = Math.max(0, Math.ceil((Math.min(area.z1, near.z1) - z0) / GROVE_CELL_M));
  const free = new Uint8Array(cols * rows);
  const keep = new Keep(CLEAR_M + GROVE_CELL_M);
  for (const b of input.keep) keep.add(b);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const c = { x: x0 + (i + 0.5) * GROVE_CELL_M, z: z0 + (j + 0.5) * GROVE_CELL_M };
      if (insidePolygon(c, input.outline) && !keep.near(c, CLEAR_M + GROVE_CELL_M / 2))
        free[j * cols + i] = 1;
    }
  return { x0, z0, cols, rows, free };
}

/** Connected runs of free cells, as lists of cell numbers. */
function patches(g: Grass): number[][] {
  const seen = new Uint8Array(g.free.length);
  const out: number[][] = [];
  for (let s = 0; s < g.free.length; s++) {
    if (!g.free[s] || seen[s]) continue;
    const cells: number[] = [];
    const stack = [s];
    seen[s] = 1;
    while (stack.length > 0) {
      const c = stack.pop() as number;
      cells.push(c);
      const i = c % g.cols;
      const j = Math.floor(c / g.cols);
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= g.cols || nj >= g.rows) continue;
        const n = nj * g.cols + ni;
        if (g.free[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    out.push(cells);
  }
  return out;
}

/** A grove: three to seven trees within 5 m of a centre, each on free grass. */
function grove(pl: Planter, g: Grass, centre: Pt): void {
  const count = 3 + Math.floor(pl.random() * 5);
  let planted = 0;
  for (let attempt = 0; attempt < 24 && planted < count; attempt++) {
    const r = 1.5 + pl.random() * 4;
    const a = pl.random() * Math.PI * 2;
    const p = { x: centre.x + Math.cos(a) * r, z: centre.z + Math.sin(a) * r };
    const i = Math.floor((p.x - g.x0) / GROVE_CELL_M);
    const j = Math.floor((p.z - g.z0) / GROVE_CELL_M);
    if (i < 0 || j < 0 || i >= g.cols || j >= g.rows || !g.free[j * g.cols + i]) continue;
    if (pl.try(p, "grove", [0.7, 1.5])) planted++;
  }
}

/** Small groves on leftover grass of at least 100 m², about one for every 700 m² and at most 12 to a patch. */
function groves(pl: Planter, input: TreeInput): void {
  const g = grassOf(input);
  for (const cells of patches(g)) {
    if (cells.length * GROVE_CELL_M * GROVE_CELL_M < GROVE_MIN_M2) continue;
    const n = Math.min(12, 1 + Math.floor((cells.length * GROVE_CELL_M * GROVE_CELL_M) / 700));
    for (let k = 0; k < n; k++) {
      const c = cells[Math.floor(pl.random() * cells.length)] as number;
      grove(pl, g, {
        x: g.x0 + ((c % g.cols) + 0.5) * GROVE_CELL_M,
        z: g.z0 + (Math.floor(c / g.cols) + 0.5) * GROVE_CELL_M,
      });
    }
  }
}

/** The trees of a campus, in the order fence, roads, groves. */
export function planTrees(input: TreeInput): PlanTree[] {
  const pl = new Planter(input);
  fenceLine(pl, input);
  roadLines(pl, input);
  groves(pl, input);
  return pl.trees;
}
