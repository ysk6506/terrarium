/**
 * Filling a server room (REQ-043, REQ-047): how many racks fit, where the cooling, panels and UPS go and how big
 * they must be, as plain numbers. Rows of racks stand in pairs round an aisle, pair after pair down the room, and
 * the equipment stands along the far wall. Nothing here touches a blueprint (see fill.ts for that).
 */
import type { Catalog } from "@terrarium/core/catalog";
import { RACK_DEPTH_M, RACK_UNITS_DEFAULT, RACK_WIDTH_M } from "@terrarium/core/kernel";
import type { Rotation } from "@terrarium/core/spatial";
import { EditError } from "./edit";

export type FillLoad = "empty" | "half" | "full";
export type FillAisle = "none" | "cold" | "hot";

export interface FillOptions {
  /** How much goes in the racks: nothing, about a third of what a rack's PDUs can carry, or most of it. */
  readonly load: FillLoad;
  /** Whether the aisle between each pair of rows is sealed, and on which side. */
  readonly aisle: FillAisle;
}

export const FILL_LOADS: ReadonlyArray<{ readonly value: FillLoad; readonly label: string }> = [
  { value: "empty", label: "빈 랙만" },
  { value: "half", label: "서버 절반쯤" },
  { value: "full", label: "서버 가득" },
];

export const FILL_AISLES: ReadonlyArray<{ readonly value: FillAisle; readonly label: string }> = [
  { value: "none", label: "컨테인먼트 없이" },
  { value: "cold", label: "냉복도 컨테인먼트" },
  { value: "hot", label: "열복도 컨테인먼트" },
];

/** The models a filled room is made of. */
export const FILL_MODELS = {
  server: "hc-r1u-gen6",
  tor: "sw-tor-48x25g",
  pdu: "pdu-17kw",
  cooling: "crah-100kw",
  panel: "panel-400a",
  ups: ["ups-200kva", "ups-500kva", "dp-ups-1200kva"],
} as const;

const EDGE_M = 1.2;
const INNER_AISLE_M = 1.2;
const SERVICE_AISLE_M = 1.2;
const MAX_PER_ROW = 20;
const MAX_PODS = 12;
const POD_DEPTH_M = 2 * RACK_DEPTH_M + INNER_AISLE_M;
const POD_PITCH_M = POD_DEPTH_M + SERVICE_AISLE_M;
const UNIT_GAP_M = 0.6;
/** Standing room for a cooling unit (0.9 m deep) and the way past it. */
const COOLING_ROW_M = 1.8;
const PANEL_PITCH_M = 1.2;
/** Design load of a rack that has no servers yet, W. */
const EMPTY_RACK_DESIGN_W = 5000;
/** A panel of 400 A at 380 V carries about this much, kW; panels are added to keep each well under it. */
const PANEL_KW = 180;
const HEADROOM = 1.25;
/** How much of what a rack's PDUs can carry the servers may ask for at full load, and at half. */
const LOAD_SHARE: Readonly<Record<Exclude<FillLoad, "empty">, number>> = { half: 0.35, full: 0.8 };
/** Servers run at about this much of their range on average (the same figure the physics uses to size cooling). */
const TYPICAL_UTIL = 0.6;

export interface At {
  readonly x: number;
  readonly y: number;
  readonly rotation: Rotation;
}

export interface PodPlan {
  /** The corner of the pod (its two rows and the aisle between), room frame. */
  readonly x: number;
  readonly y: number;
  readonly perRow: number;
}

export interface RoomPlan {
  readonly pods: readonly PodPlan[];
  readonly racks: number;
  readonly serversPerRack: number;
  /** Heat the servers give off, W. */
  readonly heatW: number;
  readonly cooling: readonly At[];
  readonly upsModel: string;
  readonly upsA: readonly At[];
  readonly upsB: readonly At[];
  readonly panelsA: readonly At[];
  readonly panelsB: readonly At[];
}

const down = (n: number, step: number) => Math.floor(n / step + 1e-9) * step;
const mm = (n: number) => Math.round(n * 1000) / 1000;

/** Which way a row faces: toward the aisle between the rows, except in a hot-sealed pod, where backs face it. */
export function facing(aisle: FillAisle, row: 0 | 1): Rotation {
  const toward: Rotation = row === 0 ? 0 : 180;
  if (aisle !== "hot") return toward;
  return toward === 0 ? 180 : 0;
}

