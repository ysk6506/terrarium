/**
 * A room is one or more rectangles joined edge to edge (REQ-075, ADR-0080): the body that every placement
 * has, plus the `pieces` a person attached. This module is the one place that knows what that shape is:
 * its rectangles, its outline, whether a point or a rectangle is inside it, and what is wrong with it.
 * Everything is in the room's parent frame (the floor's), exactly like `x, y, w, d`. A room with no
 * pieces is a plain rectangle and every function here gives the answer a rectangle would.
 */
import type { Point, Rect } from "@terrarium/core/spatial";
import type { Entity } from "./blueprint";

const EPS = 1e-6;

/** The body of an area placement as a rectangle. */
function bodyOf(entity: Pick<Entity, "placement">): Rect | undefined {
  const p = entity.placement;
  return p?.type === "area" ? { x: p.x, y: p.y, w: p.w, d: p.d } : undefined;
}

/** Body first, then the pieces, in the parent's frame. Empty for something that has no area. */
export function roomRects(entity: Pick<Entity, "placement">): Rect[] {
  const body = bodyOf(entity);
  if (!body) return [];
  const p = entity.placement;
  const pieces = p?.type === "area" ? (p.pieces ?? []) : [];
  return [body, ...pieces.map((r) => ({ x: r.x, y: r.y, w: r.w, d: r.d }))];
}

/** The rectangles in the room's own frame, whose corner (0, 0) is the body's corner (where racks are placed). */
export function roomLocalRects(entity: Pick<Entity, "placement">): Rect[] {
  const body = bodyOf(entity);
  return roomRects(entity).map((r) => ({
    x: r.x - (body?.x ?? 0),
    y: r.y - (body?.y ?? 0),
    w: r.w,
    d: r.d,
  }));
}

/** Floor area of the whole shape, m². Pieces never overlap, so it is a plain sum. */
export function roomArea(entity: Pick<Entity, "placement">): number {
  return roomRects(entity).reduce((sum, r) => sum + r.w * r.d, 0);
}

/** The smallest rectangle around the shape. */
export function roomBounds(rects: readonly Rect[]): Rect | undefined {
  if (rects.length === 0) return undefined;
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.d));
  return { x: x0, y: y0, w: x1 - x0, d: y1 - y0 };
}

const sortedUnique = (values: number[]): number[] => {
  const out: number[] = [];
  for (const v of [...values].sort((a, b) => a - b))
    if (out.length === 0 || v - (out.at(-1) as number) > EPS) out.push(v);
  return out;
};

const covers = (r: Rect, x: number, y: number): boolean =>
  x > r.x - EPS && x < r.x + r.w + EPS && y > r.y - EPS && y < r.y + r.d + EPS;

/** Whether the point lies inside the shape (its edge counts as inside). */
export function insideRoom(entity: Pick<Entity, "placement">, pt: Point): boolean {
  return roomRects(entity).some((r) => covers(r, pt.x, pt.y));
}

/** Whether `inner` is covered completely by the union of `rects` (no gap, even across a seam between two). */
export function coveredBy(rects: readonly Rect[], inner: Rect): boolean {
  if (rects.some((r) => containsRect(r, inner))) return true;
  const xs = sortedUnique([inner.x, inner.x + inner.w, ...rects.flatMap((r) => [r.x, r.x + r.w])]);
  const ys = sortedUnique([inner.y, inner.y + inner.d, ...rects.flatMap((r) => [r.y, r.y + r.d])]);
  for (let i = 0; i + 1 < xs.length; i++)
    for (let j = 0; j + 1 < ys.length; j++) {
      const cx = ((xs[i] as number) + (xs[i + 1] as number)) / 2;
      const cy = ((ys[j] as number) + (ys[j + 1] as number)) / 2;
      if (!covers(inner, cx, cy)) continue;
      if (!rects.some((r) => covers(r, cx, cy))) return false;
    }
  return true;
}

const containsRect = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x - EPS &&
  inner.y >= outer.y - EPS &&
  inner.x + inner.w <= outer.x + outer.w + EPS &&
  inner.y + inner.d <= outer.y + outer.d + EPS;

/** Whether a rectangle in the room's own frame lies inside the room's shape. */
export function insideRoomLocal(entity: Pick<Entity, "placement">, inner: Rect): boolean {
  return coveredBy(roomLocalRects(entity), inner);
}

/** The length two rectangles share along an edge they touch with, or 0 when they overlap or only meet at a corner. */
export function sharedEdge(a: Rect, b: Rect): number {
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y);
  const touchX = Math.abs(a.x + a.w - b.x) < EPS || Math.abs(b.x + b.w - a.x) < EPS;
  const touchY = Math.abs(a.y + a.d - b.y) < EPS || Math.abs(b.y + b.d - a.y) < EPS;
  if (touchX && overlapY > EPS) return overlapY;
  if (touchY && overlapX > EPS) return overlapX;
  return 0;
}

const interiorOverlap = (a: Rect, b: Rect): boolean =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > EPS &&
  Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y) > EPS;

/** Whether two shapes (lists of rectangles) share any floor. */
export function shapesOverlap(a: readonly Rect[], b: readonly Rect[]): boolean {
  return a.some((p) => b.some((q) => interiorOverlap(p, q)));
}

export type ShapeProblem =
  | { readonly kind: "empty"; readonly index: number }
  | { readonly kind: "overlap"; readonly index: number }
  | { readonly kind: "detached"; readonly index: number }
  | { readonly kind: "hole" };

/**
 * What is wrong with a shape given as body + pieces: a piece with no size, one that overlaps another, one that
 * does not share an edge with the rest (only meeting at a corner counts as detached), or pieces that close
 * round a gap. `index` counts the body as 0.
 */
