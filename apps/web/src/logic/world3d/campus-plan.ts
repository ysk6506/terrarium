/**
 * The layout of a campus's ground (REQ-105, ADR-0128): roads first, then a car park for each building,
 * then the cars in its bays, then the trees, and last what stays clear. Each step only uses what the
 * steps before it left, so nothing lands on something that is already there. Everything follows from the
 * land, the buildings and one seed: the same world is always laid out the same way.
 */

import { planParking } from "./campus-parking";
import type {
  CampusPlan,
  ClearZone,
  Entrance,
  Ground,
  PlanBuilding,
  PlanSite,
  PlanTree,
  RoadSeg,
} from "./campus-plan-types";
import { planTrees } from "./campus-trees";
import { type Bounds, boundsOf, centreOf, inflate, type Pt, unionOf } from "./plan";
import { planRoads, type RoadTarget } from "./roads";

export { BAYS_MAX, BAYS_MIN, baysFor, SERVERS_PER_BAY } from "./campus-parking";
export { TREE_GAP_M } from "./campus-trees";

/** Road width, and the grid it is laid on, metres. */
export const ROAD_W_M = 6;
/** Clear ground round a building; only the entrance path crosses it. */
export const APRON_M = 2;
/** Width of the path from a door to the road. */
export const PATH_W_M = 4;
const DOOR_OUT_M = ROAD_W_M * 1.6;

type Face = Entrance["face"];

const NORMAL: Readonly<Record<Face, Pt>> = {
  s: { x: 0, z: 1 },
  n: { x: 0, z: -1 },
  e: { x: 1, z: 0 },
  w: { x: -1, z: 0 },
};

function doorOn(a: Bounds, face: Face): Pt {
  const c = centreOf(a);
  if (face === "s") return { x: c.x, z: a.z1 };
  if (face === "n") return { x: c.x, z: a.z0 };
  return face === "e" ? { x: a.x1, z: c.z } : { x: a.x0, z: c.z };
}

const faceOf = (a: Bounds, from: Pt): Face => {
  const faces: Face[] = ["s", "n", "e", "w"];
  const score = (f: Face) => {
    const d = doorOn(a, f);
    const n = NORMAL[f];
    return Math.hypot(d.x + n.x * DOOR_OUT_M - from.x, d.z + n.z * DOOR_OUT_M - from.z);
  };
  return faces.reduce((best, f) => (score(f) < score(best) ? f : best), "s" as Face);
};

/** The point just outside a door where a road should end. */
const outside = (door: Pt, face: Face): Pt => ({
  x: door.x + NORMAL[face].x * DOOR_OUT_M,
  z: door.z + NORMAL[face].z * DOOR_OUT_M,
});

const strip = (
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  half: number,
  along: "x" | "z",
): Bounds =>
  along === "x"
    ? { x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: z0 - half, z1: z0 + half }
    : { x0: x0 - half, x1: x0 + half, z0: Math.min(z0, z1), z1: Math.max(z0, z1) };

/** The paved strips from a door to where its road ended: straight out, then across, never behind the door. */
function pathFrom(door: Pt, face: Face, end: Pt): Bounds[] {
  const n = NORMAL[face];
  const half = PATH_W_M / 2;
  const out = (end.x - door.x) * n.x + (end.z - door.z) * n.z;
  if (out < 2) return [];
  const paths: Bounds[] = [];
  if (n.x === 0) {
    paths.push(strip(door.x, door.x, door.z, end.z, half, "z"));
    if (Math.abs(end.x - door.x) > 0.5) paths.push(strip(door.x, end.x, end.z, end.z, half, "x"));
  } else {
    paths.push(strip(door.x, end.x, door.z, door.z, half, "x"));
    if (Math.abs(end.z - door.z) > 0.5) paths.push(strip(end.x, end.x, door.z, end.z, half, "z"));
  }
  return paths;
}

