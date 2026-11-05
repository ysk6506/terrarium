/**
 * The parts of the airflow map that the field and the paths share (REQ-072, ADR-0074): what is read
 * from the world, where each rack and each cooling unit stands and which way it faces, how far a
 * running unit's air reaches, and the colour of a temperature. Plain numbers, no browser.
 */
import { INLET_WARNING_C, RACK_CRITICAL_C } from "@terrarium/core/physics";
import { AIR_NOTE, AIR_VIEWS, AIR_WORDS, type AirView } from "./airflow-words";
import type { RackForm } from "./modes";
import { heatColor, hex, mix, type Rgb } from "./palette";
import type { RoomScene } from "./room";

export { AIR_NOTE, AIR_VIEWS, AIR_WORDS, type AirView };

/** Colour scales, °C: the inlet one is the 18-36 of the approved mockup, the outlet one is 26-50. */
export const AIR_SCALES: Readonly<Record<"inlet" | "outlet", { lo: number; hi: number }>> = {
  inlet: { lo: 18, hi: 36 },
  outlet: { lo: 26, hi: 50 },
};

/** The rack inlet temperatures the physics warns and raises an alarm at. */
export const WARN_C = INLET_WARNING_C;
export const CRITICAL_C = RACK_CRITICAL_C;

/** Puffs on screen at most, in a whole hall; arrows at most on one path (ADR-0074). */
export const PUFF_BUDGET = 600;
export const ARROWS_PER_PATH = 4;

/** What the physics says about a rack. */
export interface RackAir {
  readonly inletC: number;
  readonly outletC: number;
}

/** What the physics says about a cooling unit. */
export interface UnitAir {
  readonly running: boolean;
  readonly supplyC: number;
  readonly returnC: number;
  readonly loadKw: number;
  readonly capacityKw: number;
}

/** The live facts the map is drawn from: one reading per rack and per cooling unit, and the room's air. */
export interface AirReadings {
  readonly racks: ReadonlyMap<string, RackAir>;
  readonly units: ReadonlyMap<string, UnitAir>;
  readonly ambientC: number;
}

/** A rack as the map sees it: where it stands, which way it faces, and what it reads. */
export interface RackSpot extends RackAir {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  /** Unit vector from the rack toward the air it breathes (its front). */
  readonly fx: number;
  readonly fz: number;
  readonly w: number;
  readonly d: number;
  readonly h: number;
  readonly form: RackForm;
}

/** A cooling unit as the map sees it. `drive` is how hard it blows: 0 for a stopped one. */
export interface UnitSpot extends UnitAir {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly z: number;
  readonly fx: number;
  readonly fz: number;
  readonly w: number;
  readonly d: number;
  readonly h: number;
  readonly baseY: number;
  readonly drive: number;
}

/** How far a unit's air carries: its reach is halved at this distance, metres. */
export const REACH_M = 12;

/** Strength of a unit's air at a distance from it, 1 at the unit and falling smoothly. */
export const falloff = (distance: number): number => 1 / (1 + (distance / REACH_M) ** 2);

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The air a rack breathes when nothing was read for it: the room's. */
const unread = (ambientC: number): RackAir => ({ inletC: ambientC, outletC: ambientC + 10 });

export function rackSpots(scene: RoomScene, readings: AirReadings): RackSpot[] {
  const out: RackSpot[] = [];
  for (const set of scene.sets)
    set.ids.forEach((id, i) => {
      const turn = set.at[i * 4 + 3] as number;
      const read = readings.racks.get(id) ?? unread(readings.ambientC);
      out.push({
        id,
        x: set.at[i * 4] as number,
        z: set.at[i * 4 + 2] as number,
        fx: Math.sin(turn),
        fz: Math.cos(turn),
        w: set.kind.w,
        d: set.kind.d,
        h: set.kind.h,
        form: set.kind.form,
        inletC: read.inletC,
        outletC: read.outletC,
      });
    });
  return out;
}

export function unitSpots(scene: RoomScene, readings: AirReadings): UnitSpot[] {
  const raw = scene.equipment
    .filter((e) => e.kind === "cooling_unit")
    .map((e) => {
      const read = readings.units.get(e.id);
      return {
        id: e.id,
        name: e.name,
        x: e.x,
        z: e.z,
        fx: Math.sin(e.rot),
        fz: Math.cos(e.rot),
        w: e.w,
        d: e.d,
        h: e.h,
        baseY: e.oy,
        running: read?.running ?? true,
        supplyC: read?.supplyC ?? 18,
        returnC: read?.returnC ?? 28,
        loadKw: read?.loadKw ?? 0,
        capacityKw: read?.capacityKw ?? (e.capacity || 50),
      };
    });
  const busiest = Math.max(0, ...raw.filter((u) => u.running).map((u) => u.loadKw));
  return raw.map((u) => ({
    ...u,
    drive: u.running ? 0.35 + 0.65 * (busiest > 0 ? u.loadKw / busiest : 1) : 0,
  }));
}

/** The point on the floor just in front of a unit's face, `m` metres out. */
export function frontOf(u: UnitSpot, m: number): { x: number; z: number } {
  const half = Math.abs(u.fx) * (u.w / 2) + Math.abs(u.fz) * (u.d / 2);
  return { x: u.x + u.fx * (half + m), z: u.z + u.fz * (half + m) };
}

/**
 * How far running units' air reaches a point, 0..1: the strongest unit counts in full and the others a
 * little. A stopped unit has no drive and adds nothing.
 */
export function reachAt(units: readonly UnitSpot[], x: number, z: number): number {
  let best = 0;
  let sum = 0;
  for (const u of units) {
    if (u.drive <= 0) continue;
    const v = u.drive * falloff(Math.hypot(x - u.x, z - u.z));
    sum += v;
    best = Math.max(best, v);
  }
  return Math.min(1, best + 0.3 * (sum - best));
}

/** The running unit nearest a point, if any is running. */
export function nearestRunning(
  units: readonly UnitSpot[],
  x: number,
  z: number,
): UnitSpot | undefined {
  let best: UnitSpot | undefined;
  let gap = Number.POSITIVE_INFINITY;
  for (const u of units) {
    if (u.drive <= 0) continue;
    const g = Math.hypot(x - u.x, z - u.z);
    if (g < gap) {
      gap = g;
      best = u;
    }
  }
  return best;
}

/** Liquid halls get the field only: the air there does not carry the heat (ADR-0074). */
export const isLiquidHall = (scene: RoomScene): boolean =>
  scene.mode === "immersion" || scene.mode === "dlc";

const DEEP_RED = hex("#b8323a");

/** The colour of a temperature on the scale of a view; above the palette's red it darkens to a deep red. */
export function airColor(view: AirView, celsius: number): Rgb {
  const { lo, hi } = AIR_SCALES[view === "outlet" ? "outlet" : "inlet"];
  const c = 18 + ((celsius - lo) / (hi - lo)) * 18;
  return c <= 32 ? heatColor(c) : mix(heatColor(32), DEEP_RED, (c - 32) / 4);
}

export const mean = (list: readonly number[], fallback: number): number =>
  list.length === 0 ? fallback : list.reduce((a, b) => a + b, 0) / list.length;
