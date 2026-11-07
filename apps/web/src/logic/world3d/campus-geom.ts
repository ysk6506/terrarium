/** Small tools of the campus layout plan: a seeded generator, a rectangle index and a point index. */
import type { Bounds, Pt } from "./plan";

/** A small deterministic generator (mulberry32): the same seed gives the same run of numbers. */
export function rng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cellKey = (i: number, j: number): number => (i + 20000) * 40009 + (j + 20000);

/** Rectangles found by the bucket a point is in: "is this point within `margin` of any of them" without scanning all. */
export class Keep {
  private readonly buckets = new Map<number, Bounds[]>();
  readonly all: Bounds[] = [];

  constructor(
    private readonly pad: number,
    private readonly size = 32,
  ) {}

  add(b: Bounds): void {
    this.all.push(b);
    const size = this.size;
    const pad = this.pad;
    for (let j = Math.floor((b.z0 - pad) / size); j <= Math.floor((b.z1 + pad) / size); j++)
      for (let i = Math.floor((b.x0 - pad) / size); i <= Math.floor((b.x1 + pad) / size); i++) {
        const k = cellKey(i, j);
        const list = this.buckets.get(k);
        if (list) list.push(b);
        else this.buckets.set(k, [b]);
      }
  }

  /** Whether the point is inside a rectangle grown by `margin` (at most the pad). */
  near(p: Pt, margin: number): boolean {
    const list = this.buckets.get(
      cellKey(Math.floor(p.x / this.size), Math.floor(p.z / this.size)),
    );
    return (
      list?.some(
        (b) =>
          p.x > b.x0 - margin && p.x < b.x1 + margin && p.z > b.z0 - margin && p.z < b.z1 + margin,
      ) ?? false
    );
  }
}

/** Points with a smallest distance between any two. */
export class Spread {
  private readonly cells = new Map<number, Pt[]>();

  constructor(private readonly gap: number) {}

  /** Whether the point is at least `gap` from every point added. */
  free(p: Pt): boolean {
    const ci = Math.floor(p.x / this.gap);
    const cj = Math.floor(p.z / this.gap);
    for (let j = cj - 1; j <= cj + 1; j++)
      for (let i = ci - 1; i <= ci + 1; i++)
        for (const q of this.cells.get(cellKey(i, j)) ?? [])
          if (Math.hypot(q.x - p.x, q.z - p.z) < this.gap) return false;
    return true;
  }

  add(p: Pt): void {
    const k = cellKey(Math.floor(p.x / this.gap), Math.floor(p.z / this.gap));
    const list = this.cells.get(k);
    if (list) list.push(p);
    else this.cells.set(k, [p]);
  }
}

export const touchesAny = (b: Bounds, list: readonly Bounds[]): boolean =>
  list.some((o) => b.x0 < o.x1 && o.x0 < b.x1 && b.z0 < o.z1 && o.z0 < b.z1);
