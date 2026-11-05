/**
 * Where people can walk in a room (REQ-074, ADR-0078): the aisle centre lines between the rows of
 * racks, a grid that says which spots are taken by a rack, a machine or a wall, and the shortest way
 * between two spots that does not cross any of them. Plain numbers; the walkers themselves are in `crew.ts`.
 */
import { type Bounds, boundsOfBox, type Pt } from "./plan";
import { insideScene, type RoomScene } from "./room";

export interface Aisle {
  readonly a: Pt;
  readonly b: Pt;
}

/** A way as points, with the distance walked at each and in all. */
export interface Poly {
  readonly pts: readonly Pt[];
  readonly cum: readonly number[];
  readonly length: number;
}

/** Metres a walker keeps from a rack or a machine. */
const PAD_M = 0.25;
const CELL_M = 0.3;
const SAMPLE_M = 0.3;
/** Metres between a row's face and the line walked along it. */
const FACE_M = 0.9;
/** An aisle narrower than this has no one walking in it. */
const MIN_GAP_M = 0.9;
/** The most aisles patrolled in one room. */
const MAX_AISLES = 8;
const MIN_AISLE_M = 2;

export const polyOf = (pts: readonly Pt[]): Poly => {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Pt;
    const b = pts[i] as Pt;
    cum.push((cum[i - 1] as number) + Math.hypot(b.x - a.x, b.z - a.z));
  }
  return { pts, cum, length: cum[cum.length - 1] as number };
};

/** The point `s` metres along a way, and the way it is heading there (radians, 0 faces +z). */
export function along(poly: Poly, s: number): Pt & { readonly rot: number } {
  const at = Math.min(poly.length, Math.max(0, s));
  let i = 1;
  while (i < poly.pts.length - 1 && (poly.cum[i] as number) < at) i++;
  const p0 = poly.pts[i - 1] as Pt;
  const p1 = poly.pts[i] as Pt;
  const seg = (poly.cum[i] as number) - (poly.cum[i - 1] as number);
  const k = seg > 0 ? (at - (poly.cum[i - 1] as number)) / seg : 0;
  return {
    x: p0.x + (p1.x - p0.x) * k,
    z: p0.z + (p1.z - p0.z) * k,
    rot: Math.atan2(p1.x - p0.x, p1.z - p0.z),
  };
}

/** The footprints of the racks in a room. */
export function rackBlocks(scene: RoomScene): Bounds[] {
  const out: Bounds[] = [];
  for (const set of scene.sets)
    for (let i = 0; i < set.ids.length; i++) {
      const turn = Math.abs(Math.sin(set.at[i * 4 + 3] as number)) > 0.7;
      const w = turn ? set.kind.d : set.kind.w;
      const d = turn ? set.kind.w : set.kind.d;
      const x = set.at[i * 4] as number;
      const z = set.at[i * 4 + 2] as number;
      out.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2 });
    }
  return out;
}

/** The closed-in aisles (containments): a person in one is hidden by its roof and glass, so they are not walked. */
export const podBlocks = (scene: RoomScene): Bounds[] => scene.pods.map((p) => p.enclosure);

/** The footprints of the machines that stand on the floor (an overhead busway does not). */
export const equipBlocks = (scene: RoomScene): Bounds[] =>
  scene.equipment.filter((e) => e.style !== "busway").map(boundsOfBox);

/** The cells at `ring` steps from a cell (the square's edge). */
function* ringOf(ci: number, cj: number, ring: number): Generator<readonly [number, number]> {
  for (let j = cj - ring; j <= cj + ring; j++)
    for (let i = ci - ring; i <= ci + ring; i++)
      if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) === ring) yield [i, j];
}

/** Which spots of the floor are free to stand on. */
export class Grid {
  private readonly data: Uint8Array;
  private readonly x0: number;
  private readonly z0: number;
  private readonly nx: number;
  private readonly nz: number;

