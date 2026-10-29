/**
 * One generated rack (REQ-044, REQ-045): its model, the PDUs sized for what it holds, a top-of-rack
 * switch, and servers picked for how the rack is cooled. A rack at rest must be healthy: servers are
 * added only while their peak power stays within what the PDUs carry.
 */
import type { Catalog, ServerModel } from "@terrarium/core/catalog";
import { type SeededRng, slug } from "@terrarium/core/kernel";
import type { DeviceSpec } from "@terrarium/core/sources";
import type { LocationHint } from "@terrarium/core/spatial";
import { DLC_SERVERS, HEAVY_PDUS, TANK_SERVERS } from "./campus-families";
import type { PodPlan } from "./campus-plan";
import { type CampusCtx, type PodDraft, type RackDraft, SIZING_UTIL } from "./campus-types";

/** Share of a PDU's rating a rack may be planned for, and the watts kept for switches and overhead. */
const PDU_BUDGET = 0.8;
const OVERHEAD_W = 700;
/** How much of a rack's rated heat it is planned for, by kind. */
const DENSITY = { air: 0.85, rdhx: 0.5, dlc: 0.65, tank: 0.6 } as const;
/** Rear-door heat exchangers take this share of a rack's heat into the water (as in the physics). */
const RDHX_SHARE = 0.75;
const BMC_MIX: ReadonlyArray<readonly [string, number]> = [
  ["bmc-gen16/7.10", 0.6],
  ["bmc-gen14/4.40", 0.3],
  ["bmc-lite/2.80", 0.1],
];

export const sidesOf = (redundancy: "N" | "2N"): ReadonlyArray<"a" | "b"> =>
  redundancy === "2N" ? ["a", "b"] : ["a"];

const inUnit = (unit: number): LocationHint => ({ floorInfo: {}, unit, unitSpan: 1 });
const two = (n: number) => String(n).padStart(2, "0");
const lower = (text: string) => slug(text).toLowerCase();
const round2 = (v: number) => Math.round(v * 100) / 100;

function weighted<T>(rng: SeededRng, items: ReadonlyArray<readonly [T, number]>): T {
  let roll = rng.random() * items.reduce((s, [, w]) => s + w, 0);
  for (const [item, w] of items) {
    roll -= w;
    if (roll <= 0) return item;
  }
  return (items.at(-1) as readonly [T, number])[0];
}

export interface RackSlot {
  readonly id: string;
  readonly name: string;
  readonly row: 0 | 1;
  readonly col: number;
  /** Host-name prefix, e.g. "gh1-2a". */
  readonly host: string;
}

/** The PDU a rack of this kind uses, how many per side, and the peak the servers may add up to. */
function powerPlan(catalog: Catalog, pod: PodPlan, rackKw: number) {
  const model =
    pod.kind === "air" ? pod.family.pdu : pod.kind === "rdhx" ? HEAVY_PDUS[0] : HEAVY_PDUS[1];
  const capW = catalog.getOf(model, "pdu").capacityW;
  const wanted = Math.min(rackKw * 1000 * DENSITY[pod.kind], 1e9);
  const perSide = Math.max(1, Math.ceil((wanted + OVERHEAD_W) / (PDU_BUDGET * capW)));
  const peakW = Math.min(wanted, perSide * PDU_BUDGET * capW - OVERHEAD_W);
  return { model, perSide, peakW };
}

function serverPool(pod: PodPlan, rng: SeededRng, gpuShare: number): readonly string[] {
  if (pod.kind === "dlc") return DLC_SERVERS;
  if (pod.kind === "tank") return TANK_SERVERS;
  if (pod.kind === "rdhx") return rng.random() < 0.7 ? pod.family.gpuServers : pod.family.servers;
  return rng.random() < gpuShare ? pod.family.gpuServers : pod.family.servers;
}

interface Cursor {
  /** Next free unit counting up from the bottom. */
  bottom: number;
  /** Highest unit still free. */
  top: number;
}

function place(devices: DeviceSpec[], d: DeviceSpec): string {
  devices.push(d);
  return d.id;
}

/** Add the rack's PDUs (sides A and B) and return their ids. */
function addPdus(
  rack: RackDraft,
  plan: { model: string; perSide: number; redundancy: "N" | "2N" },
): void {
  for (const side of sidesOf(plan.redundancy))
    for (let i = 1; i <= plan.perSide; i++)
      rack.pdus[side].push(
        place(rack.devices, {
          id: `${rack.id}-pdu-${side}${i}`,
          kind: "pdu",
          name: `PDU-${rack.name}-${side.toUpperCase()}${i}`,
          modelId: plan.model,
          hint: inUnit(1),
          rackId: rack.id,
        }),
      );
}

