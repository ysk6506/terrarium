/**
 * One generated data hall (REQ-043, REQ-047): pods of racks drafted from the plan, assigned to power
 * blocks, sized for cooling, laid out on the floor with aisles, and wired. A hall is made in two steps
 * so cooling and power can be sized for all halls of a building before anything is assembled.
 */
import type { Catalog } from "@terrarium/core/catalog";
import type { SeededRng } from "@terrarium/core/kernel";
import type { EquipmentSpec, PodSpec, RackSpec, RoomSpec } from "@terrarium/core/sources";
import type { RackSpot } from "@terrarium/core/spatial";
import { bulkProps } from "@terrarium/core/world";
import type { HallPlan, PodPlan } from "./campus-plan";
import { HALL_MODE_LABELS } from "./campus-plan";
import { draftRack, sidesOf } from "./campus-rack";
import {
  blockId,
  type CampusCtx,
  type HallDraft,
  type PodDraft,
  type RackDraft,
} from "./campus-types";

/** Most expected IT load a power block (a UPS pair) carries, W. */
const BLOCK_LIMIT_W = 600_000;
const MARGIN_M = 1.5;
const COLD_AISLE_M = 1.8;
const SERVICE_AISLE_M = 2.0;
const HOT_AISLE_M = 1.2;
const CROSS_GAP_M = 0.9;
const CRAH_GAP_M = 0.6;
/** Expected load a cooling unit is planned for, as a share of its capacity. */
const COOLING_PLAN = 0.6;

const two = (n: number) => String(n).padStart(2, "0");

export function draftHall(ctx: CampusCtx, plan: HallPlan, rng: SeededRng): HallDraft {
  const level = plan.floorId.split("-f").at(-1);
  const host = `${ctx.code}${plan.building}-${level}${plan.letter.toLowerCase()}`;
  const hall: HallDraft = { plan, rng, pods: [], blocks: 1, loadW: 0, airW: 0, liquidW: 0 };
  plan.pods.forEach((podPlan, i) => {
    const id = `${plan.id}-p${two(i + 1)}`;
    const pod: PodDraft = {
      id,
      name: `${level}${plan.letter}-P${two(i + 1)}`,
      plan: podPlan,
      racks: [],
      spines: [],
      block: 1,
      loadW: 0,
    };
    for (const row of [0, 1] as const)
      for (let col = 0; col < podPlan.perRow; col++) {
        const label = `${pod.name}-${row === 0 ? "A" : "B"}${two(col + 1)}`;
        const slot = {
          id: `${id}-${row === 0 ? "a" : "b"}${two(col + 1)}`,
          name: label,
          row,
          col,
          host,
        };
        const rack = draftRack(ctx, rng.fork(slot.id), pod, slot);
        pod.racks.push(rack);
        pod.loadW += rack.loadW;
        hall.airW += rack.airW;
        hall.liquidW += rack.liquidW;
      }
    hall.loadW += pod.loadW;
    hall.pods.push(pod);
  });
  assignBlocks(hall);
  return hall;
}

/** Pods are dealt into power blocks in order; a new block starts when the current one would be too full. */
function assignBlocks(hall: HallDraft): void {
  let block = 1;
  let load = 0;
  for (const pod of hall.pods) {
    if (load > 0 && load + pod.loadW > BLOCK_LIMIT_W) {
      block++;
      load = 0;
    }
    pod.block = block;
    load += pod.loadW;
  }
  hall.blocks = block;
}

export interface CrahPlan {
  readonly model: string;
  readonly chilled: boolean;
  readonly count: number;
}

/** Cooling units for the heat the air has to carry, with one spare. */
export function planCrah(catalog: Catalog, hall: HallDraft): CrahPlan {
  const heavy = hall.airW > 400_000;
  const dx = hall.plan.mode === "air" && hall.airW <= 600_000 && hall.rng.random() < 0.4;
  const model = dx
    ? hall.rng.pick(["crah-100kw", "cv-dx-60kw"])
    : heavy
      ? "cv-crah-250kw-chw"
      : "cv-crah-120kw-chw";
  const capW = catalog.getOf(model, "cooling_unit").capacityKw * 1000;
  const needed = Math.max(1, Math.ceil(hall.airW / (COOLING_PLAN * capW)));
  return { model, chilled: !dx, count: needed + 1 };
}

interface PodShape {
  readonly rackW: number;
  readonly rackD: number;
  readonly w: number;
  readonly d: number;
}

/** Aisle between a pod's two rows: the hot aisle of a hot-sealed pod, a service aisle for tanks, else the cold aisle. */
function innerAisle(plan: PodPlan): number {
  if (plan.kind === "tank") return SERVICE_AISLE_M;
  return plan.aisle === "hot" ? HOT_AISLE_M : COLD_AISLE_M;
}

