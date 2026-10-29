/**
 * One generated server room: rows of racks (an infra rack at the head of each row, compute racks
 * after it), A/B PDUs, a ToR per rack, a spine pair per room, CRAH units sized for the heat load,
 * A/B panels sized for the power, and optionally a vSphere cluster with VMs on the room's hosts.
 *
 * The room must be healthy at rest: racks are filled only within 80% of PDU capacity, cooling and
 * panels are sized for the expected load, and VM demand is capped so hosts idle below CPU_REST.
 */
import type { Catalog, ServerModel } from "@terrarium/core/catalog";
import { type SeededRng, slug } from "@terrarium/core/kernel";
import type {
  BlueprintAssembler,
  DeviceSpec,
  EquipmentSpec,
  RackSpec,
  RoomSpec,
} from "@terrarium/core/sources";
import type { LocationHint } from "@terrarium/core/spatial";
import type { WorldgenSpec } from "./spec";

const TOR_U = 42;
const SERVER_UNITS = 40;
const PDU_MODEL = "pdu-17kw";
const PDU_BUDGET = 0.8;
const COOLING_MODEL = "crah-100kw";
const PANEL_MODEL = "panel-400a";
/** Expected utilisation used to size cooling and panels. */
const SIZING_UTIL = 0.6;
/** Highest CPU utilisation a host should have at rest. */
const CPU_REST = 0.6;
const BMC_MIX: ReadonlyArray<readonly [string, number]> = [
  ["bmc-gen16/7.10", 0.6],
  ["bmc-gen14/4.40", 0.3],
  ["bmc-lite/2.80", 0.1],
];

export interface RoomContext {
  readonly asm: BlueprintAssembler;
  readonly catalog: Catalog;
  readonly rng: SeededRng;
  readonly spec: WorldgenSpec;
  readonly floorId: string;
  readonly roomId: string;
  readonly roomName: string;
  /** Host-name prefix, e.g. "gh1-3a". */
  readonly host: string;
  readonly ups: { readonly a: string; readonly b: string };
  readonly vcenter: string;
}

const at = (row: number, column: number): LocationHint => ({
  floorInfo: {},
  row,
  column,
  unitSpan: 1,
});
const inUnit = (unit: number): LocationHint => ({ floorInfo: {}, unit, unitSpan: 1 });
const two = (n: number) => String(n).padStart(2, "0");
/** Host-name style: ASCII, lower case. */
const lower = (text: string) => slug(text).toLowerCase();

function weighted<T>(rng: SeededRng, items: ReadonlyArray<readonly [T, number]>): T {
  let roll = rng.random() * items.reduce((s, [, w]) => s + w, 0);
  for (const [item, w] of items) {
    roll -= w;
    if (roll <= 0) return item;
  }
  return (items.at(-1) as readonly [T, number])[0];
}

interface Built {
  readonly racks: RackSpec[];
  readonly devices: DeviceSpec[];
  readonly hosts: string[];
  readonly arrays: string[];
  /** Expected room load in watts, for sizing. */
  loadW: number;
}

export function buildRoom(ctx: RoomContext): void {
  const built: Built = { racks: [], devices: [], hosts: [], arrays: [], loadW: 0 };
  const spines = [`${ctx.roomId}-spine1`, `${ctx.roomId}-spine2`];
  for (let row = 1; row <= ctx.spec.rows; row++)
    for (let col = 1; col <= ctx.spec.racksPerRow; col++) addRack(ctx, built, row, col, spines);
  const equipment = [...coolingUnits(ctx, built.loadW), ...panels(ctx, built.loadW)];
  const room: RoomSpec = {
    id: ctx.roomId,
    name: ctx.roomName,
    racks: built.racks,
    devices: built.devices,
    equipment,
    containment: ctx.spec.containment,
  };
  ctx.asm.room(ctx.floorId, room);
  for (const rack of built.racks)
    for (const unit of equipment.filter((e) => e.kind === "cooling_unit"))
      ctx.asm.link("cooling", rack.id, unit.id);
  if (ctx.spec.vmsPerHost > 0) virtualisation(ctx, built);
}