function addSwitches(
  ctx: CampusCtx,
  rack: RackDraft,
  pod: PodDraft,
  cursor: Cursor,
  first: boolean,
): void {
  const height = (model: string) => ctx.catalog.getOf(model, "switch").uHeight;
  const family = pod.plan.family;
  const torH = height(family.tor);
  cursor.top -= torH;
  const tor = place(rack.devices, {
    id: `${rack.id}-tor`,
    kind: "switch",
    name: `tor-${lower(rack.name)}`,
    modelId: family.tor,
    hint: inUnit(cursor.top + 1),
    rackId: rack.id,
  });
  rack.powered.push(tor);
  rack.loadW += ctx.catalog.getOf(family.tor, "switch").powerW;
  rack.airW += ctx.catalog.getOf(family.tor, "switch").powerW;
  if (first) {
    for (const i of [1, 2]) {
      cursor.top -= height(family.spine);
      const id = place(rack.devices, {
        id: `${pod.id}-sp${i}`,
        kind: "switch",
        name: `spine-${lower(pod.name)}-${i}`,
        modelId: family.spine,
        hint: inUnit(cursor.top + 1),
        rackId: rack.id,
      });
      rack.powered.push(id);
      pod.spines.push(id);
      const w = ctx.catalog.getOf(family.spine, "switch").powerW;
      rack.loadW += w;
      rack.airW += w;
    }
  }
}

function addStorage(ctx: CampusCtx, rack: RackDraft, pod: PodDraft, cursor: Cursor): void {
  const model = ctx.catalog.getOf(pod.plan.family.storage, "storage");
  place(rack.devices, {
    id: `${rack.id}-stor`,
    kind: "storage",
    name: `stor-${lower(rack.name)}`,
    modelId: model.id,
    hint: inUnit(cursor.bottom),
    rackId: rack.id,
  });
  rack.powered.push(`${rack.id}-stor`);
  cursor.bottom += model.uHeight;
  rack.loadW += model.powerW;
  rack.airW += model.powerW;
}

/** How a server's expected load splits into air and liquid for the rack it stands in. */
function addLoad(rack: RackDraft, model: ServerModel): void {
  const w = model.idlePowerW + (model.maxPowerW - model.idlePowerW) * SIZING_UTIL;
  rack.loadW += w;
  rack.liquidW += w * model.liquidShare;
  rack.airW += w * (1 - model.liquidShare);
}

function addServers(
  ctx: CampusCtx,
  rng: SeededRng,
  rack: RackDraft,
  fill: { pod: PodDraft; slot: RackSlot; cursor: Cursor; peakW: number },
): void {
  const { pod, slot, cursor } = fill;
  const heavy = pod.plan.kind !== "air";
  let peak = 0;
  for (let n = 1; ; n++) {
    const modelId = rng.pick(serverPool(pod.plan, rng, ctx.spec.gpuShare));
    const model = ctx.catalog.getOf(modelId, "server");
    const usable = cursor.top - cursor.bottom + 1;
    const usedFraction = (cursor.bottom - 1) / Math.max(1, cursor.top);
    if (
      usedFraction >= ctx.spec.fill ||
      model.uHeight > usable ||
      peak + model.maxPowerW > fill.peakW
    )
      break;
    const id = place(rack.devices, {
      id: `${rack.id}-s${two(n)}`,
      kind: "server",
      name: `${slot.host}-${lower(slot.name).slice(-6)}-${two(n)}`,
      modelId,
      hint: inUnit(cursor.bottom),
      rackId: rack.id,
      props: {
        bmcProfile: weighted(rng, BMC_MIX),
        cpuUtil: round2(heavy ? rng.uniform(0.2, 0.5) : rng.uniform(0.1, 0.3)),
      },
    });
    rack.powered.push(id);
    cursor.bottom += model.uHeight;
    peak += model.maxPowerW;
    addLoad(rack, model);
  }
}

/** Fill one rack of a pod. The first rack of a pod's first row also holds the pod's spine pair. */
export function draftRack(
  ctx: CampusCtx,
  rng: SeededRng,
  pod: PodDraft,
  slot: RackSlot,
): RackDraft {
  const model = ctx.catalog.getOf(pod.plan.rackModel, "rack");
  const rack: RackDraft = {
    id: slot.id,
    name: slot.name,
    model: model.id,
    kind: pod.plan.kind,
    row: slot.row,
    col: slot.col,
    devices: [],
    powered: [],
    pdus: { a: [], b: [] },
    loadW: 0,
    airW: 0,
    liquidW: 0,
  };
  const power = powerPlan(ctx.catalog, pod.plan, model.maxKw);
  addPdus(rack, { ...power, redundancy: ctx.spec.powerRedundancy });
  const cursor: Cursor = { bottom: 1, top: model.uHeight };
  const first = slot.row === 0 && slot.col === 0;
  addSwitches(ctx, rack, pod, cursor, first);
  if (slot.row === 1 && slot.col === 0 && pod.plan.kind === "air")
    addStorage(ctx, rack, pod, cursor);
  addServers(ctx, rng, rack, { pod, slot, cursor, peakW: power.peakW });
  if (rack.kind === "rdhx") {
    rack.liquidW = RDHX_SHARE * rack.loadW;
    rack.airW = rack.loadW - rack.liquidW;
  }
  return rack;
}
