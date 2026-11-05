import { type Field, fieldOf } from "./airflow-field";
import {
  type AirReadings,
  type AirView,
  airColor,
  isLiquidHall,
  type RackSpot,
  rackSpots,
  reachAt,
  type UnitSpot,
  unitSpots,
} from "./airflow-model";
import { type FlowPath, pathsOf } from "./airflow-paths";
import type { Rgb } from "./palette";
import { type Bounds, inflate, unionOf } from "./plan";
import { boundsOfScene, type RoomScene } from "./room";

export type { Field } from "./airflow-field";
export { fieldAt } from "./airflow-field";
export {
  AIR_NOTE,
  AIR_SCALES,
  AIR_VIEWS,
  AIR_WORDS,
  type AirReadings,
  type AirView,
  ARROWS_PER_PATH,
  airColor,
  CRITICAL_C,
  PUFF_BUDGET,
  type RackAir,
  type RackSpot,
  type UnitAir,
  type UnitSpot,
  WARN_C,
} from "./airflow-model";
export type { FlowPath, PathKind, Point3 } from "./airflow-paths";
export { frameText, hottestText, marginText } from "./airflow-words";

export interface Airflow {
  /** A liquid-cooled room: the field is drawn, the air is not (ADR-0074). */
  readonly liquid: boolean;
  readonly field: Field;
  readonly paths: readonly FlowPath[];
  readonly racks: readonly RackSpot[];
  readonly units: readonly UnitSpot[];
  /** Puffs on all the paths together. */
  readonly puffs: number;
  readonly hottest?: RackSpot;
}

export function hottestOf(racks: readonly RackSpot[]): RackSpot | undefined {
  let best: RackSpot | undefined;
  for (const r of racks) if (!best || r.inletC > best.inletC) best = r;
  return best;
}

/** What the map shows for a room: the floor's temperature for `view`, and (but in a liquid room) the air's paths. */
export function airflowOf(scene: RoomScene, readings: AirReadings, view: AirView): Airflow {
  const racks = rackSpots(scene, readings);
  const units = unitSpots(scene, readings);
  const liquid = isLiquidHall(scene);
  const paths = liquid ? [] : pathsOf(scene, racks, units);
  const hottest = hottestOf(racks);
  return {
    liquid,
    field: fieldOf(scene, racks, units, readings.ambientC, view),
    paths,
    racks,
    units,
    puffs: paths.reduce((n, p) => n + p.puffs, 0),
    ...(hottest ? { hottest } : {}),
  };
}

/** The colour of a rack's front door: its inlet or outlet reading, or a neutral grey while the air is what is shown. */
export function doorColor(view: AirView, rack: RackSpot): Rgb {
  if (view === "flow") return [0.42, 0.455, 0.52];
  return airColor(view, view === "outlet" ? rack.outletC : rack.inletC);
}

/** How much of a unit's rating it carries, 0..1. */
export const loadShareOf = (u: Pick<UnitSpot, "loadKw" | "capacityKw">): number =>
  u.capacityKw > 0 ? Math.min(1, u.loadKw / u.capacityKw) : 0;

/** How far running units' air reaches each cold aisle, 0..1: the glow of its perforated tiles. */
export function aisleReach(scene: RoomScene, air: Pick<Airflow, "units">): Map<string, number> {
  const out = new Map<string, number>();
  for (const pod of scene.pods) {
    if (pod.aisle !== "cold") continue;
    const e = pod.enclosure;
    out.set(pod.id, reachAt(air.units, (e.x0 + e.x1) / 2, (e.z0 + e.z1) / 2));
  }
  return out;
}

/**
 * Where the work of the room is, in the room's own frame: the racks and cooling units with `margin`
 * metres around them, kept inside the walls. The camera of the map fits this, not the empty rest of a big room.
 */
export function workBounds(
  scene: Pick<RoomScene, "w" | "d" | "bounds">,
  air: Pick<Airflow, "racks" | "units">,
  margin: number,
): Bounds | undefined {
  const around = [...air.racks, ...air.units].map((t) => {
    const r = Math.max(t.w, t.d) / 2;
    return { x0: t.x - r, z0: t.z - r, x1: t.x + r, z1: t.z + r };
  });
  const all = unionOf(around);
  if (!all) return undefined;
  const g = inflate(all, margin);
  const room = boundsOfScene(scene);
  return {
    x0: Math.max(room.x0, g.x0),
    z0: Math.max(room.z0, g.z0),
    x1: Math.min(room.x1, g.x1),
    z1: Math.min(room.z1, g.z1),
  };
}