/** The spine: along the longer side of the land, on the gate's side of the buildings, end to end. */
function spineOf(land: Bounds, cluster: Bounds, gate: Pt): Pt[] {
  const reach = ROAD_W_M * 2;
  const margin = ROAD_W_M * 3.5;
  const clampX = (x: number) => Math.min(land.x1 - reach, Math.max(land.x0 + reach, x));
  const clampZ = (z: number) => Math.min(land.z1 - reach, Math.max(land.z0 + reach, z));
  const ends = (a: Pt, b: Pt): Pt[] =>
    Math.hypot(a.x - gate.x, a.z - gate.z) <= Math.hypot(b.x - gate.x, b.z - gate.z)
      ? [a, b]
      : [b, a];
  if (land.x1 - land.x0 >= land.z1 - land.z0) {
    const z = clampZ(Math.min(cluster.z1 + margin, gate.z - reach));
    return ends({ x: clampX(cluster.x0 - reach), z }, { x: clampX(cluster.x1 + reach), z });
  }
  const west = Math.abs(gate.x - (cluster.x0 - margin)) <= Math.abs(gate.x - (cluster.x1 + margin));
  const x = clampX(west ? cluster.x0 - margin : cluster.x1 + margin);
  return ends({ x, z: clampZ(cluster.z0 - reach) }, { x, z: clampZ(cluster.z1 + reach) });
}

function zonesOf(
  buildings: readonly PlanBuilding[],
  site: PlanSite,
  entrances: readonly Entrance[],
): ClearZone[] {
  const zones: ClearZone[] = [];
  for (const b of buildings) {
    zones.push({ kind: "footprint", of: b.id, area: b.bounds });
    zones.push({ kind: "apron", of: b.id, area: inflate(b.bounds, APRON_M) });
  }
  for (const e of entrances)
    for (const p of e.path) zones.push({ kind: "entrance", of: e.id, area: p });
  for (const y of site.yards) zones.push({ kind: "yard", of: y.id, area: y.area });
  return zones;
}

/** Roads, entrance paths, car parks and parked cars. */
export function planGround(
  site: PlanSite,
  buildings: readonly PlanBuilding[],
  seed: number,
): Ground {
  const footprints = buildings.map((b) => b.bounds);
  const solids = [...footprints, ...site.obstacles, ...site.yards.map((y) => y.area)];
  const land = boundsOf(site.outline);
  const cluster = unionOf(solids) ?? land;
  const from = { x: centreOf(cluster).x, z: cluster.z1 };
  const doors = buildings.map((b) => {
    const face = faceOf(b.bounds, from);
    return { id: b.id, face, door: doorOn(b.bounds, face) };
  });
  const targets: RoadTarget[] = [
    ...doors.map((d) => ({ id: d.id, door: outside(d.door, d.face) })),
    ...site.yards.map((y) => ({
      id: y.id,
      door: outside(doorOn(y.area, faceOf(y.area, from)), faceOf(y.area, from)),
    })),
  ];
  // From the gate to the buildings the road is one straight lead; the grid only lays what is round them.
  const gate = { x: site.gate.x, z: cluster.z1 + ROAD_W_M * 3 };
  const lead: Bounds | undefined =
    site.gate.z - gate.z > ROAD_W_M
      ? { x0: gate.x - ROAD_W_M / 2, x1: gate.x + ROAD_W_M / 2, z0: gate.z, z1: site.gate.z }
      : undefined;
  const roadPlan = planRoads({
    outline: site.outline,
    obstacles: solids,
    targets,
    gate,
    cell: ROAD_W_M,
    spine: spineOf(land, cluster, gate),
  });
  const entrances: Entrance[] = doors.map((d) => {
    const line = roadPlan.routes.find((r) => r.id === d.id)?.line;
    const end = line?.[line.length - 1] ?? outside(d.door, d.face);
    return {
      id: d.id,
      face: d.face,
      door: d.door,
      front: end,
      path: line ? pathFrom(d.door, d.face, end) : [],
    };
  });
  const roads: RoadSeg[] = [
    ...(lead ? [{ kind: "road" as const, area: lead }] : []),
    ...roadPlan.rects.map((area): RoadSeg => ({ kind: "road", area })),
    ...entrances.flatMap((e) => e.path.map((area): RoadSeg => ({ kind: "driveway", area }))),
  ];
  const roadAreas = roads.map((r) => r.area);
  const taken = [
    ...footprints.map((b) => inflate(b, APRON_M + 1)),
    ...[...site.obstacles, ...site.yards.map((y) => y.area), ...site.avoid].map((b) =>
      inflate(b, 2),
    ),
  ];
  const lots = planParking(
    { outline: site.outline, roads: roadAreas, taken },
    buildings,
    new Map(entrances.map((e) => [e.id, e])),
    seed,
  );
  return {
    roads,
    roadPlan: {
      ...roadPlan,
      rects: roadAreas,
      routes: lead
        ? [{ id: "gate", line: [{ x: gate.x, z: site.gate.z }, gate] }, ...roadPlan.routes]
        : roadPlan.routes,
    },
    entrances,
    parking: lots.parking,
    cars: lots.cars,
    clearZones: zonesOf(buildings, site, entrances),
  };
}

