/**
 * One generated server room: rows of racks (an infra rack at the head of each row, compute racks
 * after it), A/B PDUs, a ToR per rack, a spine pair per room, CRAH units sized for the heat load,
 * A/B panels sized for the power, and optionally a vSphere cluster with VMs on the room's hosts.
 *
 * The room must be healthy at rest: racks are filled only within 80% of PDU capacity, cooling and
 * panels are sized for the expected load, and VM demand is capped so hosts idle below CPU_REST.
 */
import { type Catalog, panelCapacityW, type ServerModel } from "@terrarium/core/catalog";
import { type SeededRng, slug } from "@terrarium/core/kernel";
import type {
  BlueprintAssembler,
  DeviceSpec,
  EquipmentSpec,
  RackSpec,
  RoomSpec,
} from "@terrarium/core/sources";
import type { LocationHint } from "@terrarium/core/spatial";
import { DENSE_BUDGET, type DenseSpec } from "./dense";
import { fitServer } from "./rack-fit";
import type { WorldgenSpec } from "./spec";

const TOR_U = 42;
const SERVER_UNITS = 40;
const PDU_MODEL = "pdu-17kw";
const PDU_BUDGET = 0.8;
const COOLING_MODEL = "crah-100kw";
const PANEL_MODEL = "panel-400a";
/** Expected utilisation used to size cooling and panels. */
const SIZING_UTIL = 0.6;
/** A panel or UPS is sized so that the expected load takes at most this much of it (the rest is margin for failover). */
export const POWER_HEADROOM = 0.8;
type Side = "a" | "b";

/** How many units of `capacityW` carry `loadW` within the headroom (at least one). */
export const unitsFor = (loadW: number, capacityW: number): number =>
  Math.max(1, Math.ceil(loadW / (POWER_HEADROOM * capacityW)));
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
  readonly vcenter: string;
  /** The dense racks this room holds (the first room of the world only). */
  readonly dense?: DenseSpec;
  /** Plain compute racks this room holds, when the world counts them (REQ-111); absent: every place of a row. */
  readonly computeRacks?: number;
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
  /** Each rack PDU and the side it hangs on; they are wired to panels once the panels are counted. */
  readonly feeds: Array<{ readonly pdu: string; readonly side: Side; readonly rack: number }>;
  /** Heat the liquid loop carries off, W (the rooms's air is sized for the rest). */
  liquidW: number;
  /** The dense racks, which a CDU or a plant is wired to. */
  readonly dense: string[];
  /** Per place `row:col`: a dense rack stands there, or the place is left empty beside one (a dense rack is wider). */
  readonly slots: ReadonlyMap<string, "dense" | "shadow">;
  plain: number; // plain compute racks made so far
}

/** What a built room asks of the electrical room: its load and its panels, by side. */
export interface RoomPower {
  readonly loadW: number;
  readonly panels: Readonly<Record<Side, readonly string[]>>;
  /** The CDUs the room's liquid racks hang on, and the heat they carry, kW (REQ-107). */
  readonly cdus: readonly string[];
  readonly liquidKw: number;
}

export function buildRoom(ctx: RoomContext): RoomPower {
  const built: Built = {
    racks: [],
    devices: [],
    hosts: [],
    arrays: [],
    loadW: 0,
    feeds: [],
    liquidW: 0,
    dense: [],
    slots: denseSlots(ctx),
    plain: 0,
  };
  const spines = [`${ctx.roomId}-spine1`, `${ctx.roomId}-spine2`];
  for (let row = 1; row <= ctx.spec.rows; row++)
    for (let col = 1; col <= ctx.spec.racksPerRow; col++) addRack(ctx, built, row, col, spines);
  const cooling = coolingUnits(ctx, built.loadW - built.liquidW);
  const cdus = cduUnits(ctx, built);
  const loadW = built.loadW + cooling.length * fanPowerW(ctx) + cdus.length * CDU_W;
  const perSide = unitsFor(loadW, panelCapacityW(ctx.catalog.getOf(PANEL_MODEL, "power_panel")));
  const panelSpecs = panels(ctx, built.loadW, perSide);
  const equipment = [...cooling, ...cdus, ...panelSpecs];
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
    for (const unit of cooling) ctx.asm.link("cooling", rack.id, unit.id);
  for (const rack of built.dense) for (const unit of cdus) ctx.asm.link("cooling", rack, unit.id);
  wirePanels(ctx, built, [...cooling, ...cdus], perSide);
  if (ctx.spec.vmsPerHost > 0) virtualisation(ctx, built);
  return {
    loadW,
    panels: panelsBySide(ctx, perSide),
    cdus: cdus.map((u) => u.id),
    liquidKw: built.liquidW / 1000,
  };
}

const sidesOf = (ctx: RoomContext): readonly Side[] =>
  ctx.spec.powerRedundancy === "2N" ? ["a", "b"] : ["a"];
const panelId = (ctx: RoomContext, side: Side, n: number): string =>
  `${ctx.roomId}-pnl-${side}${n}`;
