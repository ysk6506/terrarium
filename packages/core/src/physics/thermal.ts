/**
 * Thermal model. Each room is one lumped thermal mass: IT heat in, cooling removal and envelope loss
 * out. Cooling units remove heat in proportion to how far the room is above their setpoint, up to
 * their (possibly degraded) capacity. A rack breathes a mix of supply air and room air; containment
 * reduces the room-air share. Servers heat their CPUs above their inlet by load and fan health.
 */
import { approach, clamp } from "@terrarium/core/kernel";
import type { Entity, World } from "@terrarium/core/world";
import {
  deviceW,
  liquidCpuTarget,
  type RackLiquid,
  rackAirHeatW,
  updateRackLiquid,
} from "./liquid";
import { OUTDOOR_C, plantAvailability } from "./plant";

export { OUTDOOR_C };
const ENVELOPE_W_PER_K_M2 = 2;
/** Air temperature drop across a cooling coil running at full capacity. */
const COIL_DELTA_C = 12;
const MASS_J_PER_K_M3 = 1200 * 3;
const ROOM_HEIGHT_M = 3;

const roomArea = (room: Entity): number =>
  room.placement?.type === "area" ? room.placement.w * room.placement.d : 100;

function coolingUnitsIn(world: World, roomId: string): Entity[] {
  return world.index.descendants(roomId).filter((e) => e.kind === "cooling_unit");
}

function effectiveCapacityW(world: World, unit: Entity): number {
  const model = world.catalog.getOf(unit.modelId ?? "", "cooling_unit");
  const factor =
    world.faultsOn(unit.id).find((f) => f.type === "cooling_unit_degraded")?.params.factor ?? 1;
  // A chilled-water unit can only move the heat its plant takes from it.
  const water = model.chilledWater ? plantAvailability(world, unit.id) : 1;
  return model.capacityKw * 1000 * factor * water;
}

function setpointOf(world: World, unit: Entity): number {
  const drift =
    world.faultsOn(unit.id).find((f) => f.type === "setpoint_drift")?.params.deltaC ?? 0;
  return world.stateAs(unit.id, "cooling_unit").setpointC + drift;
}

/** Heat released into a room's air, in watts. */
export function roomHeatW(world: World, roomId: string): number {
  let heat = 0;
  for (const entity of world.index.descendants(roomId)) {
    const state = world.stateOf(entity.id);
    if (state.kind === "rack")
      heat += rackAirHeatW(world, entity, world.stateAs(roomId, "room").ambientC);
    else if (state.kind === "ups")
      heat += state.loadW * (1 - world.catalog.getOf(entity.modelId ?? "", "ups").efficiency);
    else if (state.kind === "cdu") heat += state.running ? 0.04 * state.loadKw * 1000 : 0;
  }
  return heat;
}

/** One explicit Euler step of a room's energy balance; updates cooling units' load and air temperatures. */
export function updateRoom(world: World, room: Entity, dt: number): void {
  const state = world.stateAs(room.id, "room");
  const t = state.ambientC;
  const units = coolingUnitsIn(world, room.id);
  const heat = roomHeatW(world, room.id);
  let removed = 0;
  for (const unit of units) {
    const unitState = world.stateAs(unit.id, "cooling_unit");
    const capacity = effectiveCapacityW(world, unit);
    if (!unitState.running) {
      world.patch(unit.id, "cooling_unit", { loadKw: 0, capacityKw: 0, supplyC: t, returnC: t });
      continue;
    }
    const setpoint = setpointOf(world, unit);
    const removal = clamp((capacity / 10) * (t - setpoint), 0, capacity);
    // Supply air leaves the coil cooler than the room by the share of capacity in use, never below setpoint.
    const supplyC = Math.max(setpoint, t - COIL_DELTA_C * (removal / Math.max(capacity, 1)));
    removed += removal;
    world.patch(unit.id, "cooling_unit", {
      loadKw: removal / 1000,
      capacityKw: capacity / 1000,
      supplyC,
      returnC: t,
    });
  }
  const area = roomArea(room);
  const envelope = ENVELOPE_W_PER_K_M2 * area * (t - OUTDOOR_C);
  const mass = MASS_J_PER_K_M3 * area * ROOM_HEIGHT_M;
  world.patch(room.id, "room", {
    ambientC: clamp(t + (dt * (heat - removed - envelope)) / mass, 5, 75),
  });
}

/** Supply air reaching a rack: its assigned running units, else any running unit in the room. */
function supplyFor(
  world: World,
  rack: Entity,
  roomId: string,
): { supplyC: number; extraMix: number } | undefined {
  const explicit = world.index
    .outgoing(rack.id, "cooling")
    .map((l) => world.index.entity(l.to))
    .filter((e) => e.kind === "cooling_unit");
  const live = (list: Entity[]) => list.filter((u) => world.stateAs(u.id, "cooling_unit").running);
  const assigned = live(explicit);
  const fallback = assigned.length > 0 ? assigned : live(coolingUnitsIn(world, roomId));
  if (fallback.length === 0) return undefined;
  const supplyC =
    fallback.reduce((sum, u) => sum + world.stateAs(u.id, "cooling_unit").supplyC, 0) /
    fallback.length;
  return { supplyC, extraMix: assigned.length > 0 || explicit.length === 0 ? 0 : 0.25 };
}