/** Aisle left between pods: the opposite of the one inside them. */
function outerAisle(plan: PodPlan): number {
  return plan.aisle === "hot" ? COLD_AISLE_M : HOT_AISLE_M;
}

function shapeOf(catalog: Catalog, plan: PodPlan): PodShape {
  const model = catalog.getOf(plan.rackModel, "rack");
  return {
    rackW: model.footprint.w,
    rackD: model.footprint.d,
    w: plan.perRow * model.footprint.w,
    d: 2 * model.footprint.d + innerAisle(plan),
  };
}

interface Grid {
  readonly cellW: number;
  readonly cellD: number;
  /** Aisle between pod rows, which the last row of pods does not need. */
  readonly gap: number;
  readonly columns: number;
}

function gridOf(catalog: Catalog, hall: HallDraft): Grid {
  const shapes = hall.pods.map((p) => shapeOf(catalog, p.plan));
  const cellW = Math.max(...shapes.map((s) => s.w)) + CROSS_GAP_M;
  const gap = Math.max(...hall.pods.map((p) => outerAisle(p.plan)));
  const cellD = Math.max(...shapes.map((s) => s.d)) + gap;
  const columns = Math.max(
    1,
    Math.round(Math.sqrt((hall.pods.length * cellD * hall.plan.aspect) / cellW)),
  );
  return { cellW, cellD, gap, columns: Math.min(columns, hall.pods.length) };
}

/** Cooling units in lines along the front wall; returns where each stands and how deep the strip is. */
function coolingStrip(
  catalog: Catalog,
  units: readonly EquipmentSpec[],
  width: number,
): { at: Map<string, { x: number; y: number }>; depth: number } {
  const at = new Map<string, { x: number; y: number }>();
  let x = MARGIN_M;
  let y = MARGIN_M;
  let line = 0;
  for (const unit of units) {
    const size = catalog.getOf(unit.modelId, "cooling_unit").footprint;
    if (x > MARGIN_M && x + size.w + MARGIN_M > width) {
      x = MARGIN_M;
      y += line + CRAH_GAP_M;
      line = 0;
    }
    at.set(unit.id, { x, y });
    x += size.w + CRAH_GAP_M;
    line = Math.max(line, size.d);
  }
  return { at, depth: units.length > 0 ? y + line - MARGIN_M : 0 };
}

/** Which way a row faces: toward the aisle between the rows, except in a hot-sealed pod, where backs face it. */
function facing(plan: PodPlan, row: 0 | 1): 0 | 180 {
  const towardAisle = row === 0 ? 0 : 180;
  if (plan.aisle !== "hot") return towardAisle;
  return towardAisle === 0 ? 180 : 0;
}

export interface HallParts {
  readonly crah: CrahPlan;
  /** CDUs liquid racks of this hall are wired to (two each), from the floor's mechanical room. */
  readonly cdus: readonly string[];
}

/** Everything for one hall: the room with racks, pods and cooling units, and its links. */
export function emitHall(ctx: CampusCtx, hall: HallDraft, parts: HallParts): void {
  const { catalog, asm } = ctx;
  const grid = gridOf(catalog, hall);
  const rowsOfPods = Math.ceil(hall.pods.length / grid.columns);
  const width = 2 * MARGIN_M + grid.columns * grid.cellW - CROSS_GAP_M;
  const crah: EquipmentSpec[] = Array.from({ length: parts.crah.count }, (_, i) => ({
    id: `${hall.plan.id}-crah${i + 1}`,
    kind: "cooling_unit",
    name: `CRAH-${hall.plan.name.split(" ")[0]}-${i + 1}`,
    modelId: parts.crah.model,
  }));
  const strip = coolingStrip(catalog, crah, width);
  const top = MARGIN_M + (strip.depth > 0 ? strip.depth + 1.5 : 0);
  const racks: RackSpec[] = [];
  const pods: PodSpec[] = [];
  const devices = hall.pods.flatMap((p) => p.racks.flatMap((r) => r.devices));
  const rackX = new Map<string, number>();
  hall.pods.forEach((pod, i) => {
    const cell = {
      x: MARGIN_M + (i % grid.columns) * grid.cellW,
      y: top + Math.floor(i / grid.columns) * grid.cellD,
    };
    const shape = shapeOf(catalog, pod.plan);
    for (const rack of pod.racks) {
      const at: RackSpot = {
        x: cell.x + rack.col * shape.rackW,
        y: cell.y + (rack.row === 0 ? 0 : shape.rackD + innerAisle(pod.plan)),
        rotation: facing(pod.plan, rack.row),
        row: 2 * Math.floor(i / grid.columns) + rack.row + 1,
        column: (i % grid.columns) * pod.plan.perRow + rack.col + 1,
      };
      racks.push({
        id: rack.id,
        name: rack.name,
        hint: { floorInfo: {}, unitSpan: 1 },
        modelId: rack.model,
        at,
        ...(rack.light ? { props: bulkProps(rack.light) } : {}),
      });
      rackX.set(rack.id, at.x);
    }
    if (pod.plan.kind !== "tank" && pod.plan.aisle !== "open")
      pods.push({
        id: pod.id,
        name: `${hall.plan.name} 컨테인먼트 ${pod.name.split("-").at(-1)}`,
        aisle: pod.plan.aisle,
        racks: pod.racks.map((r) => r.id),
      });
  });
  const placed = crah.map((c) => ({ ...c, at: strip.at.get(c.id) }) as EquipmentSpec);
  const depth = top + rowsOfPods * grid.cellD - grid.gap + MARGIN_M;
  const room: RoomSpec = {
    id: hall.plan.id,
    name: `${hall.plan.name}(${HALL_MODE_LABELS[hall.plan.mode]})`,
    purpose: "data_hall",
    racks,
    devices,
    equipment: placed,
    pods,
    size: { w: width, d: depth },
    props: { cooling: hall.plan.mode, containment: hall.plan.containment, pods: hall.pods.length },
  };
  asm.room(hall.plan.floorId, room);
  wireHall(ctx, hall, parts, rackX, strip.at);
}