  constructor(scene: RoomScene, blocks: readonly Bounds[]) {
    const b = scene.bounds ?? { x0: 0, z0: 0, x1: scene.w, z1: scene.d };
    this.x0 = b.x0;
    this.z0 = b.z0;
    this.nx = Math.max(1, Math.ceil((b.x1 - b.x0) / CELL_M));
    this.nz = Math.max(1, Math.ceil((b.z1 - b.z0) / CELL_M));
    this.data = new Uint8Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j++)
      for (let i = 0; i < this.nx; i++)
        if (!insideScene(scene, this.x0 + (i + 0.5) * CELL_M, this.z0 + (j + 0.5) * CELL_M))
          this.data[j * this.nx + i] = 1;
    for (const r of blocks) this.mark(r);
  }

  private mark(r: Bounds): void {
    const i0 = Math.max(0, Math.floor((r.x0 - PAD_M - this.x0) / CELL_M));
    const i1 = Math.min(this.nx - 1, Math.floor((r.x1 + PAD_M - this.x0) / CELL_M));
    const j0 = Math.max(0, Math.floor((r.z0 - PAD_M - this.z0) / CELL_M));
    const j1 = Math.min(this.nz - 1, Math.floor((r.z1 + PAD_M - this.z0) / CELL_M));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.data[j * this.nx + i] = 1;
  }

  /** Add something that stands in the way after the grid was made (a desk). */
  block(r: Bounds): void {
    this.mark(r);
  }

  free(x: number, z: number): boolean {
    const i = Math.floor((x - this.x0) / CELL_M);
    const j = Math.floor((z - this.z0) / CELL_M);
    return i >= 0 && j >= 0 && i < this.nx && j < this.nz && this.data[j * this.nx + i] === 0;
  }

  /** The free spot nearest to a point, looking outward ring by ring up to `reach` metres; undefined if none. */
  nearestFree(p: Pt, reach = 10): Pt | undefined {
    let best: Pt | undefined;
    let bestD = Number.POSITIVE_INFINITY;
    const ci = Math.floor((p.x - this.x0) / CELL_M);
    const cj = Math.floor((p.z - this.z0) / CELL_M);
    for (let ring = 0; ring <= Math.ceil(reach / CELL_M) && ring * CELL_M <= bestD; ring++)
      for (const [i, j] of ringOf(ci, cj, ring)) {
        if (!this.openCell(i, j)) continue;
        const at = { x: this.x0 + (i + 0.5) * CELL_M, z: this.z0 + (j + 0.5) * CELL_M };
        const d = Math.hypot(at.x - p.x, at.z - p.z);
        if (d < bestD) {
          bestD = d;
          best = at;
        }
      }
    return best;
  }

  private openCell(i: number, j: number): boolean {
    return i >= 0 && j >= 0 && i < this.nx && j < this.nz && this.data[j * this.nx + i] === 0;
  }

  /** Whether the straight way between two spots is free all along. */
  clear(a: Pt, b: Pt): boolean {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / SAMPLE_M));
    for (let s = 0; s <= steps; s++) {
      const k = s / steps;
      if (!this.free(a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k)) return false;
    }
    return true;
  }
}

interface Row {
  readonly z: number;
  readonly half: number;
  readonly x0: number;
  readonly x1: number;
}

/** Racks in a line share a z; a row is that line with its depth and reach. */
function rowsOf(blocks: readonly Bounds[]): Row[] {
  const lines = new Map<number, { z0: number; z1: number; x0: number; x1: number }>();
  for (const r of blocks) {
    const key = Math.round((r.z0 + r.z1) / 2 / 0.4);
    const line = lines.get(key);
    if (line) {
      line.z0 = Math.min(line.z0, r.z0);
      line.z1 = Math.max(line.z1, r.z1);
      line.x0 = Math.min(line.x0, r.x0);
      line.x1 = Math.max(line.x1, r.x1);
    } else lines.set(key, { ...r });
  }
  return [...lines.values()]
    .filter((l) => l.x1 - l.x0 >= 1.2)
    .map((l) => ({ z: (l.z0 + l.z1) / 2, half: (l.z1 - l.z0) / 2, x0: l.x0, x1: l.x1 }))
    .sort((p, q) => p.z - q.z);
}

const lineAt = (z: number, x0: number, x1: number): Aisle => ({
  a: { x: x0, z },
  b: { x: x1, z },
});

/** The centre lines of the aisles between rows and in front of the first and behind the last, longest first. */
export function aislesOf(scene: RoomScene, grid: Grid, racks: readonly Bounds[]): Aisle[] {
  const rows = rowsOf(racks);
  const out: Aisle[] = [];
  const keep = (z: number, x0: number, x1: number) => {
    if (x1 - x0 - 1 < MIN_AISLE_M) return;
    // Past the ends of the rows too, as far as the floor is free.
    for (const reach of [3, 2, 1, -0.5]) {
      const a = lineAt(z, x0 - reach, x1 + reach);
      if (grid.clear(a.a, a.b)) {
        out.push(a);
        return;
      }
    }
  };
  rows.forEach((r, i) => {
    const next = rows[i + 1];
    if (next) {
      const gap = next.z - next.half - (r.z + r.half);
      const x0 = Math.max(r.x0, next.x0);
      const x1 = Math.min(r.x1, next.x1);
      if (gap >= MIN_GAP_M) keep((r.z + r.half + next.z - next.half) / 2, x0, x1);
    }
    if (i === 0) keep(r.z - r.half - FACE_M, r.x0, r.x1);
    if (i === rows.length - 1) keep(r.z + r.half + FACE_M, r.x0, r.x1);
  });
  const length = (a: Aisle) => Math.abs(a.b.x - a.a.x);
  const sorted = out.sort((p, q) => length(q) - length(p)).slice(0, MAX_AISLES);
  const fallback = sorted.length > 0 ? undefined : hallLine(scene, grid);
  return fallback ? [fallback] : sorted;
}