function serverW(catalog: Catalog): { idle: number; max: number } {
  const m = catalog.get(FILL_MODELS.server);
  if (!("maxPowerW" in m)) throw new EditError("서버 모델을 찾을 수 없어요");
  return { idle: m.idlePowerW, max: m.maxPowerW };
}

function pduW(catalog: Catalog): number {
  const m = catalog.get(FILL_MODELS.pdu);
  return "capacityW" in m ? m.capacityW : 0;
}

/** Servers in each rack, and the heat a rack gives off. */
export function rackLoad(
  catalog: Catalog,
  load: FillLoad,
): { servers: number; heatW: number; units: number } {
  const units = RACK_UNITS_DEFAULT;
  if (load === "empty") return { servers: 0, heatW: EMPTY_RACK_DESIGN_W, units };
  const server = serverW(catalog);
  const servers = Math.max(
    1,
    Math.min(units - 1, Math.floor((LOAD_SHARE[load] * pduW(catalog)) / server.max)),
  );
  const tor = catalog.get(FILL_MODELS.tor);
  const torW = "powerW" in tor ? tor.powerW : 0;
  const each = server.idle + TYPICAL_UTIL * (server.max - server.idle);
  return { servers, heatW: servers * each + torW, units };
}

const MAX_UPS_PER_SIDE = 3;

/** The UPS for one side: the smallest model that carries `needKw`, or several of the largest. */
function upsFor(
  catalog: Catalog,
  needKw: number,
): { id: string; w: number; d: number; count: number } | undefined {
  const models = FILL_MODELS.ups.map((id) => catalog.get(id));
  for (const m of models)
    if ("capacityKw" in m && m.capacityKw >= needKw && "footprint" in m)
      return { id: m.id, w: m.footprint.w, d: m.footprint.d, count: 1 };
  const biggest = models.at(-1);
  if (!biggest || !("capacityKw" in biggest) || !("footprint" in biggest)) return undefined;
  const count = Math.ceil(needKw / biggest.capacityKw);
  if (count > MAX_UPS_PER_SIDE) return undefined;
  return { id: biggest.id, w: biggest.footprint.w, d: biggest.footprint.d, count };
}

interface Sized {
  readonly racks: number;
  readonly serversPerRack: number;
  readonly heatW: number;
  readonly coolingUnits: number;
  readonly ups: { id: string; w: number; d: number; count: number };
  readonly panelsPerSide: number;
}

function size(catalog: Catalog, racks: number, load: FillLoad): Sized | undefined {
  const one = rackLoad(catalog, load);
  const heatW = racks * one.heatW;
  const ups = upsFor(catalog, (heatW * HEADROOM) / 1000);
  if (!ups) return undefined;
  const cooling = catalog.get(FILL_MODELS.cooling);
  const unitKw = "capacityKw" in cooling ? cooling.capacityKw : 100;
  return {
    racks,
    serversPerRack: one.servers,
    heatW,
    coolingUnits: Math.ceil((heatW * HEADROOM) / 1000 / unitKw) + 1,
    ups,
    panelsPerSide: Math.max(1, Math.ceil(heatW / 1000 / PANEL_KW)),
  };
}

/** The smallest room (width, depth in metres) that can be filled at all. */
export const MIN_FILL_M = { w: 14.4, d: 10.8 } as const;

