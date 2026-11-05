/** Trees and parked cars for a site: scattered with a hash, so the same land always looks the same. */
import { type Bounds, inflate, insidePolygon, overlapBounds, type Pt, unit } from "./plan";

export interface Tree {
  readonly x: number;
  readonly z: number;
  /** 0.6 .. 1.5 */
  readonly scale: number;
  /** 0..1, picks a shade of green. */
  readonly tint: number;
}

export interface TreeInput {
  readonly outline: readonly Pt[];
  /** Where trees may stand (the developed area and some land around it). */
  readonly area: Bounds;
  readonly keepOut: readonly Bounds[];
  readonly spacing: number;
  readonly seed: number;
  readonly max: number;
}

const clearOf = (p: Pt, list: readonly Bounds[]): boolean =>
  !list.some((b) => p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1);

/** Trees on a jittered grid, thinned into clumps, inside the land and off everything built. */
export function scatterTrees(input: TreeInput): Tree[] {
  const { area, spacing, seed } = input;
  const trees: Tree[] = [];
  const i0 = Math.floor(area.x0 / spacing);
  const i1 = Math.ceil(area.x1 / spacing);
  const j0 = Math.floor(area.z0 / spacing);
  const j1 = Math.ceil(area.z1 / spacing);
  for (let j = j0; j <= j1 && trees.length < input.max; j++)
    for (let i = i0; i <= i1 && trees.length < input.max; i++) {
      // Low-frequency noise makes groves; the rest of the cells stay open lawn.
      const grove = unit(Math.floor(i / 4) + seed, Math.floor(j / 4) - seed);
      if (unit(i + seed * 3, j - seed * 7) > 0.28 + 0.6 * grove * grove) continue;
      const p = {
        x: (i + 0.5 + (unit(i, j + seed) - 0.5) * 0.8) * spacing,
        z: (j + 0.5 + (unit(i + seed, j) - 0.5) * 0.8) * spacing,
      };
      if (!insidePolygon(p, input.outline) || !clearOf(p, input.keepOut)) continue;
      trees.push({
        x: p.x,
        z: p.z,
        scale: 0.6 + 0.9 * unit(i * 5 + seed, j * 3),
        tint: unit(i * 11, j * 13 + seed),
      });
    }
  return trees;
}

export interface Car {
  readonly x: number;
  readonly z: number;
  /** Turn about the vertical axis, radians. */
  readonly rot: number;
  /** Index into the view's paint colours. */
  readonly paint: number;
  /** Height of the ground it stands on (a car park's roof); 0 when left out. */
  readonly y?: number;
}

export interface ParkingLot {
  readonly forId: string;
  readonly area: Bounds;
  readonly cars: readonly Car[];
}

const CAR_PITCH = 3.6;
const BAY_DEPTH = 5.4;
const PAINTS = 6;

export interface ParkingInput {
  readonly outline: readonly Pt[];
  readonly buildings: ReadonlyArray<{ readonly id: string; readonly bounds: Bounds }>;
  readonly occupied: readonly Bounds[];
  readonly seed: number;
}

/** A small lot beside each building on whichever side has room: two rows of bays, mostly filled. */
export function parkingLots(input: ParkingInput): ParkingLot[] {
  const taken = [...input.occupied];
  const lots: ParkingLot[] = [];
  for (const [n, b] of input.buildings.entries()) {
    const length = Math.min(60, Math.max(18, (b.bounds.x1 - b.bounds.x0) * 0.6));
    const depth = BAY_DEPTH * 2 + 6;
    const gap = 8;
    const sides: Bounds[] = [
      {
        x0: b.bounds.x0 - gap - length,
        z0: b.bounds.z1 - depth,
        x1: b.bounds.x0 - gap,
        z1: b.bounds.z1,
      },
      {
        x0: b.bounds.x1 + gap,
        z0: b.bounds.z1 - depth,
        x1: b.bounds.x1 + gap + length,
        z1: b.bounds.z1,
      },
    ];
    const lot = sides.find((s) => fits(s, input.outline, taken));
    if (!lot) continue;
    taken.push(inflate(lot, 2));
    lots.push({ forId: b.id, area: lot, cars: carsIn(lot, input.seed + n * 17) });
  }
  return lots;
}

function fits(area: Bounds, outline: readonly Pt[], taken: readonly Bounds[]): boolean {
  const corners: Pt[] = [
    { x: area.x0, z: area.z0 },
    { x: area.x1, z: area.z0 },
    { x: area.x0, z: area.z1 },
    { x: area.x1, z: area.z1 },
  ];
  return (
    corners.every((c) => insidePolygon(c, outline)) && !taken.some((t) => overlapBounds(t, area))
  );
}

function carsIn(lot: Bounds, seed: number): Car[] {
  const cars: Car[] = [];
  const perRow = Math.floor((lot.x1 - lot.x0) / CAR_PITCH);
  for (const [row, z] of [lot.z0 + BAY_DEPTH / 2 + 1, lot.z1 - BAY_DEPTH / 2 - 1].entries())
    for (let i = 0; i < perRow; i++) {
      if (unit(i + row * 97, seed) > 0.72) continue;
      cars.push({
        x: lot.x0 + (i + 0.5) * CAR_PITCH,
        z,
        rot: Math.PI / 2 + (row === 0 ? 0 : Math.PI),
        paint: Math.floor(unit(i, seed + row) * PAINTS),
      });
    }
  return cars;
}
