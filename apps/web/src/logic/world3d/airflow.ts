/**
 * The airflow map of one server room (REQ-072, ADR-0074): from the room as the 3D view has it and the
 * live readings of its racks and cooling units, the temperature of the floor, the colour of each rack's
 * front door, and the paths the air takes with how strong each is. DOM-free, so it is tested without
 * a browser. It is a picture of the readings, not a fluid simulation (CFD).
 */
import { celsius } from "../format";
import { type Field, fieldOf } from "./airflow-field";
import {
  type AirReadings,
  type AirView,
  airColor,
  CRITICAL_C,
  isLiquidHall,
  type RackSpot,
  rackSpots,
  reachAt,
  type UnitSpot,
  unitSpots,
  WARN_C,
} from "./airflow-model";
import { type FlowPath, pathsOf } from "./airflow-paths";
import type { Rgb } from "./palette";
import { type Bounds, inflate, unionOf } from "./plan";
import type { RoomScene } from "./room";

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

/** How far an inlet temperature is from the warning and critical lines the physics raises alarms at. */
export function marginText(inletC: number): string {
  if (inletC > CRITICAL_C)
    return `심각선 ${CRITICAL_C}°C를 ${celsius(inletC - CRITICAL_C)} 넘었어요`;
  if (inletC > WARN_C)
    return `경고선 ${WARN_C}°C를 넘었고 심각선까지 ${celsius(CRITICAL_C - inletC)} 남았어요`;
  return `경고선 ${WARN_C}°C까지 ${celsius(WARN_C - inletC)} 남았어요`;
}

/** The words for the hottest rack. */
export const hottestText = (name: string, inletC: number): string =>
  `가장 더운 곳 · ${name} 흡기 ${celsius(inletC)} · ${marginText(inletC)}`;

/** Where in the run a frame is, in words: "시작", "30초 뒤", "5분 30초 뒤". */
export function frameText(seconds: number): string {
  if (seconds <= 0) return "시작";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m > 0 ? `${m}분 ` : ""}${s > 0 ? `${s}초 ` : ""}뒤`.trim();
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
  scene: Pick<RoomScene, "w" | "d">,
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
  return {
    x0: Math.max(0, g.x0),
    z0: Math.max(0, g.z0),
    x1: Math.min(scene.w, g.x1),
    z1: Math.min(scene.d, g.z1),
  };
}