/** Where the equipment stands, given the sizes, along the far wall: cooling in rows against it, power in front. */
function equipment(
  w: number,
  d: number,
  s: Sized,
): Omit<RoomPlan, "pods" | "racks" | "serversPerRack" | "heatW"> | undefined {
  const upsPitch = Math.ceil(s.ups.w / 0.6 - 1e-9) * 0.6;
  const perCoolingRow = Math.floor((w - 2 * EDGE_M + UNIT_GAP_M) / 3.0);
  const side = upsPitch * s.ups.count + UNIT_GAP_M + PANEL_PITCH_M * s.panelsPerSide;
  if (perCoolingRow < 1 || 2 * (EDGE_M + side) > w) return undefined;
  const cooling: At[] = [];
  for (let i = 0; i < s.coolingUnits; i++) {
    const row = Math.floor(i / perCoolingRow);
    cooling.push({
      x: mm(EDGE_M + (i % perCoolingRow) * 3.0),
      y: mm(d - COOLING_ROW_M * (row + 1)),
      rotation: 0,
    });
  }
  const rows = Math.ceil(s.coolingUnits / perCoolingRow);
  const y = mm(d - COOLING_ROW_M * rows - 2.4);
  const west = (offset: number): At => ({ x: mm(EDGE_M + offset), y, rotation: 0 });
  const east = (offset: number, width: number): At => ({
    x: mm(w - EDGE_M - offset - width),
    y,
    rotation: 0,
  });
  return {
    cooling,
    upsModel: s.ups.id,
    upsA: Array.from({ length: s.ups.count }, (_, i) => west(i * upsPitch)),
    upsB: Array.from({ length: s.ups.count }, (_, i) => east(i * upsPitch, s.ups.w)),
    panelsA: Array.from({ length: s.panelsPerSide }, (_, i) =>
      west(upsPitch * s.ups.count + UNIT_GAP_M + i * PANEL_PITCH_M),
    ),
    panelsB: Array.from({ length: s.panelsPerSide }, (_, i) =>
      east(upsPitch * s.ups.count + UNIT_GAP_M + i * PANEL_PITCH_M, 1),
    ),
  };
}

/** Free depth for racks once the equipment is in, for a room `d` deep with `coolingUnits` cooling units. */
function rackDepth(d: number, w: number, coolingUnits: number): number {
  const perRow = Math.max(1, Math.floor((w - 2 * EDGE_M + UNIT_GAP_M) / 3.0));
  const rows = Math.ceil(coolingUnits / perRow);
  return d - COOLING_ROW_M * rows - 2.4 - EDGE_M - EDGE_M;
}

function tooSmall(): EditError {
  return new EditError(
    `서버룸이 너무 작아요. 가로 ${MIN_FILL_M.w} m, 세로 ${MIN_FILL_M.d} m 이상이어야 채울 수 있어요`,
  );
}

interface Candidate {
  readonly pods: number;
  readonly perRow: number;
  readonly sized: Sized;
  readonly placed: NonNullable<ReturnType<typeof equipment>>;
}

/** Whether `pods` pairs of rows of `perRow` racks fit a room `w` × `d`, with the equipment they need. */
function tryLayout(
  catalog: Catalog,
  w: number,
  d: number,
  load: FillLoad,
  pods: number,
  perRow: number,
): Candidate | undefined {
  const sized = size(catalog, pods * 2 * perRow, load);
  if (!sized) return undefined;
  if (pods * POD_PITCH_M - SERVICE_AISLE_M > rackDepth(d, w, sized.coolingUnits)) return undefined;
  const placed = equipment(w, d, sized);
  return placed ? { pods, perRow, sized, placed } : undefined;
}

/** Lay out a room `w` × `d` metres: the most racks that fit at full load, so the racks stand the same whatever goes in them. */
export function planRoom(catalog: Catalog, w: number, d: number, load: FillLoad): RoomPlan {
  const widest = Math.min(MAX_PER_ROW, Math.floor((w - 2 * EDGE_M) / RACK_WIDTH_M + 1e-9));
  if (widest < 4 || w < MIN_FILL_M.w || d < MIN_FILL_M.d) throw tooSmall();
  let best: Candidate | undefined;
  for (let perRow = widest; perRow >= 4; perRow--)
    for (let pods = MAX_PODS; pods >= 1; pods--) {
      const found = tryLayout(catalog, w, d, "full", pods, perRow);
      if (found && (!best || found.sized.racks > best.sized.racks)) best = found;
    }
  if (!best) throw tooSmall();
  const sized = size(catalog, best.sized.racks, load) as Sized;
  const placed = equipment(w, d, sized) as NonNullable<ReturnType<typeof equipment>>;
  const x0 = mm(down((w - best.perRow * RACK_WIDTH_M) / 2, RACK_WIDTH_M));
  return {
    pods: Array.from({ length: best.pods }, (_, k) => ({
      x: x0,
      y: mm(EDGE_M + k * POD_PITCH_M),
      perRow: best.perRow,
    })),
    racks: sized.racks,
    serversPerRack: sized.serversPerRack,
    heatW: sized.heatW,
    ...placed,
  };
}
