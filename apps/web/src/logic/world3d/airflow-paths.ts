/**
 * The paths the air takes (REQ-072, ADR-0074), as polylines in metres with a strength from 0 to 1:
 * supply from each running unit along the floor into the cold aisles, a rise of cold air at the front of
 * each rack, the warm exhaust behind each rack leaning toward the nearest running unit, and the return
 * along the back of each row up at the ceiling into that unit. Strength falls with the distance from a
 * running unit and follows that unit's share of the load; a stopped unit has none, so nothing leaves it.
 */
import {
  ARROWS_PER_PATH,
  clamp,
  falloff,
  frontOf,
  mean,
  nearestRunning,
  PUFF_BUDGET,
  type RackSpot,
  reachAt,
  type UnitSpot,
} from "./airflow-model";
import type { RoomScene } from "./room";

export type PathKind = "supply" | "rise" | "exhaust" | "return";

export type Point3 = readonly [number, number, number];

export interface FlowPath {
  readonly id: string;
  readonly kind: PathKind;
  readonly points: readonly Point3[];
  /** 0..1: how hard the air moves here; it drives the speed and the opacity of what is drawn on it. */
  readonly strength: number;
  /** The temperature of the air on it, °C, for its colour. */
  readonly valueC: number;
  /** Length of the polyline, metres. */
  readonly length: number;
  /** How many puffs ride on it and how many arrows point along it. */
  readonly puffs: number;
  readonly arrows: number;
  /** The unit it comes from or goes to. */
  readonly unit?: string;
}

interface Draft extends Omit<FlowPath, "puffs" | "arrows"> {
  readonly want: number;
}

const MIN_STRENGTH = 0.03;
const BROAD_SHARE = 0.55;
const BROAD_MIN_PUFFS = 6;
const SMALL_MIN_PUFFS = 2;
const SMALL_MAX_PUFFS = 4;
const FLOOR_RISE_M = 0.12;
const RETURN_HEIGHT_M = 2.4;

const isBroad = (p: { kind: PathKind }): boolean => p.kind === "supply" || p.kind === "return";

function lengthOf(points: readonly Point3[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point3;
    const b = points[i] as Point3;
    sum += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return sum;
}

/** Points that sit on top of the one before add nothing to a smooth curve. */
function distinct(points: readonly Point3[]): Point3[] {
  const out: Point3[] = [];
  for (const p of points) {
    const last = out.at(-1);
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) > 0.25) out.push(p);
  }
  return out;
}

function draft(
  id: string,
  kind: PathKind,
  points: readonly Point3[],
  strength: number,
  valueC: number,
  unit?: UnitSpot,
): Draft[] {
  const pts = distinct(points);
  if (strength < MIN_STRENGTH || pts.length < 2) return [];
  const length = lengthOf(pts);
  const want = isBroad({ kind }) ? clamp(Math.round(length * 1.6), 8, 28) : SMALL_MAX_PUFFS;
  return [
    { id, kind, points: pts, strength, valueC, length, want, ...(unit ? { unit: unit.id } : {}) },
  ];
}

function supplyPaths(scene: RoomScene, units: readonly UnitSpot[]): Draft[] {
  const y = scene.floorY + FLOOR_RISE_M;
  const out: Draft[] = [];
  const cold = scene.pods.filter((p) => p.aisle === "cold");
  for (const pod of cold) {
    const e = pod.enclosure;
    const cx = (e.x0 + e.x1) / 2;
    const cz = (e.z0 + e.z1) / 2;
    const u = nearestRunning(units, cx, cz);
    if (!u) continue;
    const s0 = frontOf(u, 0.1);
    const s1 = frontOf(u, 1.2);
    const alongX = e.x1 - e.x0 >= e.z1 - e.z0;
    const entry = alongX
      ? { x: clamp(s1.x, e.x0, e.x1), z: cz }
      : { x: cx, z: clamp(s1.z, e.z0, e.z1) };
    const ends = alongX
      ? [
          { x: e.x0, z: cz },
          { x: e.x1, z: cz },
        ]
      : [
          { x: cx, z: e.z0 },
          { x: cx, z: e.z1 },
        ];
    const far = ends.reduce((a, b) =>
      Math.hypot(a.x - entry.x, a.z - entry.z) > Math.hypot(b.x - entry.x, b.z - entry.z) ? a : b,
    );
    const corner = alongX ? { x: s1.x, z: cz } : { x: cx, z: s1.z };
    const points: Point3[] = [
      [s0.x, u.baseY + u.h * 0.4, s0.z],
      [s1.x, y, s1.z],
      [corner.x, y, corner.z],
      [entry.x, y, entry.z],
      [far.x, y, far.z],
    ];
    out.push(
      ...draft(
        `supply-${u.id}-${pod.id}`,
        "supply",
        points,
        u.drive * falloff(Math.hypot(cx - u.x, cz - u.z)),
        u.supplyC,
        u,
      ),
    );
  }
  return out;
}

/**
 * The air a running unit blows lies on the floor in front of it (ADR-0074). With no cold aisle that is all of
 * its supply, fanned out; with cold aisles it is one short plume, so every running unit shows that it blows
 * and a stopped one shows nothing.
 */