const fanPowerW = (ctx: RoomContext): number =>
  ctx.catalog.getOf(COOLING_MODEL, "cooling_unit").fanPowerW;

function panelsBySide(ctx: RoomContext, perSide: number): Record<Side, readonly string[]> {
  const ids = (side: Side) => Array.from({ length: perSide }, (_, i) => panelId(ctx, side, i + 1));
  return { a: ids("a"), b: sidesOf(ctx).includes("b") ? ids("b") : [] };
}

/** Hang every rack PDU and cooling unit on a panel of its side, spreading them evenly over the panels. */
function wirePanels(
  ctx: RoomContext,
  built: Built,
  cooling: readonly EquipmentSpec[],
  perSide: number,
): void {
  for (const f of built.feeds)
    ctx.asm.link("power", f.pdu, panelId(ctx, f.side, (f.rack % perSide) + 1));
  const sides = sidesOf(ctx);
  cooling.forEach((unit, i) => {
    const side = sides[i % sides.length] as Side;
    ctx.asm.link(
      "power",
      unit.id,
      panelId(ctx, side, (Math.floor(i / sides.length) % perSide) + 1),
    );
  });
}

/** A world that counts its racks leaves the places beyond the count empty (REQ-111). */
function beyondCount(ctx: RoomContext, built: Built, col: number, dense?: DenseSpec): boolean {
  if (col === 1 || dense) return false;
  if (ctx.computeRacks !== undefined && built.plain >= ctx.computeRacks) return true;
  built.plain += 1;
  return false;
}

/** A dense rack's model and props; the head of a row is marked infra (network and storage, no servers). */
function rackExtras(ctx: RoomContext, col: number, dense?: DenseSpec) {
  if (dense) return { modelId: dense.rack, props: denseProps(ctx, dense) };
  return col === 1 ? { props: { infra: true } } : {};
}

function addRack(ctx: RoomContext, built: Built, row: number, col: number, spines: string[]): void {
  const rackId = `${ctx.roomId}-r${two(row)}${two(col)}`;
  const label = `${ctx.roomName.split(" ")[0]}-${two(row)}${two(col)}`;
  const role = built.slots.get(`${row}:${col}`);
  if (role === "shadow") return;
  const dense = role === "dense" ? ctx.dense : undefined;
  if (beyondCount(ctx, built, col, dense)) return;
  built.racks.push({ id: rackId, name: label, hint: at(row, col), ...rackExtras(ctx, col, dense) });
  if (dense) built.dense.push(rackId);
  const pdus = pduPair(ctx, built, rackId, label, dense?.pdu ?? PDU_MODEL);
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
  else if (dense) denseRack(ctx, built, { id: rackId, label, pdus, tor }, dense);
  else computeRack(ctx, built, rackId, label, pdus, tor);
}

function device(built: Built, spec: DeviceSpec): string {
  built.devices.push(spec);
  return spec.id;
}

function powerFrom(ctx: RoomContext, id: string, pdus: readonly string[]): void {
  for (const pdu of pdus) ctx.asm.link("power", id, pdu);
}

