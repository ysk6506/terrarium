/**
 * Thermal model. Each room is one lumped thermal mass: IT heat in, cooling removal and envelope loss
 * out. Cooling units remove heat in proportion to how far the room is above their setpoint, up to
 * their (possibly degraded) capacity. A rack breathes a mix of supply air and room air; containment
 * reduces the room-air share. Servers heat their CPUs above their inlet by load and fan health.
 */
import type { CoolingModel, ServerModel, UpsModel } from "@terrarium/core/catalog";
import { approach, clamp } from "@terrarium/core/kernel";
import type { Entity, Fault, StateOf, World } from "@terrarium/core/world";
import {
  AIR_ONLY,
  liquidCpuTarget,
  type RackLiquid,
  TANK_SURFACE_W_PER_K,
  updateRackLiquid,
} from "./liquid";
import { plantAvailabilityAt } from "./plant";
import { faultParam, hasFault } from "./power-supply";
import { faultsAt, type Heat, heatOf } from "./thermal-plan";

const ENVELOPE_W_PER_K_M2 = 2;
/** Air temperature drop across a cooling coil running at full capacity. */
const COIL_DELTA_C = 12;
const MASS_J_PER_K_M3 = 1200 * 3;
const ROOM_HEIGHT_M = 3;

function effectiveCapacityW(heat: Heat, unit: number): number {
  const model = heat.plan.models[unit] as CoolingModel;
  const factor = faultParam(faultsAt(heat, unit), "cooling_unit_degraded", "factor") ?? 1;
  // A chilled-water unit can only move the heat its plant takes from it.
  const water = model.chilledWater ? plantAvailabilityAt(heat, unit) : 1;
  return model.capacityKw * 1000 * factor * water;
}

function setpointOf(heat: Heat, unit: number): number {
  const drift = faultParam(faultsAt(heat, unit), "setpoint_drift", "deltaC") ?? 0;
  return (heat.states[unit] as StateOf<"cooling_unit">).setpointC + drift;
}

/** Electric power of the IT devices in a rack, W (read from the devices, so it is this step's). */
function deviceWAt(heat: Heat, rack: number): number {
  if (heat.plan.light[rack]) return (heat.states[rack] as StateOf<"rack">).powerW;
  const { start, items } = heat.t.devices;
  let sum = 0;
  for (let q = start[rack] as number; q < (start[rack + 1] as number); q++)
    sum += (heat.states[items[q] as number] as StateOf<"server"> | StateOf<"switch">).powerW;
  return sum;
}

/**
 * Air-side heat a rack puts into its room, W: whatever the liquid does not carry, plus what a warm
 * tank gives off through its walls.
 */
function rackAirHeatAt(heat: Heat, rack: number, ambient: number): number {
  const s = heat.states[rack] as StateOf<"rack">;
  if (heat.t.cooling[rack] === "immersion")
    return Math.max(0, s.bathC - ambient) * TANK_SURFACE_W_PER_K;
  return Math.max(0, deviceWAt(heat, rack) - s.liquidW);
}

function roomHeatAt(heat: Heat, room: number): number {
  const ambient = (heat.states[room] as StateOf<"room">).ambientC;
  const { start, items } = heat.t.roomSources;
  let sum = 0;
  for (let q = start[room] as number; q < (start[room + 1] as number); q++) {
    const i = items[q] as number;
    const s = heat.states[i];
    if (s?.kind === "rack") sum += rackAirHeatAt(heat, i, ambient);
    else if (s?.kind === "ups") sum += s.loadW * (1 - (heat.plan.models[i] as UpsModel).efficiency);
    else if (s?.kind === "cdu") sum += s.running ? 0.04 * s.loadKw * 1000 : 0;
  }
  return sum;
}

/** Heat released into a room's air, in watts. */
export function roomHeatW(world: World, roomId: string): number {
  const room = world.index.positionOf(roomId);
  if (room === undefined) return 0;
  return roomHeatAt(heatOf(world), room);
}