export function shapeProblem(rects: readonly Rect[]): ShapeProblem | undefined {
  const empty = rects.findIndex((r) => !(r.w > EPS && r.d > EPS));
  if (empty >= 0) return { kind: "empty", index: empty };
  const overlap = firstOverlap(rects);
  if (overlap > 0) return { kind: "overlap", index: overlap };
  const detached = firstDetached(rects);
  if (detached > 0) return { kind: "detached", index: detached };
  return outlineLoops(rects).length > 1 ? { kind: "hole" } : undefined;
}

/** The first rectangle (after the body) that overlaps an earlier one, or -1. */
function firstOverlap(rects: readonly Rect[]): number {
  for (let i = 1; i < rects.length; i++)
    for (let j = 0; j < i; j++) if (interiorOverlap(rects[i] as Rect, rects[j] as Rect)) return i;
  return -1;
}

/** The first rectangle that cannot be reached from the body over shared edges, or -1. */
function firstDetached(rects: readonly Rect[]): number {
  const seen = new Set<number>([0]);
  const queue = [0];
  while (queue.length > 0) {
    const at = queue.pop() as number;
    for (let j = 0; j < rects.length; j++)
      if (!seen.has(j) && sharedEdge(rects[at] as Rect, rects[j] as Rect) > EPS) {
        seen.add(j);
        queue.push(j);
      }
  }
  return rects.findIndex((_, i) => !seen.has(i));
}

/** The boundary edges of the union, directed with the room on their left, keyed by where they start. */
function boundaryEdges(rects: readonly Rect[]): Map<string, Point[]> {
  const xs = sortedUnique(rects.flatMap((r) => [r.x, r.x + r.w]));
  const ys = sortedUnique(rects.flatMap((r) => [r.y, r.y + r.d]));
  const filled = (i: number, j: number): boolean => {
    if (i < 0 || j < 0 || i + 1 >= xs.length || j + 1 >= ys.length) return false;
    const cx = ((xs[i] as number) + (xs[i + 1] as number)) / 2;
    const cy = ((ys[j] as number) + (ys[j + 1] as number)) / 2;
    return rects.some((r) => covers(r, cx, cy));
  };
  const next = new Map<string, Point[]>();
  const edge = (a: Point, b: Point) =>
    next.set(pointKey(a), [...(next.get(pointKey(a)) ?? []), a, b]);
  for (let i = 0; i + 1 < xs.length; i++)
    for (let j = 0; j + 1 < ys.length; j++) {
      if (!filled(i, j)) continue;
      const [x0, x1, y0, y1] = [xs[i], xs[i + 1], ys[j], ys[j + 1]] as [
        number,
        number,
        number,
        number,
      ];
      if (!filled(i, j - 1)) edge({ x: x0, y: y0 }, { x: x1, y: y0 });
      if (!filled(i + 1, j)) edge({ x: x1, y: y0 }, { x: x1, y: y1 });
      if (!filled(i, j + 1)) edge({ x: x1, y: y1 }, { x: x0, y: y1 });
      if (!filled(i - 1, j)) edge({ x: x0, y: y1 }, { x: x0, y: y0 });
    }
  return next;
}

const pointKey = (p: Point) => `${p.x}|${p.y}`;

/** Every closed boundary of the union, each counter-clockwise (positive area with y up); the outer one first. */
function outlineLoops(rects: readonly Rect[]): Point[][] {
  const next = boundaryEdges(rects);
  const loops: Point[][] = [];
  const used = new Set<string>();
  for (const list of next.values())
    for (let k = 0; k < list.length; k += 2) {
      const first = list[k] as Point;
      if (used.has(`${pointKey(first)}>${pointKey(list[k + 1] as Point)}`)) continue;
      loops.push(simplify(walk(next, used, first, list[k + 1] as Point)));
    }
  return loops.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
}

/** Follow the boundary from one edge until it closes, marking edges used. */
function walk(next: Map<string, Point[]>, used: Set<string>, first: Point, second: Point): Point[] {
  const loop: Point[] = [];
  let at = first;
  let to = second;
  for (let guard = 0; guard < 100_000; guard++) {
    used.add(`${pointKey(at)}>${pointKey(to)}`);
    loop.push(at);
    const options = next.get(pointKey(to)) ?? [];
    let found: Point | undefined;
    for (let m = 0; m < options.length; m += 2)
      if (!used.has(`${pointKey(to)}>${pointKey(options[m + 1] as Point)}`))
        found = options[m + 1] as Point;
    at = to;
    if (!found) break;
    to = found;
  }
  return loop;
}

const signedArea = (poly: readonly Point[]): number => {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Point;
    const b = poly[(i + 1) % poly.length] as Point;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
};

/** Drop the points that lie on a straight run. */
function simplify(poly: readonly Point[]): Point[] {
  return poly.filter((p, i) => {
    const a = poly[(i + poly.length - 1) % poly.length] as Point;
    const b = poly[(i + 1) % poly.length] as Point;
    return Math.abs((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x)) > EPS;
  });
}

/** The outline of a set of rectangles joined edge to edge: one counter-clockwise polygon (y up), corners only. */
export function outlineOf(rects: readonly Rect[]): Point[] {
  return outlineLoops(rects)[0] ?? [];
}

/**
 * The room's outline in its parent's frame: a counter-clockwise rectilinear polygon (positive area with y up,
 * which on the plan, where y grows toward the viewer, runs clockwise on the screen). A rectangle gives its four corners.
 */
export function roomOutline(entity: Pick<Entity, "placement">): Point[] {
  return outlineOf(roomRects(entity));
}
