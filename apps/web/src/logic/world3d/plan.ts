/**
 * Plan geometry for the 3D view (REQ-006, REQ-036), as plain numbers. The plan frame is the blueprint's
 * own: x to the right, z = the blueprint's y (toward the viewer). Heights are a separate axis.
 */
import type { Catalog } from "@terrarium/core/catalog";
import { type Entity, type EntityKind, footprint } from "@terrarium/core/world";

export interface Pt {
  readonly x: number;
  readonly z: number;
}

export interface Bounds {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
}

/** A thing standing on a plan: its centre, its own width and depth, and how it is turned. */
export interface Box {
  readonly id: string;
  readonly kind: EntityKind;
  readonly name: string;
  readonly x: number;
  readonly z: number;
  /** The thing's own width (along its x) and depth (along its z), before turning. */
  readonly w: number;
  readonly d: number;
  /** Turn about the vertical axis, radians; 0 faces +z (the viewer). */
  readonly rot: number;
}

/** "x,y;x,y;…" (a site's land outline) as points; undefined unless it has at least three. */
export function parseOutline(text: unknown): Pt[] | undefined {
  if (typeof text !== "string") return undefined;
  const points: Pt[] = [];
  for (const pair of text.split(";")) {
    const [a, b] = pair.split(",").map(Number);
    if (a !== undefined && b !== undefined && Number.isFinite(a) && Number.isFinite(b))
      points.push({ x: a, z: b });
  }
  return points.length >= 3 ? points : undefined;
}

export function boundsOf(points: readonly Pt[]): Bounds {
  let x0 = Number.POSITIVE_INFINITY;
  let z0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let z1 = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    z0 = Math.min(z0, p.z);
    x1 = Math.max(x1, p.x);
    z1 = Math.max(z1, p.z);
  }
  return { x0, z0, x1, z1 };
}

export function unionOf(list: readonly Bounds[]): Bounds | undefined {
  const first = list[0];
  if (!first) return undefined;
  return list.reduce(
    (a, b) => ({
      x0: Math.min(a.x0, b.x0),
      z0: Math.min(a.z0, b.z0),
      x1: Math.max(a.x1, b.x1),
      z1: Math.max(a.z1, b.z1),
    }),
    first,
  );
}

export const inflate = (b: Bounds, m: number): Bounds => ({
  x0: b.x0 - m,
  z0: b.z0 - m,
  x1: b.x1 + m,
  z1: b.z1 + m,
});

export const widthOf = (b: Bounds): number => b.x1 - b.x0;
export const depthOf = (b: Bounds): number => b.z1 - b.z0;
export const centreOf = (b: Bounds): Pt => ({ x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 });

export function overlapBounds(a: Bounds, b: Bounds): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
}

/** The smallest axis-aligned box around a turned box. */
export function boundsOfBox(box: Box): Bounds {
  const c = Math.abs(Math.cos(box.rot));
  const s = Math.abs(Math.sin(box.rot));
  const hw = (box.w * c + box.d * s) / 2;
  const hd = (box.w * s + box.d * c) / 2;
  return { x0: box.x - hw, z0: box.z - hd, x1: box.x + hw, z1: box.z + hd };
}

/** Even-odd test: is the point inside the polygon. */
export function insidePolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Pt;
    const b = poly[j] as Pt;
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x)
      inside = !inside;
  }
  return inside;
}

/** Signed area of a polygon, m² (positive when its points run clockwise on the plan). */
export function polygonArea(poly: readonly Pt[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Pt;
    const b = poly[(i + 1) % poly.length] as Pt;
    sum += a.x * b.z - b.x * a.z;
  }
  return sum / 2;
}

/** The turn (radians about the vertical axis) of a blueprint rotation given in degrees. */
export const turnOf = (degrees: number): number => (-degrees * Math.PI) / 180;

/**
 * A spot- or area-placed entity as a box, in its parent's frame shifted by (ox, oz). Equipment keeps
 * its model's own width and depth and carries the turn separately, so the view can draw the model
 * unturned and rotate it.
 */
export function boxOf(entity: Entity, catalog: Catalog, ox = 0, oz = 0): Box | undefined {
  const rect = footprint(entity, catalog);
  if (!rect) return undefined;
  const p = entity.placement;
  const degrees = p?.type === "spot" ? p.rotation : 0;
  const swapped = degrees === 90 || degrees === 270;
  return {
    id: entity.id,
    kind: entity.kind,
    name: entity.name,
    x: ox + rect.x + rect.w / 2,
    z: oz + rect.y + rect.d / 2,
    w: swapped ? rect.d : rect.w,
    d: swapped ? rect.w : rect.d,
    rot: turnOf(degrees),
  };
}

/** Deterministic hash of two numbers to [0, 1): jitter that does not need a generator. */
export function unit(a: number, b: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
