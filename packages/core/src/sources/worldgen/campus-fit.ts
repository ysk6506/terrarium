/**
 * How many pods a hall of a given size holds (REQ-076, ADR-0081). A hall on a real building's storey has the
 * room the floor plan gives it, so the pods are counted from the floor: as many as the width and depth take,
 * after the cooling units along the front wall. The layout rules (aisles, margins) live here so that the
 * counting and the layout in `campus-hall` can never disagree.
 */
import type { Catalog } from "@terrarium/core/catalog";
import type { PodKind, PodPlan } from "./campus-plan";

export const MARGIN_M = 1.5;
export const COLD_AISLE_M = 1.8;
export const SERVICE_AISLE_M = 2.0;
export const HOT_AISLE_M = 1.2;
export const CROSS_GAP_M = 0.9;
export const CRAH_GAP_M = 0.6;

export interface PodShape {
  readonly rackW: number;
  readonly rackD: number;
  readonly w: number;
  readonly d: number;
}

/** Aisle between a pod's two rows: the hot aisle of a hot-sealed pod, a service aisle for tanks, else the cold aisle. */
export function innerAisle(plan: PodPlan): number {
  if (plan.kind === "tank") return SERVICE_AISLE_M;
  return plan.aisle === "hot" ? HOT_AISLE_M : COLD_AISLE_M;
}

/** Aisle left between pods: the opposite of the one inside them. */
export function outerAisle(plan: PodPlan): number {
  return plan.aisle === "hot" ? COLD_AISLE_M : HOT_AISLE_M;
}

export function shapeOf(catalog: Catalog, plan: PodPlan): PodShape {
  const model = catalog.getOf(plan.rackModel, "rack");
  return {
    rackW: model.footprint.w,
    rackD: model.footprint.d,
    w: plan.perRow * model.footprint.w,
    d: 2 * model.footprint.d + innerAisle(plan),
  };
}

/** The cell one pod takes in a hall's grid: the largest pod's size plus the gaps. */
export function podCell(
  catalog: Catalog,
  pods: readonly PodPlan[],
): { cellW: number; cellD: number; gap: number } {
  const shapes = pods.map((p) => shapeOf(catalog, p));
  const cellW = Math.max(...shapes.map((s) => s.w)) + CROSS_GAP_M;
  const gap = Math.max(...pods.map((p) => outerAisle(p)));
  return { cellW, cellD: Math.max(...shapes.map((s) => s.d)) + gap, gap };
}

/** Kilowatts of heat a rack of each kind hands to the room's air, as the cooling units are planned for. */
const AIR_KW: Readonly<Record<PodKind, number>> = { air: 7, rdhx: 3, dlc: 3, tank: 0.5 };
/** A cooling unit is planned for this share of its capacity; one spare stands by. */
const COOLING_PLAN = 0.6;
/** The air handlers of a big hall (over this much heat, kW) are the large model. */
const HEAVY_KW = 400;

/** Depth of the strip of cooling units along the front wall for this much air heat (the layout's own rule). */
function stripDepth(catalog: Catalog, airKw: number, width: number): number {
  const model = catalog.getOf(
    airKw > HEAVY_KW ? "cv-crah-250kw-chw" : "cv-crah-120kw-chw",
    "cooling_unit",
  );
  const units = Math.max(1, Math.ceil(airKw / (COOLING_PLAN * model.capacityKw))) + 1;
  let x = MARGIN_M;
  let y = MARGIN_M;
  let line = 0;
  for (let i = 0; i < units; i++) {
    if (x > MARGIN_M && x + model.footprint.w + MARGIN_M > width) {
      x = MARGIN_M;
      y += line + CRAH_GAP_M;
      line = 0;
    }
    x += model.footprint.w + CRAH_GAP_M;
    line = Math.max(line, model.footprint.d);
  }
  return y + line - MARGIN_M;
}

export interface HallFit {
  /** Pods that fit, from the first. */
  readonly pods: number;
  /** Pods per row of the grid. */
  readonly columns: number;
}

/** How many of these pods (in order) a hall of this size takes, and the columns of its grid. */
export function fitPods(
  catalog: Catalog,
  pods: readonly PodPlan[],
  room: { readonly w: number; readonly d: number },
): HallFit {
  const { cellW, cellD, gap } = podCell(catalog, pods);
  const columns = Math.max(1, Math.floor((room.w - 2 * MARGIN_M + CROSS_GAP_M) / cellW));
  const width = 2 * MARGIN_M + columns * cellW - CROSS_GAP_M;
  for (let n = pods.length; n >= 1; n--) {
    const airKw = pods.slice(0, n).reduce((sum, p) => sum + 2 * p.perRow * AIR_KW[p.kind], 0);
    const strip = stripDepth(catalog, airKw, width);
    const top = MARGIN_M + (strip > 0 ? strip + 1.5 : 0);
    const rows = Math.floor((room.d - top - MARGIN_M + gap) / cellD + 1e-9);
    if (Math.ceil(n / columns) <= rows) return { pods: n, columns: Math.min(columns, n) };
  }
  return { pods: 0, columns: 1 };
}