/** One explicit Euler step of a room's energy balance; updates cooling units' load and air temperatures. */
function updateRoomAt(heat: Heat, room: number, dt: number): void {
  const state = heat.states[room] as StateOf<"room">;
  const t = state.ambientC;
  const { start, items } = heat.t.roomUnits;
  const sources = roomHeatAt(heat, room);
  let removed = 0;
  for (let q = start[room] as number; q < (start[room + 1] as number); q++) {
    const unit = items[q] as number;
    const unitState = heat.states[unit] as StateOf<"cooling_unit">;
    if (!unitState.running) {
      Object.assign(unitState, { loadKw: 0, capacityKw: 0, supplyC: t, returnC: t });
      continue;
    }
    const capacity = effectiveCapacityW(heat, unit);
    const setpoint = setpointOf(heat, unit);
    const removal = clamp((capacity / 10) * (t - setpoint), 0, capacity);
    // Supply air leaves the coil cooler than the room by the share of capacity in use, never below setpoint.
    const supplyC = Math.max(setpoint, t - COIL_DELTA_C * (removal / Math.max(capacity, 1)));
    removed += removal;
    unitState.loadKw = removal / 1000;
    unitState.capacityKw = capacity / 1000;
    unitState.supplyC = supplyC;
    unitState.returnC = t;
  }
  const area = heat.t.area[room] as number;
  const envelope = ENVELOPE_W_PER_K_M2 * area * (t - heat.world.outdoorC());
  const mass = MASS_J_PER_K_M3 * area * ROOM_HEIGHT_M;
  state.ambientC = clamp(t + (dt * (sources - removed - envelope)) / mass, 5, 75);
}

/** Supply air reaching a rack: its assigned running units, else any running unit in the room. */
class AirSupply {
  supplyC = 0;
  extraMix = 0;

  /** Work out the supply for `rack`; false when no unit can cool it. */
  of(heat: Heat, rack: number, room: number): boolean {
    const explicit = heat.t.assigned;
    const first = explicit.start[rack] as number;
    const last = explicit.start[rack + 1] as number;
    let sum = 0;
    let count = 0;
    for (let q = first; q < last; q++) {
      const s = heat.states[explicit.items[q] as number] as StateOf<"cooling_unit">;
      if (s.running) {
        sum += s.supplyC;
        count++;
      }
    }
    const assigned = count;
    if (count === 0) {
      const units = heat.t.roomUnits;
      for (let q = units.start[room] as number; q < (units.start[room + 1] as number); q++) {
        const s = heat.states[units.items[q] as number] as StateOf<"cooling_unit">;
        if (s.running) {
          sum += s.supplyC;
          count++;
        }
      }
    }
    if (count === 0) return false;
    this.supplyC = sum / count;
    this.extraMix = assigned > 0 || last === first ? 0 : 0.25;
    return true;
  }
}

function updateRackAt(heat: Heat, rack: number, air: AirSupply, dt: number): void {
  const room = heat.t.rackRoom[rack] as number;
  if (room < 0) return;
  const { world, states, t } = heat;
  const ambient = (states[room] as StateOf<"room">).ambientC;
  const state = states[rack] as StateOf<"rack">;
  const powerW = deviceWAt(heat, rack);
  const contained = t.contained[rack] === 1;
  const cooled = air.of(heat, rack, room);
  const mix = (contained ? 0.12 : 0.3) + (cooled ? air.extraMix : 0);
  const target = cooled
    ? air.supplyC + mix * (ambient - air.supplyC) + 0.02 * (powerW / 1000)
    : ambient;
  const inletC = approach(state.inletC, target, dt, 60);
  const entity = heat.plan.ents[rack] as Entity;
  const liquid =
    t.cooling[rack] === "air" ? AIR_ONLY : updateRackLiquid(world, entity, powerW, ambient, dt);
  const airW = Math.max(0, powerW - liquid.liquidW);
  state.inletC = inletC;
  state.outletC = inletC + (airW > 0 ? Math.min(8 + 0.4 * (airW / 1000), 25) : 0);
  state.powerW = powerW;
  state.liquidW = liquid.liquidW;
  state.coolantC = liquid.coolantC;
  state.bathC = liquid.bathC;
  const kids = t.servers;
  for (let q = kids.start[rack] as number; q < (kids.start[rack + 1] as number); q++)
    updateServerThermal(heat, kids.items[q] as number, { inletC, contained, liquid, dt });
}