function addRack(ctx: RoomContext, built: Built, row: number, col: number, spines: string[]): void {
  const rackId = `${ctx.roomId}-r${two(row)}${two(col)}`;
  const label = `${ctx.roomName.split(" ")[0]}-${two(row)}${two(col)}`;
  built.racks.push({ id: rackId, name: label, hint: at(row, col) });
  const pdus = pduPair(ctx, built, rackId, label);
  const tor = device(built, {
    id: `${rackId}-tor`,
    kind: "switch",
    name: `tor-${lower(label)}`,
    modelId: "sw-tor-48x25g",
    hint: inUnit(TOR_U),
    rackId,
  });
  powerFrom(ctx, tor, pdus);
  built.loadW += 350;
  for (const spine of spines) ctx.asm.link("network", tor, spine);
  if (col === 1) infraRack(ctx, built, { id: rackId, row, pdus, tor }, spines);
  else computeRack(ctx, built, rackId, label, pdus, tor);
}

function device(built: Built, spec: DeviceSpec): string {
  built.devices.push(spec);
  return spec.id;
}

function powerFrom(ctx: RoomContext, id: string, pdus: readonly string[]): void {
  for (const pdu of pdus) ctx.asm.link("power", id, pdu);
}

function pduPair(ctx: RoomContext, built: Built, rackId: string, label: string): string[] {
  const sides = ctx.spec.powerRedundancy === "2N" ? ["a", "b"] : ["a"];
  return sides.map((side) => {
    const id = device(built, {
      id: `${rackId}-pdu-${side}`,
      kind: "pdu",
      name: `PDU-${label}-${side.toUpperCase()}`,
      modelId: PDU_MODEL,
      hint: inUnit(1),
      rackId,
    });
    ctx.asm.link("power", id, `${ctx.roomId}-pnl-${side}1`);
    return id;
  });
}

/** The head rack of a row: the room's spine pair (row 1) and one storage array (with virtualisation). */
/** A rack being filled: where it is in the room and what feeds and connects it. */
interface RackWiring {
  readonly id: string;
  readonly row: number;
  readonly pdus: readonly string[];
  readonly tor: string;
}

function infraRack(ctx: RoomContext, built: Built, rack: RackWiring, spines: string[]): void {
  const { id: rackId, row, pdus, tor } = rack;
  if (row === 1) {
    spines.forEach((id, i) => {
      device(built, {
        id,
        kind: "switch",
        name: `spine-${lower(ctx.roomName.split(" ")[0] ?? "")}-${i + 1}`,
        modelId: "sw-spine-32x100g",
        hint: inUnit(40 - i),
        rackId,
      });
      powerFrom(ctx, id, pdus);
      built.loadW += 600;
    });
  }
  if (ctx.spec.vmsPerHost === 0) return;
  const id = device(built, {
    id: `${rackId}-stor`,
    kind: "storage",
    name: `${ctx.host}-stor-${two(row)}`,
    modelId: "stor-2u-24bay",
    hint: inUnit(10),
    rackId,
  });
  powerFrom(ctx, id, pdus);
  ctx.asm.link("network", id, tor);
  built.arrays.push(id);
  built.loadW += 800;
}

function serverModel(ctx: RoomContext): string {
  if (ctx.rng.random() < ctx.spec.gpuShare) return "srv-4u-gpu";
  return ctx.rng.random() < 0.5 ? "srv-1u-compute" : "srv-2u-compute";
}

