/**
 * The temperature of the floor (REQ-072, ADR-0074): a smooth field made by blending a few kinds of
 * source, as in the approved mockup. The room's air is warm where no running unit reaches and cold where
 * one does; each rack pulls the air in front of it toward its inlet reading and the air behind it toward
 * its outlet reading; a cold aisle pulls toward the supply air where the supply reaches; a running unit
 * pulls the air in front of it toward its supply. Not a fluid simulation: a picture of the readings.
 */
import {
  type AirView,
  clamp,
  frontOf,
  mean,
  type RackSpot,
  reachAt,
  type UnitSpot,
} from "./airflow-model";
import type { Bounds } from "./plan";
import type { RoomScene } from "./room";

export interface Field {
  readonly cols: number;
  readonly rows: number;
  /** Size of one cell, metres. */
  readonly cell: number;
  /** Room size, metres. */
  readonly w: number;
  readonly d: number;
  /** °C at each cell centre, row by row from z = 0. */
  readonly values: Float32Array;
}

/** The temperature of the field at a point of the room, metres. */
export function fieldAt(field: Field, x: number, z: number): number {
  const i = clamp(Math.floor(x / field.cell), 0, field.cols - 1);
  const j = clamp(Math.floor(z / field.cell), 0, field.rows - 1);
  return field.values[j * field.cols + i] as number;
}

interface Source {
  readonly x: number;
  readonly z: number;
  /** A source can be a rectangle (an aisle): distance is measured to it. */
  readonly rect?: Bounds;
  readonly value: number;
  readonly amp: number;
  /** Softness: the weight is halved at about this distance squared. */
  readonly s2: number;
  /** Beyond this distance the source is gone. */
  readonly reach: number;
}

const BIN_M = 3;
const MAX_CELLS = 160;
const MIN_CELL_M = 0.25;

export interface References {
  /** Air cooled by the units, and the warm air that gathers where no unit reaches. */
  readonly cold: number;
  readonly warm: number;
}

/** The two temperatures the room blends between, for a view of the inlet or of the outlet. */
export function referencesOf(
  racks: readonly RackSpot[],
  units: readonly UnitSpot[],
  ambientC: number,
  view: AirView,
): References {
  const inlet = mean(
    racks.map((r) => r.inletC),
    ambientC,
  );
  const outlet = mean(
    racks.map((r) => r.outletC),
    ambientC + 10,
  );
  const running = units.filter((u) => u.running);
  const supply = mean(
    running.map((u) => u.supplyC),
    inlet,
  );
  if (view === "outlet")
    return { cold: supply + 0.35 * (outlet - supply), warm: ambientC + 0.55 * (outlet - ambientC) };
  const hot = Math.max(inlet, ambientC);
  return { cold: Math.min(supply, hot), warm: hot + 0.3 * Math.max(0, outlet - hot) };
}

function sourcesOf(
  scene: RoomScene,
  racks: readonly RackSpot[],
  units: readonly UnitSpot[],
  refs: References,
  view: AirView,
): Source[] {
  const out: Source[] = [];
  for (const r of racks) {
    const near = r.d / 2 + 0.3;
    out.push({
      x: r.x + r.fx * near,
      z: r.z + r.fz * near,
      value: view === "outlet" ? r.outletC : r.inletC,
      amp: 2.5,
      s2: 0.5,
      reach: 3.5,
    });
    out.push({
      x: r.x - r.fx * (r.d / 2 + 0.4),
      z: r.z - r.fz * (r.d / 2 + 0.4),
      value: r.outletC,
      amp: 1.6,
      s2: 0.35,
      reach: 3.5,
    });
  }
  for (const u of units) {
    if (u.drive <= 0) continue;
    const at = frontOf(u, 0.8);
    out.push({ x: at.x, z: at.z, value: refs.cold, amp: 3 * u.drive, s2: 4, reach: 6 });
  }
  for (const pod of scene.pods) {
    if (pod.aisle !== "cold") continue;
    const e = pod.enclosure;
    const cx = (e.x0 + e.x1) / 2;
    const cz = (e.z0 + e.z1) / 2;
    const pull = reachAt(units, cx, cz);
    if (pull > 0.02)
      out.push({ x: cx, z: cz, rect: e, value: refs.cold, amp: 2.4 * pull, s2: 0.5, reach: 3 });
  }
  return out;
}

