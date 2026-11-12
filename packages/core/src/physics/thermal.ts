/**
 * Thermal model. Each room is one lumped thermal mass: IT heat in, cooling removal and envelope loss
 * out. Cooling units remove heat in proportion to how far the room is above their setpoint, up to
 * their (possibly degraded) capacity. A rack breathes a mix of supply air and room air; containment
 * reduces the room-air share. Servers heat their CPUs above their inlet by load and fan health.
 */
import type { CoolingModel, ServerModel, UpsModel } from "@terrarium/core/catalog";
import { approach, clamp } from "@terrarium/core/kernel";
import type { SlotValues } from "@terrarium/core/physics/slots";
import type { Entity, Fault, StateOf, World } from "@terrarium/core/world";
import { AIR_ONLY, liquidCpuTarget, type RackLiquid, updateRackLiquid } from "./liquid";
import { upsEfficiencyAt } from "./models";
import { plantAvailabilityAt } from "./plant";
import { faultParam, hasFault } from "./power-supply";
import { faultsAt, type Heat, heatOf } from "./thermal-plan";

/** The numbers of the room slot (REQ-113) for the thing at position `i` of the plan: the profile's, else v1's. */
const roomValues = (heat: Heat, i: number): SlotValues["thermal.room"] =>
  heat.world.physicsAt("thermal.room", (heat.plan.ents[i] as Entity).id);

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
    return (
      Math.max(0, s.bathC - ambient) *
      heat.world.physicsAt("cooling.liquid", (heat.plan.ents[rack] as Entity).id).tankSurfaceWPerK
    );
  return Math.max(0, deviceWAt(heat, rack) - s.liquidW);
}

function roomHeatAt(heat: Heat, room: number): number {
  const ambient = (heat.states[room] as StateOf<"room">).ambientC;
  const P = roomValues(heat, room);
  const { start, items } = heat.t.roomSources;
  let sum = 0;
  for (let q = start[room] as number; q < (start[room + 1] as number); q++) {
    const i = items[q] as number;
    const s = heat.states[i];
    if (s?.kind === "rack") sum += rackAirHeatAt(heat, i, ambient);
    else if (s?.kind === "ups")
      sum += s.loadW * (1 - upsEfficiencyAt(heat.world, heat.plan.models[i] as UpsModel, s.loadW));
    else if (s?.kind === "cdu") sum += s.running ? P.cduHeatShare * s.loadKw * 1000 : 0;
  }
  return sum;
}

/** Heat released into a room's air, in watts. */
export function roomHeatW(world: World, roomId: string): number {
  const room = world.index.positionOf(roomId);
  if (room === undefined) return 0;
  return roomHeatAt(heatOf(world), room);
}

/** What one room's step moved, kept for the law checks (REQ-113): the energy balance of the step, term by term. */
export interface RoomStep {
  readonly room: string;
  readonly dt: number;
  readonly fromC: number;
  readonly toC: number;
  /** Heat into the room's air, removed by its cooling units, and lost through the envelope, W. */
  readonly inW: number;
  readonly removedW: number;
  readonly envelopeW: number;
  /** What the cooling units could have removed, W. */
  readonly capacityW: number;
  readonly massJPerK: number;
  /** The step ended on a bound of the room's temperature (the balance does not hold there). */
  readonly clamped: boolean;
}

const ledgers = new WeakMap<World, RoomStep[]>();

/** Start (or, with `undefined`, stop) collecting the room steps of a world into `into`; used by the law checks. */
export function collectRoomSteps(world: World, into: RoomStep[] | undefined): void {
  if (into) ledgers.set(world, into);
  else ledgers.delete(world);
}

/** One explicit Euler step of a room's energy balance; updates cooling units' load and air temperatures. */
function updateRoomAt(heat: Heat, room: number, dt: number): void {
  const state = heat.states[room] as StateOf<"room">;
  const t = state.ambientC;
  const P = roomValues(heat, room);
  const { start, items } = heat.t.roomUnits;
  const sources = roomHeatAt(heat, room);
  let removed = 0;
  let capacityW = 0;
  for (let q = start[room] as number; q < (start[room + 1] as number); q++) {
    const unit = items[q] as number;
    const unitState = heat.states[unit] as StateOf<"cooling_unit">;
    if (!unitState.running) {
      Object.assign(unitState, { loadKw: 0, capacityKw: 0, supplyC: t, returnC: t });
      continue;
    }
    const capacity = effectiveCapacityW(heat, unit);
    capacityW += capacity;
    const setpoint = setpointOf(heat, unit);
    const removal = clamp((capacity / P.fullLoadDeltaC) * (t - setpoint), 0, capacity);
    // Supply air leaves the coil cooler than the room by the share of capacity in use, never below setpoint.
    const supplyC = Math.max(setpoint, t - P.coilDeltaC * (removal / Math.max(capacity, 1)));
    removed += removal;
    unitState.loadKw = removal / 1000;
    unitState.capacityKw = capacity / 1000;
    unitState.supplyC = supplyC;
    unitState.returnC = t;
  }
  const area = heat.t.area[room] as number;
  const envelope = P.envelopeWPerKM2 * area * (t - heat.world.outdoorC());
  const mass = P.airJPerKM3 * area * P.roomHeightM;
  const next = t + (dt * (sources - removed - envelope)) / mass;
  state.ambientC = clamp(next, P.roomMinC, P.roomMaxC);
  const ledger = ledgers.get(heat.world);
  if (ledger)
    ledger.push({
      room: (heat.plan.ents[room] as Entity).id,
      dt,
      fromC: t,
      toC: state.ambientC,
      inW: sources,
      removedW: removed,
      envelopeW: envelope,
      capacityW,
      massJPerK: mass,
      clamped: next !== state.ambientC,
    });
}