function computeRack(
  ctx: RoomContext,
  built: Built,
  rackId: string,
  label: string,
  pdus: string[],
  tor: string,
): void {
  const budget = PDU_BUDGET * (ctx.catalog.getOf(PDU_MODEL, "pdu").capacityW - 350);
  let unit = 1;
  let peak = 0;
  for (let n = 1; unit <= SERVER_UNITS * ctx.spec.fill; n++) {
    const modelId = serverModel(ctx);
    const model = ctx.catalog.getOf(modelId, "server");
    if (peak + model.maxPowerW > budget || unit + model.uHeight - 1 > SERVER_UNITS) break;
    const id = device(built, {
      id: `${rackId}-s${two(n)}`,
      kind: "server",
      name: `${ctx.host}-${lower(label).slice(-4)}-${two(n)}`,
      modelId,
      hint: inUnit(unit),
      rackId,
      props: { bmcProfile: weighted(ctx.rng, BMC_MIX), cpuUtil: round2(ctx.rng.uniform(0.1, 0.3)) },
    });
    powerFrom(ctx, id, pdus);
    ctx.asm.link("network", id, tor);
    if (modelId !== "srv-4u-gpu") built.hosts.push(id);
    peak += model.maxPowerW;
    built.loadW += model.idlePowerW + (model.maxPowerW - model.idlePowerW) * SIZING_UTIL;
    unit += model.uHeight;
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function coolingUnits(ctx: RoomContext, loadW: number): EquipmentSpec[] {
  const capacityW = ctx.catalog.getOf(COOLING_MODEL, "cooling_unit").capacityKw * 1000;
  const needed = Math.max(1, Math.ceil(loadW / (0.8 * capacityW)));
  const count = { N: needed, "N+1": needed + 1, "2N": needed * 2 }[ctx.spec.coolingRedundancy];
  const tag = ctx.roomName.split(" ")[0];
  return Array.from({ length: count }, (_, i) => {
    const id = `${ctx.roomId}-crah${i + 1}`;
    ctx.asm.link(
      "power",
      id,
      `${ctx.roomId}-pnl-${ctx.spec.powerRedundancy === "2N" && i % 2 === 1 ? "b" : "a"}1`,
    );
    return {
      id,
      kind: "cooling_unit" as const,
      name: `CRAH-${tag}-${i + 1}`,
      modelId: COOLING_MODEL,
    };
  });
}

/** One panel per side (A, and B with 2N), each able to carry the whole room. */
function panels(ctx: RoomContext, loadW: number): EquipmentSpec[] {
  const sides = ctx.spec.powerRedundancy === "2N" ? (["a", "b"] as const) : (["a"] as const);
  const tag = ctx.roomName.split(" ")[0];
  return sides.map((side) => {
    const id = `${ctx.roomId}-pnl-${side}1`;
    ctx.asm.link("power", id, ctx.ups[side]);
    return {
      id,
      kind: "power_panel" as const,
      name: `PNL-${tag}-${side.toUpperCase()}`,
      modelId: PANEL_MODEL,
      props: { designLoadKw: Math.round(loadW / 1000) },
    };
  });
}

/** A cluster of the room's hosts, VMs sized so hosts stay below CPU_REST, datastores on the arrays. */
function virtualisation(ctx: RoomContext, built: Built): void {
  if (built.hosts.length === 0) return;
  const cluster = `${ctx.roomId}-cl`;
  ctx.asm
    .virtual(cluster, "cluster", `CL-${ctx.roomName.split(" ")[0]}`)
    .link("managed_by", cluster, ctx.vcenter);
  const stores = built.arrays.map((array) => {
    const id = `${array}-ds`;
    ctx.asm.virtual(id, "datastore", `ds-${lower(array).slice(-12)}`).link("backed_by", id, array);
    return id;
  });
  for (const host of built.hosts) {
    ctx.asm.link("member_of", host, cluster);
    vmsOn(ctx, built, host, stores);
  }
}

function vmsOn(ctx: RoomContext, built: Built, host: string, stores: string[]): void {
  const spec = built.devices.find((d) => d.id === host) as DeviceSpec;
  const model = ctx.catalog.getOf(spec.modelId, "server") as ServerModel;
  const cores = model.cpuSockets * model.coresPerSocket;
  const base = Number(spec.props?.cpuUtil ?? 0.3);
  const vms = Array.from({ length: ctx.spec.vmsPerHost }, () => ({
    vcpus: ctx.rng.pick([2, 4, 8, 16]),
    demand: ctx.rng.uniform(0.1, 0.6),
  }));
  const asked = vms.reduce((s, v) => s + v.vcpus * v.demand, 0) / cores;
  const scale = asked > CPU_REST - base ? Math.max(0, CPU_REST - base) / asked : 1;
  vms.forEach((vm, i) => {
    const id = `${host}-vm${two(i + 1)}`;
    ctx.asm
      .virtual(id, "vm", `vm-${lower(spec.name)}-${two(i + 1)}`, {
        cpuCount: vm.vcpus,
        memoryGiB: vm.vcpus * 4,
        cpuDemand: round2(vm.demand * scale),
      })
      .link("runs_on", id, host);
    if (stores.length > 0) ctx.asm.link("stored_on", id, ctx.rng.pick(stores));
  });
}