/** Everything a tree keeps 3 m off. */
export function keepOf(site: PlanSite, ground: Ground, extra: readonly Bounds[]): Bounds[] {
  return [
    ...ground.clearZones.filter((z) => z.kind !== "entrance").map((z) => z.area),
    ...ground.roads.map((r) => r.area),
    ...ground.parking.map((p) => p.area),
    ...site.obstacles,
    ...site.avoid,
    ...extra,
  ];
}

/** The trees: fence line, road lines, groves; `extra` is ground the caller has put to use since (blocks, paving). */
export function planGreen(
  site: PlanSite,
  ground: Ground,
  extra: readonly Bounds[],
  seed: number,
): PlanTree[] {
  const solids = ground.clearZones.filter((z) => z.kind === "footprint").map((z) => z.area);
  return planTrees({
    outline: site.outline,
    gate: site.gate,
    keep: keepOf(site, ground, extra),
    lines: ground.roadPlan.routes.map((r) => r.line),
    roadWidth: ROAD_W_M,
    cluster: unionOf([...solids, ...site.obstacles]) ?? boundsOf(site.outline),
    seed,
  });
}

/** The whole plan: ground, then trees. */
export function campusPlan(
  site: PlanSite,
  buildings: readonly PlanBuilding[],
  seed: number,
): CampusPlan {
  const ground = planGround(site, buildings, seed);
  return { ...ground, trees: planGreen(site, ground, [], seed) };
}

/** Whether a visitor may stand here: not on a road, in a lot, inside a building or its yard, or under a trunk. */
export function standable(plan: CampusPlan, p: Pt, trunk = 0.8): boolean {
  const inside = (b: Bounds) => p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1;
  if (plan.roads.some((r) => inside(r.area)) || plan.parking.some((l) => inside(l.area)))
    return false;
  if (plan.clearZones.some((z) => (z.kind === "footprint" || z.kind === "yard") && inside(z.area)))
    return false;
  return !plan.trees.some((t) => Math.hypot(t.x - p.x, t.z - p.z) < trunk);
}

/** Share of the trees drawn at each quality: the fence and road lines go last, the groves first. */
export const TREE_SHARE = { high: 1, low: 0.6, min: 0.3 } as const;

/** The trees to draw at a quality: a fixed, even thinning (every tree has a place in 0..1 and stays below the share). */
export function treesAt<T extends { readonly row?: string }>(
  trees: readonly T[],
  quality: keyof typeof TREE_SHARE,
): T[] {
  const share = TREE_SHARE[quality];
  if (share >= 1) return [...trees];
  return trees.filter((t, i) => {
    const place = (i * 0.6180339887) % 1;
    return t.row === "grove" ? place < share * 0.6 : place < Math.min(1, share + 0.15);
  });
}
