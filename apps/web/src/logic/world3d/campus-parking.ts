/**
 * Car parks of the campus plan (REQ-105): one lot for each building, flush against a road near its
 * entrance, sized by the servers inside (a bay for every 40 servers, 6 to 60), bays 2.5 by 5 m in two
 * rows with a 6 m lane between. Cars stand only in bays, 40 to 70 % of them.
 */
import { rng, touchesAny } from "./campus-geom";
import type { Bay, Entrance, ParkedCar, Parking, PlanBuilding } from "./campus-plan-types";
import { type Bounds, inflate, insidePolygon, type Pt } from "./plan";

export const BAY_W_M = 2.5;
export const BAY_D_M = 5;
export const AISLE_M = 6;
export const BAYS_MIN = 6;
export const BAYS_MAX = 60;
export const SERVERS_PER_BAY = 40;
const LOT_D_M = BAY_D_M * 2 + AISLE_M;
const STEP_M = 4;
const REACH_M = 80;
const PAINTS = 6;

/** Bays a building's servers ask for. */
export const baysFor = (servers: number): number =>
  Math.min(BAYS_MAX, Math.max(BAYS_MIN, Math.ceil(servers / SERVERS_PER_BAY)));

interface Shape {
  readonly w: number;
  readonly d: number;
  readonly bays: readonly Bay[];
  readonly aisle: Bounds;
}

/** A lot of `n` bays laid out from its corner (0, 0): two rows along x, the lane between them. */
function shapeOf(n: number, along: "x" | "z"): Shape {
  const perRow = Math.ceil(n / 2);
  const long = perRow * BAY_W_M;
  const bays: Bay[] = [];
  for (let i = 0; i < n; i++) {
    const row = i < perRow ? 0 : 1;
    const k = row === 0 ? i : i - perRow;
    const across = row === 0 ? BAY_D_M / 2 : LOT_D_M - BAY_D_M / 2;
    const at = (k + 0.5) * BAY_W_M;
    bays.push(
      along === "x"
        ? { x: at, z: across, w: BAY_W_M, d: BAY_D_M }
        : { x: across, z: at, w: BAY_D_M, d: BAY_W_M },
    );
  }
  const aisle: Bounds =
    along === "x"
      ? { x0: 0, z0: BAY_D_M, x1: long, z1: BAY_D_M + AISLE_M }
      : { x0: BAY_D_M, z0: 0, x1: BAY_D_M + AISLE_M, z1: long };
  return along === "x"
    ? { w: long, d: LOT_D_M, bays, aisle }
    : { w: LOT_D_M, d: long, bays, aisle };
}

export interface ParkingContext {
  readonly outline: readonly Pt[];
  /** Road surface and entrance paths: a lot may touch them, never cover them. */
  readonly roads: readonly Bounds[];
  /** Ground a lot keeps off, already grown by the clearance it needs. */
  readonly taken: Bounds[];
}

function insideLand(r: Bounds, outline: readonly Pt[]): boolean {
  const g = inflate(r, 3);
  const mx = (g.x0 + g.x1) / 2;
  const mz = (g.z0 + g.z1) / 2;
  return [g.x0, mx, g.x1].every((x) =>
    [g.z0, mz, g.z1].every((z) => insidePolygon({ x, z }, outline)),
  );
}

const distTo = (r: Bounds, p: Pt): number =>
  Math.hypot(Math.max(r.x0 - p.x, 0, p.x - r.x1), Math.max(r.z0 - p.z, 0, p.z - r.z1));

/** Positions of a w by d lot flush against each side of a road rectangle, stepped along it. */
function* flush(road: Bounds, w: number, d: number): Generator<Bounds> {
  for (let t = road.x0 - w + STEP_M; t <= road.x1 - STEP_M; t += STEP_M) {
    yield { x0: t, z0: road.z0 - d, x1: t + w, z1: road.z0 };
    yield { x0: t, z0: road.z1, x1: t + w, z1: road.z1 + d };
  }
  for (let t = road.z0 - d + STEP_M; t <= road.z1 - STEP_M; t += STEP_M) {
    yield { x0: road.x0 - w, z0: t, x1: road.x0, z1: t + d };
    yield { x0: road.x1, z0: t, x1: road.x1 + w, z1: t + d };
  }
}