const distanceSq = (s: Source, x: number, z: number): number => {
  if (!s.rect) return (x - s.x) ** 2 + (z - s.z) ** 2;
  const dx = Math.max(s.rect.x0 - x, 0, x - s.rect.x1);
  const dz = Math.max(s.rect.z0 - z, 0, z - s.rect.z1);
  return dx * dx + dz * dz;
};

interface Bins {
  readonly nx: number;
  readonly nz: number;
  readonly lists: Source[][];
}

function binsOf(sources: readonly Source[], w: number, d: number): Bins {
  const nx = Math.ceil(w / BIN_M) + 1;
  const nz = Math.ceil(d / BIN_M) + 1;
  const lists: Source[][] = Array.from({ length: nx * nz }, () => []);
  for (const s of sources) {
    const r = s.rect ?? { x0: s.x, z0: s.z, x1: s.x, z1: s.z };
    const bx0 = clamp(Math.floor((r.x0 - s.reach) / BIN_M), 0, nx - 1);
    const bx1 = clamp(Math.floor((r.x1 + s.reach) / BIN_M), 0, nx - 1);
    const bz0 = clamp(Math.floor((r.z0 - s.reach) / BIN_M), 0, nz - 1);
    const bz1 = clamp(Math.floor((r.z1 + s.reach) / BIN_M), 0, nz - 1);
    for (let bz = bz0; bz <= bz1; bz++)
      for (let bx = bx0; bx <= bx1; bx++) (lists[bz * nx + bx] as Source[]).push(s);
  }
  return { nx, nz, lists };
}

/** The temperature of one cell: the room's own air with every source in reach blended in. */
function blend(bins: Bins, base: number, x: number, z: number): number {
  const bx = clamp(Math.floor(x / BIN_M), 0, bins.nx - 1);
  const bz = clamp(Math.floor(z / BIN_M), 0, bins.nz - 1);
  let sum = base;
  let weight = 1;
  for (const s of bins.lists[bz * bins.nx + bx] as Source[]) {
    const d2 = distanceSq(s, x, z);
    const t = d2 / (s.reach * s.reach);
    if (t >= 1) continue;
    const w = (s.amp * (1 - t) * (1 - t)) / (1 + d2 / s.s2);
    sum += w * s.value;
    weight += w;
  }
  return sum / weight;
}

/**
 * The floor's temperature for a view. The inlet and flow views blend the inlet readings in front of the
 * racks; the outlet view blends the outlet readings. Where no running unit reaches, the room is warm.
 */
export function fieldOf(
  scene: RoomScene,
  racks: readonly RackSpot[],
  units: readonly UnitSpot[],
  ambientC: number,
  view: AirView,
): Field {
  const cell = Math.max(MIN_CELL_M, Math.max(scene.w, scene.d) / MAX_CELLS);
  const cols = Math.max(1, Math.ceil(scene.w / cell));
  const rows = Math.max(1, Math.ceil(scene.d / cell));
  const refs = referencesOf(racks, units, ambientC, view);
  const bins = binsOf(sourcesOf(scene, racks, units, refs, view), scene.w, scene.d);
  const values = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const x = (i + 0.5) * cell;
      const z = (j + 0.5) * cell;
      const base = refs.warm + (refs.cold - refs.warm) * reachAt(units, x, z);
      values[j * cols + i] = blend(bins, base, x, z);
    }
  return { cols, rows, cell, w: scene.w, d: scene.d, values };
}
