/**
 * Liquid-cooled racks (REQ-044): rear-door heat exchangers, direct-to-chip racks and immersion tanks.
 * What reaches the liquid loop leaves the room's air budget; when the loop is lost the heat falls back
 * on the air (or, in a tank, on the fluid, which warms slowly because it holds a lot of heat).
 */
import type { RackCooling } from "@terrarium/core/catalog";
import { approach, clamp } from "@terrarium/core/kernel";
import { bulkOf, type Entity, type World } from "@terrarium/core/world";
import { leakIsolated } from "./plant";

/** Share of a rack's heat a working rear door takes out of the exhaust air. */
export const RDHX_SHARE = 0.75;
const FLUID_J_PER_L_K = 1600;
/** Heat capacity of the hardware itself in a tank, J/K per server. */
const SERVER_J_PER_K = 6000;
/** Tank bath temperature rise over the coolant at full design load, K. */
const TANK_DELTA_K = 12;
/** Passive loss from a tank to the room, W per K above room temperature. */
export const TANK_SURFACE_W_PER_K = 40;
const FLUID_MAX_C = 95;

export const rackCooling = (world: World, rack: Entity): RackCooling => {
  if (!rack.modelId || !world.catalog.has(rack.modelId)) return "air";
  const model = world.catalog.get(rack.modelId);
  return model.kind === "rack" ? model.cooling : "air";
};

export interface LiquidSupply {
  readonly ok: boolean;
  readonly supplyC: number;
}

/** Coolant a rack gets: from its running CDUs (rear doors may also hang straight on a plant). */
export function liquidSupply(world: World, rack: Entity, cooling: RackCooling): LiquidSupply {
  if (leakIsolated(world, rack.id)) return { ok: false, supplyC: 0 };
  const temps: number[] = [];
  for (const link of world.index.outgoing(rack.id, "cooling")) {
    const source = world.index.entity(link.to);
    if (source.kind === "cdu" && world.stateAs(source.id, "cdu").running)
      temps.push(world.stateAs(source.id, "cdu").supplyC);
    else if (
      source.kind === "chiller" &&
      cooling === "rdhx" &&
      world.stateAs(source.id, "chiller").running
    )
      temps.push(world.stateAs(source.id, "chiller").supplyC);
  }
  if (temps.length === 0) return { ok: false, supplyC: 0 };
  return { ok: true, supplyC: temps.reduce((a, b) => a + b, 0) / temps.length };
}

export interface RackLiquid {
  readonly cooling: RackCooling;
  readonly ok: boolean;
  readonly liquidW: number;
  readonly coolantC: number;
  readonly bathC: number;
}

export const AIR_ONLY: RackLiquid = {
  cooling: "air",
  ok: false,
  liquidW: 0,
  coolantC: 0,
  bathC: 0,
};

/** Share of its water a rear-door heat exchanger lets through, 1 unless its valve is stuck (REQ-107). */
function valveShare(world: World, rack: Entity): number {
  for (const l of world.index.incoming(rack.id, "member_of")) {
    if (world.index.find(l.from)?.kind !== "rdhx") continue;
    const f = world.faultsOn(l.from).find((x) => x.type === "rdhx_valve_stuck");
    if (f) return (f.params.openPct ?? 20) / 100;
  }
  return 1;
}

/** Share of the fluid an immersion tank still holds, scaled to what it takes out of the servers: 1 unless the level is low (REQ-107). */
function tankLevel(world: World, rack: Entity): number {
  for (const l of world.index.incoming(rack.id, "member_of")) {
    if (world.index.find(l.from)?.kind !== "immersion_tank") continue;
    const f = world.faultsOn(l.from).find((x) => x.type === "fluid_level_low");
    if (f) return ((f.params.levelPct ?? 60) / 100) ** 2;
  }
  return 1;
}