/** Supply air reaching a rack: its assigned running units, else any running unit in the room. */
class AirSupply {
  supplyC = 0;
  extraMix = 0;

  /** Work out the supply for `rack`; false when no unit can cool it. `unassignedMix` is the extra mix of a rack nobody serves by name. */
  of(heat: Heat, rack: number, room: number, unassignedMix: number): boolean {
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
    this.extraMix = assigned > 0 || last === first ? 0 : unassignedMix;
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
  const P = roomValues(heat, rack);
  const cooled = air.of(heat, rack, room, P.mixUnassigned);
  const mix = (contained ? P.mixContained : P.mixOpen) + (cooled ? air.extraMix : 0);
  const target = cooled
    ? air.supplyC + mix * (ambient - air.supplyC) + P.inletHeatBiasCPerKw * (powerW / 1000)
    : ambient;
  const inletC = approach(state.inletC, target, dt, P.inletTauS);
  const entity = heat.plan.ents[rack] as Entity;
  const liquid =
    t.cooling[rack] === "air" ? AIR_ONLY : updateRackLiquid(world, entity, powerW, ambient, dt);
  const airW = Math.max(0, powerW - liquid.liquidW);
  state.inletC = inletC;
  state.outletC =
    inletC +
    (airW > 0
      ? Math.min(P.outletBaseRiseC + P.outletRiseCPerKw * (airW / 1000), P.outletMaxRiseC)
      : 0);
  state.powerW = powerW;
  state.liquidW = liquid.liquidW;
  state.coolantC = liquid.coolantC;
  state.bathC = liquid.bathC;
  const kids = t.servers;
  for (let q = kids.start[rack] as number; q < (kids.start[rack + 1] as number); q++)
    updateServerThermal(heat, kids.items[q] as number, { inletC, contained, liquid, dt, room: P });
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
  /** The room slot's numbers at this rack. */
  readonly room: SlotValues["thermal.room"];
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
  D: SlotValues["thermal.device"],
): void {
  const rpm =
    clamp(D.fanRpmBase + D.fanRpmPerC * (state.cpuC - D.fanRpmRefC), D.fanRpmBase, D.fanRpmMax) *
    (failed.size > 0 ? D.fanFailBoost : 1);
  const speed = Math.round(Math.min(rpm, D.fanRpmCap));
  if (state.fanRpm.length !== fans) state.fanRpm = new Array<number>(fans);
  for (let k = 0; k < fans; k++) state.fanRpm[k] = !running || failed.has(k) ? 0 : speed;
}

function updateServerThermal(heat: Heat, i: number, air: RackAir): void {
  const model = heat.plan.models[i] as ServerModel;
  const state = heat.states[i] as StateOf<"server">;
  const { contained, liquid, dt } = air;
  const D = heat.world.physicsAt("thermal.device", (heat.plan.ents[i] as Entity).id);
  const inletC =
    air.inletC +
    air.room.rackUnitBiasC *
      ((heat.t.unit[i] as number) - 1) *
      (contained ? air.room.rackUnitContainedShare : 1);
  const failed = failedFans(faultsAt(heat, i));
  const running = state.powered && state.adminOn;
  const util =
    model.maxPowerW > model.idlePowerW
      ? (state.powerW - model.idlePowerW) / (model.maxPowerW - model.idlePowerW)
      : 0;
  // an experiment setting (REQ-107): fans held below full speed stand in for a weak room cooling
  const fanPct = (heat.plan.ents[i] as Entity).props.fanSpeedPct;
  const held = typeof fanPct === "number" ? clamp(fanPct, 20, 100) / 100 : 1;
  const fanPenalty =
    (model.fanCount > 0 ? 1 + D.fanFailPenalty * (failed.size / model.fanCount) : 1) *
    (1 + D.fanHeldPenalty * (1 - held));
  const airC =
    inletC +
    model.thermalRiseC * (D.chipRiseBase + D.chipRiseLoad * clamp(util, 0, 1)) * fanPenalty;
  const wet = liquidCpuTarget(liquid, model, util, inletC, D);
  const target = running ? (wet ?? airC) : liquid.cooling === "immersion" ? liquid.bathC : inletC;
  const cpuC = approach(state.cpuC, target, dt, D.chipTauS);
  state.inletC = inletC;
  state.cpuC = cpuC;
  setFanSpeeds(state, model.fanCount, failed, running, D);
  state.throttled =
    running &&
    (state.throttled
      ? cpuC > model.cpuThrottleC - D.throttleHysteresisC
      : cpuC > model.cpuThrottleC);
}