/** A room without rows (a control room, a plant room): the first free line across its widest piece. */
function hallLine(scene: RoomScene, grid: Grid): Aisle | undefined {
  const rects = [...(scene.rects ?? [{ x0: 0, z0: 0, x1: scene.w, z1: scene.d }])];
  rects.sort((p, q) => q.x1 - q.x0 - (p.x1 - p.x0));
  const r = rects[0] as Bounds;
  const mid = (r.z0 + r.z1) / 2;
  for (let off = 0; off <= (r.z1 - r.z0) / 2 - 0.8; off += 0.6)
    for (const z of off === 0 ? [mid] : [mid + off, mid - off]) {
      const a = lineAt(z, r.x0 + 0.9, r.x1 - 0.9);
      if (a.b.x - a.a.x >= 1.5 && grid.clear(a.a, a.b)) return a;
    }
  return undefined;
}

/** The nearest point on an aisle to a spot. */
export function onAisle(aisle: Aisle, p: Pt): Pt {
  const dx = aisle.b.x - aisle.a.x;
  const dz = aisle.b.z - aisle.a.z;
  const len2 = dx * dx + dz * dz || 1;
  const k = Math.min(1, Math.max(0, ((p.x - aisle.a.x) * dx + (p.z - aisle.a.z) * dz) / len2));
  return { x: aisle.a.x + dx * k, z: aisle.a.z + dz * k };
}

/** Corners of the floor pulled in a little: places to turn when the aisles do not meet. */
function cornersOf(scene: RoomScene, grid: Grid): Pt[] {
  const out: Pt[] = [];
  for (const r of scene.rects ?? [{ x0: 0, z0: 0, x1: scene.w, z1: scene.d }])
    for (const x of [r.x0 + 0.7, r.x1 - 0.7])
      for (const z of [r.z0 + 0.7, r.z1 - 0.7]) if (grid.free(x, z)) out.push({ x, z });
  return out;
}

/** The node not yet settled that is nearest to the start, or -1. */
function nearestOpen(dist: readonly number[], done: readonly boolean[]): number {
  let u = -1;
  for (let i = 0; i < dist.length; i++)
    if (!done[i] && (u < 0 || (dist[i] as number) < (dist[u] as number))) u = i;
  return u;
}

/** The shortest way through a set of spots (the first the start, the second the end) over the straight ways that are free; undefined if they do not meet. */
function shortest(nodes: readonly Pt[], grid: Grid): Pt[] | undefined {
  const dist = nodes.map(() => Number.POSITIVE_INFINITY);
  const prev = nodes.map(() => -1);
  const done = nodes.map(() => false);
  dist[0] = 0;
  for (let step = 0; step < nodes.length; step++) {
    const u = nearestOpen(dist, done);
    if (u < 0 || dist[u] === Number.POSITIVE_INFINITY || u === 1) break;
    done[u] = true;
    const p = nodes[u] as Pt;
    nodes.forEach((q, v) => {
      const d = (dist[u] as number) + Math.hypot(q.x - p.x, q.z - p.z);
      if (done[v] || d >= (dist[v] as number) || !grid.clear(p, q)) return;
      dist[v] = d;
      prev[v] = u;
    });
  }
  if (prev[1] === -1) return undefined;
  const way: Pt[] = [];
  for (let n = 1; n !== -1; n = prev[n] as number) way.push(nodes[n] as Pt);
  return way.reverse();
}

/** The shortest free way from one spot to another, through aisle ends and corners; the straight line if none is free. */
export function routeOf(
  scene: RoomScene,
  grid: Grid,
  aisles: readonly Aisle[],
  from: Pt,
  to: Pt,
): Poly {
  if (grid.clear(from, to)) return polyOf([from, to]);
  const nodes: Pt[] = [from, to, ...cornersOf(scene, grid)];
  for (const a of aisles) nodes.push(a.a, a.b, onAisle(a, from), onAisle(a, to));
  return polyOf(shortest(nodes, grid) ?? [from, to]);
}