export function updateRack(world: World, rack: Entity, dt: number): void {
  const room = world.index.enclosing(rack.id, "room");
  if (!room) return;
  const ambient = world.stateAs(room.id, "room").ambientC;
  const devices = world.index.childrenOf(rack.id);
  const powerW = deviceW(world, rack);
  const contained = world.index.find(rack.parentId ?? "")?.kind === "containment";
  const supply = supplyFor(world, rack, room.id);
  const mix = (contained ? 0.12 : 0.3) + (supply?.extraMix ?? 0);
  const target = supply
    ? supply.supplyC + mix * (ambient - supply.supplyC) + 0.02 * (powerW / 1000)
    : ambient;
  const inletC = approach(world.stateAs(rack.id, "rack").inletC, target, dt, 60);
  const liquid = updateRackLiquid(world, rack, powerW, ambient, dt);
  const airW = Math.max(0, powerW - liquid.liquidW);
  const outletC = inletC + (airW > 0 ? Math.min(8 + 0.4 * (airW / 1000), 25) : 0);
  world.patch(rack.id, "rack", {
    inletC,
    outletC,
    powerW,
    liquidW: liquid.liquidW,
    coolantC: liquid.coolantC,
    bathC: liquid.bathC,
  });
  for (const device of devices) {
    if (device.kind === "server") updateServerThermal(world, device, inletC, contained, liquid, dt);
  }
}

/** Mean cold-side and hot-side air temperature inside each containment. */
export function updateContainments(world: World): void {
  for (const pod of world.index.ofKind("containment")) {
    const racks = world.index.childrenOf(pod.id, "rack");
    if (racks.length === 0) continue;
    let cold = 0;
    let hot = 0;
    for (const rack of racks) {
      const s = world.stateAs(rack.id, "rack");
      cold += s.inletC;
      hot += s.outletC;
    }
    world.patch(pod.id, "containment", { coldC: cold / racks.length, hotC: hot / racks.length });
  }
}

/** Indexes of the fans a fan_failure fault has stopped. */
function failedFanSet(world: World, server: Entity): Set<number> {
  return new Set(
    world
      .faultsOn(server.id)
      .filter((f) => f.type === "fan_failure")
      .map((f) => f.params.fanIndex ?? 0),
  );
}

/** Fan speeds, rpm: they follow the CPU temperature, faster when a fan is lost; a stopped fan reads 0. */
function fanSpeeds(input: {
  fans: number;
  failed: ReadonlySet<number>;
  running: boolean;
  cpuC: number;
}): number[] {
  const { fans, failed, running, cpuC } = input;
  const rpm = clamp(3000 + 120 * (cpuC - 40), 3000, 16000) * (failed.size > 0 ? 1.25 : 1);
  return Array.from({ length: fans }, (_, i) =>
    !running || failed.has(i) ? 0 : Math.round(Math.min(rpm, 18000)),
  );
}

function updateServerThermal(
  world: World,
  server: Entity,
  rackInletC: number,
  contained: boolean,
  liquid: RackLiquid,
  dt: number,
): void {
  const model = world.catalog.getOf(server.modelId ?? "", "server");
  const state = world.stateAs(server.id, "server");
  const u = server.placement?.type === "unit" ? server.placement.u : 1;
  const inletC = rackInletC + 0.03 * (u - 1) * (contained ? 0.3 : 1);
  const failedFans = failedFanSet(world, server);
  const running = state.powered && state.adminOn;
  const util =
    model.maxPowerW > model.idlePowerW
      ? (state.powerW - model.idlePowerW) / (model.maxPowerW - model.idlePowerW)
      : 0;
  const fanPenalty = model.fanCount > 0 ? 1 + 0.6 * (failedFans.size / model.fanCount) : 1;
  const air = inletC + model.thermalRiseC * (0.35 + 0.65 * clamp(util, 0, 1)) * fanPenalty;
  const wet = liquidCpuTarget(liquid, model, util, inletC);
  const target = running ? (wet ?? air) : liquid.cooling === "immersion" ? liquid.bathC : inletC;
  const cpuC = approach(state.cpuC, target, dt, 30);
  const fanRpm = fanSpeeds({ fans: model.fanCount, failed: failedFans, running, cpuC });
  const throttled =
    running && (state.throttled ? cpuC > model.cpuThrottleC - 5 : cpuC > model.cpuThrottleC);
  world.patch(server.id, "server", { inletC, cpuC, fanRpm, throttled });
}