function openFloorPaths(scene: RoomScene, units: readonly UnitSpot[]): Draft[] {
  const aisles = scene.pods.some((p) => p.aisle === "cold");
  const y = scene.floorY + FLOOR_RISE_M;
  const out: Draft[] = [];
  for (const u of units) {
    if (u.drive <= 0) continue;
    const a = frontOf(u, 0.1);
    const b = frontOf(u, 1.2);
    const c = frontOf(u, 4);
    out.push(
      ...draft(
        `${aisles ? "plume" : "supply"}-${u.id}`,
        "supply",
        [
          [a.x, u.baseY + u.h * 0.4, a.z],
          [b.x, y, b.z],
          [c.x, y, c.z],
        ],
        u.drive,
        u.supplyC,
        u,
      ),
    );
    if (aisles) continue;
    const side = { x: -u.fz, z: u.fx };
    [-1, 0, 1].forEach((k, i) => {
      const p = frontOf(u, 2.4);
      const x = p.x + side.x * k * (u.w / 3);
      const z = p.z + side.z * k * (u.w / 3);
      out.push(
        ...draft(
          `rise-${u.id}-${i}`,
          "rise",
          [
            [x, y, z],
            [x, y + 0.9, z],
            [x, y + 1.8, z],
          ],
          u.drive * 0.8,
          u.supplyC,
          u,
        ),
      );
    });
  }
  return out;
}

function risePaths(
  scene: RoomScene,
  racks: readonly RackSpot[],
  units: readonly UnitSpot[],
): Draft[] {
  const inCold = new Set(scene.pods.filter((p) => p.aisle === "cold").flatMap((p) => p.rackIds));
  if (inCold.size === 0) return [];
  const y = scene.floorY;
  const out: Draft[] = [];
  for (const r of racks) {
    if (!inCold.has(r.id) || r.form === "tank" || r.form === "dlc") continue;
    const u = nearestRunning(units, r.x, r.z);
    if (!u) continue;
    const m = r.d / 2 + 0.45;
    const x = r.x + r.fx * m;
    const z = r.z + r.fz * m;
    out.push(
      ...draft(
        `rise-${r.id}`,
        "rise",
        [
          [x, y + 0.05, z],
          [x + r.fx * 0.1, y + 0.9, z + r.fz * 0.1],
          [x + r.fx * 0.25, y + 1.8, z + r.fz * 0.25],
        ],
        reachAt(units, r.x, r.z),
        u.supplyC,
        u,
      ),
    );
  }
  return out;
}

function exhaustPaths(
  scene: RoomScene,
  racks: readonly RackSpot[],
  units: readonly UnitSpot[],
): Draft[] {
  const y = scene.floorY;
  const out: Draft[] = [];
  for (const r of racks) {
    if (r.form === "tank" || r.form === "dlc") continue;
    const u = nearestRunning(units, r.x, r.z);
    const gap = u ? Math.hypot(u.x - r.x, u.z - r.z) || 1 : 1;
    const lx = u ? (u.x - r.x) / gap : 0;
    const lz = u ? (u.z - r.z) / gap : 0;
    const back = r.d / 2 + 0.15;
    const bx = r.x - r.fx * back;
    const bz = r.z - r.fz * back;
    out.push(
      ...draft(
        `exhaust-${r.id}`,
        "exhaust",
        [
          [bx, y + r.h * 0.5, bz],
          [bx - r.fx * 0.35 + lx * 0.25, y + r.h * 0.9, bz - r.fz * 0.35 + lz * 0.25],
          [bx - r.fx * 0.55 + lx * 0.7, y + r.h + 0.9, bz - r.fz * 0.55 + lz * 0.7],
        ],
        clamp((r.outletC - r.inletC) / 20, 0.15, 1),
        r.outletC,
      ),
    );
  }
  return out;
}

/** Racks in a line facing the same way: they share a back aisle. */
interface Line {
  readonly quarter: number;
  readonly racks: RackSpot[];
}

function linesOf(racks: readonly RackSpot[]): Line[] {
  const lines = new Map<string, Line>();
  for (const r of racks) {
    const quarter = (((Math.round(Math.atan2(r.fx, r.fz) / (Math.PI / 2)) % 4) + 4) % 4) as number;
    const across = quarter % 2 === 0 ? r.z : r.x;
    const key = `${quarter}:${Math.round(across / 0.25)}`;
    const line = lines.get(key) ?? { quarter, racks: [] };
    line.racks.push(r);
    lines.set(key, line);
  }
  return [...lines.values()];
}