/** Heat the servers of a rack give to liquid when it flows, W. */
function directLiquidW(world: World, rack: Entity): number {
  const light = bulkOf(rack);
  if (light) {
    const model = world.catalog.getOf(light.modelId, "server");
    const serversW = Math.max(0, world.stateAs(rack.id, "rack").powerW - light.overheadW);
    return serversW * model.liquidShare;
  }
  let w = 0;
  for (const dev of world.index.childrenOf(rack.id)) {
    if (dev.kind !== "server") continue;
    const model = world.catalog.getOf(dev.modelId ?? "", "server");
    w += world.stateAs(dev.id, "server").powerW * model.liquidShare;
  }
  return w;
}

function tankBath(
  world: World,
  rack: Entity,
  powerW: number,
  supply: LiquidSupply,
  ambient: number,
  dt: number,
) {
  const state = world.stateAs(rack.id, "rack");
  const model = world.catalog.getOf(rack.modelId ?? "", "rack");
  const servers =
    bulkOf(rack)?.servers ??
    world.index.childrenOf(rack.id).filter((d) => d.kind === "server").length;
  const circulation = world
    .faultsOn(rack.id)
    .some((f) => f.type === "immersion_circulation_failure")
    ? 0.08
    : 1;
  const ua = supply.ok
    ? ((model.maxKw * 1000) / TANK_DELTA_K) * circulation * tankLevel(world, rack)
    : 0;
  const surface = TANK_SURFACE_W_PER_K;
  const sink = supply.ok ? supply.supplyC : ambient;
  const conductance = ua + surface;
  const eq = Math.min(FLUID_MAX_C, (ua * sink + surface * ambient + powerW) / conductance);
  const heatCapacity = model.fluidLitres * FLUID_J_PER_L_K + servers * SERVER_J_PER_K;
  const bathC = approach(state.bathC === 0 ? eq : state.bathC, eq, dt, heatCapacity / conductance);
  const removed = supply.ok ? ua * Math.max(0, bathC - supply.supplyC) : 0;
  return { bathC, liquidW: Math.min(removed, powerW) };
}

/** Update a rack's liquid side and say how much heat the loop and the room's air each carry. */
export function updateRackLiquid(
  world: World,
  rack: Entity,
  powerW: number,
  ambient: number,
  dt: number,
): RackLiquid {
  const cooling = rackCooling(world, rack);
  if (cooling === "air") return AIR_ONLY;
  const state = world.stateAs(rack.id, "rack");
  const supply = liquidSupply(world, rack, cooling);
  if (cooling === "immersion") {
    const bath = tankBath(world, rack, powerW, supply, ambient, dt);
    return {
      cooling,
      ok: supply.ok,
      liquidW: bath.liquidW,
      coolantC: supply.supplyC,
      bathC: bath.bathC,
    };
  }
  const liquidW = !supply.ok
    ? 0
    : cooling === "rdhx"
      ? RDHX_SHARE * powerW * valveShare(world, rack)
      : directLiquidW(world, rack);
  const coolantC = supply.ok
    ? supply.supplyC
    : approach(state.coolantC || ambient, stagnantTargetC(world, rack, ambient), dt, 300);
  return { cooling, ok: supply.ok, liquidW, coolantC, bathC: 0 };
}

/** Where the coolant standing still in the cold plates settles: warm in proportion to the heat it sits next to. */
function stagnantTargetC(world: World, rack: Entity, ambient: number): number {
  const designW = world.catalog.getOf(rack.modelId ?? "", "rack").maxKw * 800;
  return ambient + 33 * clamp(directLiquidW(world, rack) / Math.max(designW, 1), 0, 1);
}

/** CPU temperature target for a server on liquid, °C; undefined for air-cooled servers in air racks. */
export function liquidCpuTarget(
  rack: RackLiquid,
  model: { liquidShare: number; coolantRiseC: number; thermalRiseC: number },
  util: number,
  inletC: number,
): number | undefined {
  const load = 0.35 + 0.65 * clamp(util, 0, 1);
  if (rack.cooling === "immersion") return rack.bathC + model.coolantRiseC * load;
  if (rack.cooling !== "dlc" || model.liquidShare === 0) return undefined;
  if (rack.ok) return rack.coolantC + model.coolantRiseC * load;
  // Cold plates without flow: fans built for the air share now carry everything, so the CPU
  // overheats within minutes.
  return inletC + (model.thermalRiseC * load) / Math.max(0.12, 1 - model.liquidShare);
}