/** Mean cold-side and hot-side air temperature inside each containment. */
function updateContainmentsAt(heat: Heat): void {
  const { start, items } = heat.t.podRacks;
  for (const pod of heat.t.containments) {
    const first = start[pod] as number;
    const last = start[pod + 1] as number;
    if (last === first) continue;
    let cold = 0;
    let hot = 0;
    for (let q = first; q < last; q++) {
      const s = heat.states[items[q] as number] as StateOf<"rack">;
      cold += s.inletC;
      hot += s.outletC;
    }
    const state = heat.states[pod] as StateOf<"containment">;
    state.coldC = cold / (last - first);
    state.hotC = hot / (last - first);
  }
}

/** The thermal passes of one step, in order: rooms, racks (with their servers), containments. */
export function updateThermal(world: World, dt: number): void {
  const heat = heatOf(world);
  for (const room of heat.t.rooms) updateRoomAt(heat, room, dt);
  const air = new AirSupply();
  for (const rack of heat.t.racks) updateRackAt(heat, rack, air, dt);
  updateContainmentsAt(heat);
}

interface RackAir {
  readonly inletC: number;
  readonly contained: boolean;
  readonly liquid: RackLiquid;
  readonly dt: number;
}

const NO_FANS: ReadonlySet<number> = new Set();

/** The fans a fan_failure fault has stopped, by index. */
function failedFans(faults: readonly Fault[]): ReadonlySet<number> {
  if (!hasFault(faults, "fan_failure")) return NO_FANS;
  return new Set(faults.filter((f) => f.type === "fan_failure").map((f) => f.params.fanIndex ?? 0));
}

/** Fan speeds, rpm: they follow the CPU temperature, faster when a fan is lost; a stopped fan reads 0. */
function setFanSpeeds(
  state: StateOf<"server">,
  fans: number,
  failed: ReadonlySet<number>,
  running: boolean,
): void {
  const rpm = clamp(3000 + 120 * (state.cpuC - 40), 3000, 16000) * (failed.size > 0 ? 1.25 : 1);
  const speed = Math.round(Math.min(rpm, 18000));
  if (state.fanRpm.length !== fans) state.fanRpm = new Array<number>(fans);
  for (let k = 0; k < fans; k++) state.fanRpm[k] = !running || failed.has(k) ? 0 : speed;
}

function updateServerThermal(heat: Heat, i: number, air: RackAir): void {
  const model = heat.plan.models[i] as ServerModel;
  const state = heat.states[i] as StateOf<"server">;
  const { contained, liquid, dt } = air;
  const inletC = air.inletC + 0.03 * ((heat.t.unit[i] as number) - 1) * (contained ? 0.3 : 1);
  const failed = failedFans(faultsAt(heat, i));
  const running = state.powered && state.adminOn;
  const util =
    model.maxPowerW > model.idlePowerW
      ? (state.powerW - model.idlePowerW) / (model.maxPowerW - model.idlePowerW)
      : 0;
  // an experiment setting (REQ-107): fans held below full speed stand in for a weak room cooling, as the team's own tests did
  const fanPct = (heat.plan.ents[i] as Entity).props.fanSpeedPct;
  const held = typeof fanPct === "number" ? clamp(fanPct, 20, 100) / 100 : 1;
  const fanPenalty =
    (model.fanCount > 0 ? 1 + 0.6 * (failed.size / model.fanCount) : 1) * (1 + 1.2 * (1 - held));
  const airC = inletC + model.thermalRiseC * (0.35 + 0.65 * clamp(util, 0, 1)) * fanPenalty;
  const wet = liquidCpuTarget(liquid, model, util, inletC);
  const target = running ? (wet ?? airC) : liquid.cooling === "immersion" ? liquid.bathC : inletC;
  const cpuC = approach(state.cpuC, target, dt, 30);
  state.inletC = inletC;
  state.cpuC = cpuC;
  setFanSpeeds(state, model.fanCount, failed, running);
  state.throttled =
    running && (state.throttled ? cpuC > model.cpuThrottleC - 5 : cpuC > model.cpuThrottleC);
}