function pduPair(
  ctx: RoomContext,
  built: Built,
  rackId: string,
  label: string,
  modelId: string,
): string[] {
  return sidesOf(ctx).map((side) => {
    const id = device(built, {
      id: `${rackId}-pdu-${side}`,
      kind: "pdu",
      name: `PDU-${label}-${side.toUpperCase()}`,
      modelId,
      hint: inUnit(1),
      rackId,
    });
    built.feeds.push({ pdu: id, side, rack: built.racks.length - 1 });
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
  const exact = ctx.spec.serversPerRack;
  for (let n = 1; exact === undefined ? unit <= SERVER_UNITS * ctx.spec.fill : n <= exact; n++) {
    const fit = exact === undefined ? undefined : { left: exact - n, unit, peak, budget };
    const modelId = fitServer(ctx.catalog, serverModel(ctx), fit);
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
    if (model.gpus === 0) built.hosts.push(id);
    peak += model.maxPowerW;
    built.loadW += model.idlePowerW + (model.maxPowerW - model.idlePowerW) * SIZING_UTIL;
    unit += model.uHeight;
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100;

// ── dense racks (REQ-107) ──────────────────────────────────────────────────

/** Power one CDU draws with its pumps running, W. */
const CDU_W = 12_000;
const CDU_MODEL = "aq-cdu-500kw";
const CDU_SHARE = 0.6;
const RDHX_SHARE = 0.75;

/**
 * Where the dense racks stand: from the far end of the room, a dense rack takes two places of a row (it is wider than a
 * standard rack, so the place beside it stays empty).
 */
function denseSlots(ctx: RoomContext): ReadonlyMap<string, "dense" | "shadow"> {
  const slots = new Map<string, "dense" | "shadow">();
  let left = ctx.dense?.racks ?? 0;
  for (let row = ctx.spec.rows; row >= 1 && left > 0; row--)
    for (let col = ctx.spec.racksPerRow - 1; col >= 2 && left > 0; col -= 2) {
      slots.set(`${row}:${col}`, "dense");
      slots.set(`${row}:${col + 1}`, "shadow");
      left--;
    }
  return slots;
}

/** Share of the servers' nameplate a dense rack is allotted: GPU racks are provisioned under it, as real ones are. */
const ALLOTTED = 0.8;

/** A liquid rack that has a leak sensor cuts its servers when it senses a leak; a dense rack has the power it is allotted. */
function denseProps(ctx: RoomContext, dense: DenseSpec): Record<string, string | number> {
  const peakW = dense.server
    ? dense.perRack * ctx.catalog.getOf(dense.server, "server").maxPowerW
    : 0;
  return {
    ...(dense.liquid === "dlc" || dense.liquid === "immersion" ? { leakPolicy: "poweroff" } : {}),
    ...(dense.gpu && peakW > 0 ? { powerLimitW: Math.round((ALLOTTED * peakW) / 100) * 100 } : {}),
  };
}

function denseRack(
  ctx: RoomContext,
  built: Built,
  rack: {
    readonly id: string;
    readonly label: string;
    readonly pdus: string[];
    readonly tor: string;
  },
  dense: DenseSpec,
): void {
  const budget = DENSE_BUDGET * (ctx.catalog.getOf(dense.pdu, "pdu").capacityW - 350);
  let unit = 1;
  let peak = 0;
  for (let n = 1; n <= dense.perRack; n++) {
    const modelId = dense.server ?? serverModel(ctx);
    const model = ctx.catalog.getOf(modelId, "server");
    if (peak + model.maxPowerW > budget || unit + model.uHeight - 1 > SERVER_UNITS) break;
    const id = device(built, {
      id: `${rack.id}-s${two(n)}`,
      kind: "server",
      name: `${ctx.host}-${lower(rack.label).slice(-4)}-${two(n)}`,
      modelId,
      hint: inUnit(unit),
      rackId: rack.id,
      props: { bmcProfile: weighted(ctx.rng, BMC_MIX), cpuUtil: round2(ctx.rng.uniform(0.1, 0.3)) },
    });
    powerFrom(ctx, id, rack.pdus);
    ctx.asm.link("network", id, rack.tor);
    if (model.gpus === 0) built.hosts.push(id);
    peak += model.maxPowerW;
    const watts = model.idlePowerW + (model.maxPowerW - model.idlePowerW) * SIZING_UTIL;
    built.loadW += watts;
    built.liquidW += watts * liquidShareOf(dense, model.liquidShare);
    unit += model.uHeight;
  }
}

/** Share of a server's heat the loop takes: the rear door takes its share of any server's, the plates and the bath their own. */
const liquidShareOf = (dense: DenseSpec, serverShare: number): number =>
  dense.liquid === "rdhx" ? RDHX_SHARE : dense.liquid ? serverShare : 0;

/** CDUs for the liquid racks of the room: planned for 60 % of their capacity, one more than the load needs (at least two). */
function cduUnits(ctx: RoomContext, built: Built): EquipmentSpec[] {
  if (built.dense.length === 0 || !ctx.dense?.liquid) return [];
  const cap = ctx.catalog.getOf(CDU_MODEL, "cdu").capacityKw;
  const count = Math.max(2, Math.ceil(built.liquidW / 1000 / (CDU_SHARE * cap)) + 1);
  const tag = ctx.roomName.split(" ")[0];
  return Array.from({ length: count }, (_, i) => ({
    id: `${ctx.roomId}-cdu${i + 1}`,
    kind: "cdu" as const,
    name: `CDU-${tag}-${i + 1}`,
    modelId: CDU_MODEL,
    ...(ctx.dense?.manualStandby ? { props: { manualStandby: true } } : {}),
  }));
}

function coolingUnits(ctx: RoomContext, loadW: number): EquipmentSpec[] {
  const capacityW = ctx.catalog.getOf(COOLING_MODEL, "cooling_unit").capacityKw * 1000;
  const needed = Math.max(1, Math.ceil(loadW / (0.8 * capacityW)));
  const count = { N: needed, "N+1": needed + 1, "2N": needed * 2 }[ctx.spec.coolingRedundancy];
  const tag = ctx.roomName.split(" ")[0];
  return Array.from({ length: count }, (_, i) => ({
    id: `${ctx.roomId}-crah${i + 1}`,
    kind: "cooling_unit" as const,
    name: `CRAH-${tag}-${i + 1}`,
    modelId: COOLING_MODEL,
  }));
}

/** Panels on each side, enough that each side alone could carry the whole room (with the headroom). */
function panels(ctx: RoomContext, loadW: number, perSide: number): EquipmentSpec[] {
  const tag = ctx.roomName.split(" ")[0];
  return sidesOf(ctx).flatMap((side) =>
    Array.from({ length: perSide }, (_, i) => ({
      id: panelId(ctx, side, i + 1),
      kind: "power_panel" as const,
      name: `PNL-${tag}-${side.toUpperCase()}${perSide > 1 ? i + 1 : ""}`,
      modelId: PANEL_MODEL,
      props: { designLoadKw: Math.round(loadW / perSide / 1000) },
    })),
  );
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
