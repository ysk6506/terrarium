/** Plain geometry in metres. x grows to the right, y grows away from the viewer, z is height. */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly d: number;
}

/** Rotation of a footprint in degrees; racks face +y at 0 and -y at 180. */
export type Rotation = 0 | 90 | 180 | 270;

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function center(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.d / 2 };
}

/** Footprint after rotation (90/270 swap width and depth). */
export function rotated(w: number, d: number, rotation: Rotation): { w: number; d: number } {
  return rotation === 90 || rotation === 270 ? { w: d, d: w } : { w, d };
}

/** True when the rectangles share interior area (touching edges do not overlap). */
export function overlaps(a: Rect, b: Rect, epsilon = 1e-9): boolean {
  return (
    a.x < b.x + b.w - epsilon &&
    b.x < a.x + a.w - epsilon &&
    a.y < b.y + b.d - epsilon &&
    b.y < a.y + a.d - epsilon
  );
}

/** True when `inner` lies completely inside `outer`. */
export function contains(outer: Rect, inner: Rect, epsilon = 1e-9): boolean {
  return (
    inner.x >= outer.x - epsilon &&
    inner.y >= outer.y - epsilon &&
    inner.x + inner.w <= outer.x + outer.w + epsilon &&
    inner.y + inner.d <= outer.y + outer.d + epsilon
  );
}

/** Snap a value to the nearest multiple of `step`. */
export function snap(value: number, step: number): number {
  return step > 0 ? Math.round(value / step) * step : value;
}

export function bounds(rects: readonly Rect[]): Rect | undefined {
  if (rects.length === 0) return undefined;
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.d));
  return { x: minX, y: minY, w: maxX - minX, d: maxY - minY };
}

/** Manhattan length of a cable routed along the floor between two points, plus vertical drops. */
export function cableLength(a: Point, b: Point, drop = 2.0): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + drop;
}

/** `"3F"` -> 3, `"B1F"` -> -1, unknown -> 0. */
export function floorLevel(floor: string | undefined): number {
  const digits = floor?.replace(/\D/g, "") ?? "";
  if (!digits) return 0;
  return floor?.toUpperCase().startsWith("B") ? -Number(digits) : Number(digits);
}