/** The ceiling run along the back of one line into the unit that takes its air. */
function returnPath(scene: RoomScene, line: Line, units: readonly UnitSpot[]): Draft[] {
  const even = line.quarter % 2 === 0;
  const along = (r: RackSpot) => (even ? r.x : r.z);
  const across = (r: RackSpot) => (even ? r.z : r.x);
  const a0 = Math.min(...line.racks.map((r) => along(r) - r.w / 2));
  const a1 = Math.max(...line.racks.map((r) => along(r) + r.w / 2));
  const first = line.racks[0] as RackSpot;
  const sign = even ? Math.sign(first.fz) || 1 : Math.sign(first.fx) || 1;
  const depth = Math.max(...line.racks.map((r) => r.d));
  const back = mean(line.racks.map(across), 0) - sign * (depth / 2 + 0.6);
  const at = (a: number, y: number): Point3 => (even ? [a, y, back] : [back, y, a]);
  const mid = (a0 + a1) / 2;
  const centre = at(mid, 0);
  const u = nearestRunning(units, centre[0], centre[2]);
  if (!u) return [];
  const uAlong = even ? u.x : u.z;
  const farIsLow = Math.abs(a0 - uAlong) > Math.abs(a1 - uAlong);
  const far = farIsLow ? a0 - 0.3 : a1 + 0.3;
  const near = farIsLow ? a1 : a0;
  const y = scene.floorY + RETURN_HEIGHT_M;
  const nearPt = at(near, y);
  const end: Point3 = [u.x + u.fx * 0.4, u.baseY + u.h + 0.2, u.z + u.fz * 0.4];
  const approach: Point3 = [
    nearPt[0] + (end[0] - nearPt[0]) * 0.55,
    y + 0.1,
    nearPt[2] + (end[2] - nearPt[2]) * 0.55,
  ];
  const heat = clamp(
    mean(
      line.racks.map((r) => r.outletC - r.inletC),
      10,
    ) / 20,
    0,
    1,
  );
  const strength =
    u.drive * falloff(Math.hypot(centre[0] - u.x, centre[2] - u.z)) * (0.55 + 0.45 * heat);
  return draft(
    `return-${u.id}-${line.quarter}-${Math.round(back * 10)}-${Math.round(mid)}`,
    "return",
    [at(far, y), at(mid, y), nearPt, approach, end],
    strength,
    mean(
      line.racks.map((r) => r.outletC),
      35,
    ),
    u,
  );
}

function returnPaths(
  scene: RoomScene,
  racks: readonly RackSpot[],
  units: readonly UnitSpot[],
): Draft[] {
  const air = racks.filter((r) => r.form !== "tank" && r.form !== "dlc");
  return linesOf(air).flatMap((line) => returnPath(scene, line, units));
}

/** Every `step`th of a list, evenly spread, `count` of them. */
function spread<T>(list: readonly T[], count: number): T[] {
  if (count >= list.length) return [...list];
  return Array.from({ length: count }, (_, j) => list[Math.floor((j * list.length) / count)] as T);
}

/** Give broad streams their puffs first, then share what is left among the rack-sized ones. */
function withBudget(drafts: readonly Draft[]): FlowPath[] {
  const cap = Math.floor(PUFF_BUDGET * BROAD_SHARE);
  let broad = drafts.filter(isBroad);
  if (broad.length * BROAD_MIN_PUFFS > cap)
    broad = [...broad]
      .sort((a, b) => b.strength - a.strength)
      .slice(0, Math.floor(cap / BROAD_MIN_PUFFS));
  const n = broad.length;
  const wanted = broad.reduce((s, p) => s + p.want, 0);
  const room = wanted > cap ? (cap - n * BROAD_MIN_PUFFS) / (wanted - n * BROAD_MIN_PUFFS) : 1;
  const counts = new Map<Draft, number>();
  let used = 0;
  for (const p of broad) {
    const c = BROAD_MIN_PUFFS + Math.floor((p.want - BROAD_MIN_PUFFS) * room);
    counts.set(p, c);
    used += c;
  }
  const small = drafts.filter((p) => !isBroad(p));
  const left = PUFF_BUDGET - used;
  const kept = spread(small, Math.max(0, Math.floor(left / SMALL_MIN_PUFFS)));
  const each =
    kept.length === 0 ? 0 : clamp(Math.floor(left / kept.length), SMALL_MIN_PUFFS, SMALL_MAX_PUFFS);
  for (const p of kept) counts.set(p, each);
  const crowded = broad.length > 40;
  return drafts.flatMap((p) => {
    const puffs = counts.get(p);
    if (puffs === undefined) return [];
    const arrows =
      isBroad(p) && p.strength >= 0.06 && p.length >= 2
        ? Math.min(
            crowded ? 1 : ARROWS_PER_PATH,
            clamp(Math.round(p.length / 4), 1, ARROWS_PER_PATH),
          )
        : 0;
    const { want: _want, ...rest } = p;
    return [{ ...rest, puffs, arrows }];
  });
}

/** All the paths of a room, with the puffs and arrows each may have (at most `PUFF_BUDGET` in all). */
export function pathsOf(
  scene: RoomScene,
  racks: readonly RackSpot[],
  units: readonly UnitSpot[],
): FlowPath[] {
  return withBudget([
    ...supplyPaths(scene, units),
    ...openFloorPaths(scene, units),
    ...risePaths(scene, racks, units),
    ...exhaustPaths(scene, racks, units),
    ...returnPaths(scene, racks, units),
  ]);
}