const centreDist = (r: Bounds, p: Pt): number =>
  Math.hypot((r.x0 + r.x1) / 2 - p.x, (r.z0 + r.z1) / 2 - p.z);

/** The free place for a lot of this shape nearest the entrance, flush against a road. */
function findSpot(ctx: ParkingContext, shape: Shape, near: Pt): Bounds | undefined {
  let best: Bounds | undefined;
  let bestD = Number.POSITIVE_INFINITY;
  for (const road of ctx.roads) {
    if (distTo(road, near) > REACH_M) continue;
    for (const lot of flush(road, shape.w, shape.d)) {
      const d = centreDist(lot, near);
      if (d >= bestD) continue;
      if (touchesAny(lot, ctx.roads) || touchesAny(lot, ctx.taken) || !insideLand(lot, ctx.outline))
        continue;
      best = lot;
      bestD = d;
    }
  }
  return best;
}

const shift = (b: Bounds, dx: number, dz: number): Bounds => ({
  x0: b.x0 + dx,
  z0: b.z0 + dz,
  x1: b.x1 + dx,
  z1: b.z1 + dz,
});

/** A lot with its bays moved to where it stands. */
function placed(
  id: string,
  forId: string,
  wanted: number,
  lot: Bounds,
  shape: Shape,
  along: "x" | "z",
): Parking {
  return {
    id,
    forId,
    area: lot,
    along,
    wanted,
    bays: shape.bays.map((b) => ({ ...b, x: b.x + lot.x0, z: b.z + lot.z0 })),
    aisle: shift(shape.aisle, lot.x0, lot.z0),
  };
}

/** The lot of one building: the bays it wants, or fewer (down to six) where the land is tight. */
function lotFor(ctx: ParkingContext, b: PlanBuilding, front: Pt): Parking | undefined {
  const wanted = baysFor(b.servers);
  for (let n = wanted; ; n = Math.max(BAYS_MIN, Math.floor(n / 2))) {
    for (const along of ["x", "z"] as const) {
      const shape = shapeOf(n, along);
      const spot = findSpot(ctx, shape, front);
      if (spot) return placed(`lot:${b.id}`, b.id, wanted, spot, shape, along);
    }
    if (n <= BAYS_MIN) return undefined;
  }
}

/** Cars in 40 to 70 % of the bays of a lot, each in the middle of its bay, nose to the lane. */
function carsIn(lot: Parking, random: () => number): ParkedCar[] {
  const fill = 0.4 + 0.3 * random();
  const want = Math.min(lot.bays.length, Math.max(1, Math.round(fill * lot.bays.length)));
  const order = lot.bays.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  const cars: ParkedCar[] = [];
  for (const i of order.slice(0, want).sort((a, b) => a - b)) {
    const bay = lot.bays[i] as Bay;
    const first =
      (lot.along === "x" ? bay.z : bay.x) <
      (lot.along === "x" ? lot.area.z0 : lot.area.x0) + LOT_D_M / 2;
    const base = lot.along === "x" ? Math.PI / 2 : 0;
    cars.push({
      x: bay.x,
      z: bay.z,
      rot: base + (first ? 0 : Math.PI),
      paint: Math.floor(random() * PAINTS),
      parking: lot.id,
      bay: i,
    });
  }
  return cars;
}

/** Every building's lot, nearest the gate first, and the cars in them. */
export function planParking(
  ctx: ParkingContext,
  buildings: readonly PlanBuilding[],
  entrances: ReadonlyMap<string, Entrance>,
  seed: number,
): { parking: Parking[]; cars: ParkedCar[] } {
  const random = rng(seed * 7919 + 13);
  const parking: Parking[] = [];
  const cars: ParkedCar[] = [];
  for (const b of buildings) {
    const e = entrances.get(b.id);
    if (!e) continue;
    const lot = lotFor(ctx, b, e.front);
    if (!lot) continue;
    parking.push(lot);
    cars.push(...carsIn(lot, random));
    ctx.taken.push(inflate(lot.area, 1));
  }
  return { parking, cars };
}