/** Rack power: each device on a PDU of each side, each PDU on its block's switchgear. */
function wirePower(ctx: CampusCtx, hall: HallDraft, pod: PodDraft, rack: RackDraft): void {
  const block = blockId(hall, pod.block);
  const sides = sidesOf(ctx.spec.powerRedundancy);
  if (rack.light) {
    // A light rack has no PDUs of its own to stand in for: it takes both feeds itself.
    for (const side of sides) ctx.asm.link("power", rack.id, `${block}-sw-${side}`);
    return;
  }
  rack.powered.forEach((device, i) => {
    for (const side of sides) {
      const list = rack.pdus[side];
      ctx.asm.link("power", device, list[i % list.length] as string);
    }
  });
  for (const side of sides)
    for (const pdu of rack.pdus[side]) ctx.asm.link("power", pdu, `${block}-sw-${side}`);
}

/** Rack network: every device to the rack's top-of-rack switch, which goes up to the pod's spines. */
function wireNetwork(ctx: CampusCtx, pod: PodDraft, rack: RackDraft): void {
  if (rack.light) return;
  const tor = `${rack.id}-tor`;
  for (const device of rack.powered)
    if (device !== tor && !pod.spines.includes(device)) ctx.asm.link("network", device, tor);
  for (const spine of pod.spines) ctx.asm.link("network", tor, spine);
}

/** Where cooling comes from: the two nearest air handlers, and for liquid racks two CDUs in turn. */
function wireCooling(
  ctx: CampusCtx,
  rack: RackDraft,
  near: readonly string[],
  cdus: { readonly ids: readonly string[]; readonly turn: number },
): void {
  for (const unit of near.slice(0, 2)) ctx.asm.link("cooling", rack.id, unit);
  if (rack.liquidW <= 0 || cdus.ids.length === 0) return;
  for (let k = 0; k < Math.min(2, cdus.ids.length); k++)
    ctx.asm.link("cooling", rack.id, cdus.ids[(cdus.turn + k) % cdus.ids.length] as string);
}

/** Power, network and cooling links of a hall. */
function wireHall(
  ctx: CampusCtx,
  hall: HallDraft,
  parts: HallParts,
  rackX: ReadonlyMap<string, number>,
  crahAt: ReadonlyMap<string, { x: number; y: number }>,
): void {
  const sides = sidesOf(ctx.spec.powerRedundancy);
  const crahIds = [...crahAt.keys()];
  const crahX = (id: string) => crahAt.get(id)?.x ?? 0;
  let liquidRack = 0;
  for (const pod of hall.pods)
    for (const rack of pod.racks) {
      wirePower(ctx, hall, pod, rack);
      wireNetwork(ctx, pod, rack);
      const x = rackX.get(rack.id) ?? 0;
      const near = [...crahIds].sort((a, b) => Math.abs(crahX(a) - x) - Math.abs(crahX(b) - x));
      wireCooling(ctx, rack, near, { ids: parts.cdus, turn: liquidRack });
      if (rack.liquidW > 0) liquidRack++;
    }
  crahIds.forEach((id, i) => {
    const block = blockId(hall, 1 + (i % hall.blocks));
    ctx.asm.link("power", id, `${block}-sw-${sides[i % sides.length]}`);
  });
}
