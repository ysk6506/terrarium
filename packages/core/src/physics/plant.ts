/**
 * The plant outside the data halls (REQ-044): generators that take over when the utility fails,
 * coolant distribution units (CDU) that carry heat out of liquid-cooled racks, and chillers, dry
 * coolers and cooling towers that carry it away. Heat flows rack -> CDU -> plant; each stage has a
 * capacity and a water temperature that rises when the stage behind it cannot keep up.
 */
import type { CduModel, ChillerModel, CoolingModel } from "@terrarium/core/catalog";
import { approach, clamp } from "@terrarium/core/kernel";
import type { Entity, StateOf, World } from "@terrarium/core/world";
import { isTransferSwitch, type SupplyResolver } from "./power";
import { faultParam, hasFault } from "./power-supply";
import { faultsAt, type Heat, heatOf } from "./thermal-plan";

/** Specific heat of water, J/(kg·K), for a litre of coolant. */
const WATER_J_PER_L_K = 4186;
const MAX_LOOP_C = 60;

const fault = (world: World, id: string, type: string) =>
  world.faultsOn(id).find((f) => f.type === type);

// ---------- generators ----------

/** A generator is wanted when a transfer switch it backs has lost its utility side. */
function backupWanted(world: World, gen: Entity, supply: SupplyResolver): boolean {
  return world.index
    .incoming(gen.id, "power")
    .some((l) => isTransferSwitch(world, l.from) && !supply.utilityOk(l.from));
}

interface Engine {
  readonly phase: "standby" | "starting" | "running" | "failed";
  readonly startedFor: number;
  readonly fuelPct: number;
}

/** The state of a generator nobody has asked to run: ready, unless it failed and has not been fixed. */
function idlePhase(engine: Engine, broken: boolean): Engine["phase"] {
  if (engine.fuelPct > 0 && !broken) return "standby";
  return engine.phase === "failed" ? "failed" : "standby";
}

/** Where a generator's start-up has got to this step. */
function nextEngine(
  engine: Engine,
  input: { wanted: boolean; broken: boolean; startSeconds: number; dt: number },
): Engine {
  const { wanted, broken, startSeconds, dt } = input;
  const { phase, startedFor, fuelPct } = engine;
  if (!wanted) return { phase: idlePhase(engine, broken), startedFor: 0, fuelPct };
  const mayStart = phase === "standby" || (phase === "failed" && !broken && fuelPct > 0);
  if (mayStart) return { phase: broken ? "failed" : "starting", startedFor: 0, fuelPct };
  if (phase !== "starting") return engine;
  const seconds = startedFor + dt;
  if (broken) return { phase: "failed", startedFor: seconds, fuelPct };
  return { phase: seconds >= startSeconds ? "running" : "starting", startedFor: seconds, fuelPct };
}

/** Fuel burned in a step by a running generator, as a new tank level; an empty tank stops it. */
function burnFuel(engine: Engine, burnShare: number, dt: number, tankLitres: number): Engine {
  if (engine.phase !== "running") return engine;
  const burned = ((burnShare * dt) / 3600 / tankLitres) * 100;
  const fuelPct = clamp(engine.fuelPct - burned, 0, 100);
  return { ...engine, fuelPct, phase: fuelPct <= 0 ? "failed" : "running" };
}

export function updateGenerators(world: World, supply: SupplyResolver, dt: number): void {
  for (const gen of world.index.ofKind("generator")) {
    const model = world.catalog.getOf(gen.modelId ?? "", "generator");
    const state = world.stateAs(gen.id, "generator");
    const wanted = state.adminOn && backupWanted(world, gen, supply);
    const broken = fault(world, gen.id, "generator_start_failure") !== undefined;
    const started = nextEngine(state, { wanted, broken, startSeconds: model.startSeconds, dt });
    const share = clamp(state.loadKw / model.capacityKw, 0.1, 1.2);
    const { phase, startedFor, fuelPct } = burnFuel(
      started,
      model.burnLitresPerHour * share,
      dt,
      typeof gen.props.fuelLitres === "number" ? gen.props.fuelLitres : model.fuelLitres,
    );
    world.patch(gen.id, "generator", { phase, startedFor, fuelPct });
  }
}

// ---------- shared helpers ----------

/**
 * How much of its water a consumer gets from the plants behind it: 1 while the water is cold, less as
 * it warms. A stopped plant keeps cooling for a while on the water in its buffer, then fades out.
 */
export function plantAvailabilityAt(heat: Heat, i: number): number {
  const { start, items } = heat.t.plants;
  const first = start[i] as number;
  const last = start[i + 1] as number;
  if (first === last) return 1;
  let sum = 0;
  for (let q = first; q < last; q++) {
    const plant = items[q] as number;
    const s = heat.states[plant] as StateOf<"chiller">;
    const model = heat.plan.models[plant] as ChillerModel;
    sum += clamp(1 - Math.max(0, s.supplyC - model.supplySetpointC - 1) / 8, 0, 1);
  }
  return sum / (last - first);
}

/**
 * What share of its rated capacity a plant keeps in the outdoor air of the moment: dry coolers and towers lose
 * it as the air warms, a chiller loses up to 15% between 25 and 40 °C (its condenser runs hotter).
 */
export function ambientDerate(
  plant: "chiller" | "dry_cooler" | "cooling_tower",
  outdoorC: number,
): number {
  if (plant === "dry_cooler") return clamp(1.1 - 0.01 * (outdoorC - 15), 0.3, 1);
  if (plant === "cooling_tower") return clamp(1.04 - 0.004 * (outdoorC - 15), 0.5, 1);
  return clamp(1 - (0.15 * (outdoorC - 25)) / 15, 0.85, 1);
}

// ---------- CDUs ----------

/** Whether coolant is still flowing into a rack: its CDU is running and no leak has been isolated. */
export function leakIsolated(world: World, id: string): boolean {
  const leak = fault(world, id, "coolant_leak");
  return leak !== undefined && world.time() - leak.since >= (leak.params.shutoffSeconds ?? 120);
}

/** Heat each running CDU carries away, from the liquid racks linked to it, W (by position). */
function cduLoadsW(heat: Heat): Float64Array {
  const loads = new Float64Array(heat.plan.ents.length);
  const { start, items } = heat.t.rackCdus;
  for (const rack of heat.t.racks) {
    const liquidW = (heat.states[rack] as StateOf<"rack">).liquidW;
    if (liquidW <= 0) continue;
    const first = start[rack] as number;
    const last = start[rack + 1] as number;
    let serving = 0;
    for (let q = first; q < last; q++)
      if ((heat.states[items[q] as number] as StateOf<"cdu">).running) serving++;
    for (let q = first; q < last; q++) {
      const cdu = items[q] as number;
      if ((heat.states[cdu] as StateOf<"cdu">).running)
        loads[cdu] = (loads[cdu] as number) + liquidW / serving;
    }
  }
  return loads;
}

function updateCdu(heat: Heat, i: number, loadW: number, dt: number): void {
  const world = heat.world;
  const model = heat.plan.models[i] as CduModel;
  const state = heat.states[i] as StateOf<"cdu">;
  const id = (heat.plan.ents[i] as Entity).id;
  const failedPumps = faultsAt(heat, i)
    .filter((f) => f.type === "cdu_pump_failure")
    .reduce((n, f) => n + (f.params.pumps ?? 1), 0);
  const pumpsOk = Array.from({ length: model.pumps }, (_, k) => k >= failedPumps);
  const running =
    state.powered && state.adminOn && !fault(world, id, "cdu_failure") && !leakIsolated(world, id);
  const duty = Math.max(1, model.pumps - 1);
  // a CDU with manual standby (REQ-107) lets its last pump idle until an operator starts it (`cdu_pump_switch`)
  const manual = (heat.plan.ents[i] as Entity).props.manualStandby === true && !state.standbyOn;
  const working = manual ? pumpsOk.slice(0, duty) : pumpsOk;
  const pumpFactor = running ? Math.min(1, working.filter(Boolean).length / duty) : 0;
  const capacityKw = model.capacityKw * pumpFactor * plantAvailabilityAt(heat, i);
  const loadKw = running ? loadW / 1000 : 0;
  const loopJPerK = model.loopLitres * WATER_J_PER_L_K;
  let supplyC: number;
  if (!running) supplyC = approach(state.supplyC, 45, dt, 900);
  else if (loadKw > capacityKw)
    supplyC = Math.min(
      MAX_LOOP_C,
      state.supplyC + (((loadKw - capacityKw) * 1000) / loopJPerK) * dt,
    );
  else supplyC = approach(state.supplyC, state.setpointC, dt, 45);
  const spread = capacityKw > 0 ? 10 * clamp(loadKw / capacityKw, 0, 1.5) : 0;
  Object.assign(state, {
    running,
    pumpsOk,
    loadKw,
    capacityKw,
    supplyC,
    returnC: supplyC + spread,
  });
}

// ---------- chillers ----------

/** Water keeps circulating through a stopped plant's loop, so its buffer takes its share of the heat. */
function share(heat: Heat, loads: Float64Array, consumer: number, kw: number): void {
  const { start, items } = heat.t.plants;
  const first = start[consumer] as number;
  const last = start[consumer + 1] as number;
  for (let q = first; q < last; q++) {
    const plant = items[q] as number;
    loads[plant] = (loads[plant] as number) + kw / (last - first);
  }
}

/** Heat each running plant carries away: CDUs, chilled-water cooling units, and rear-door racks wired to it. */
function plantLoadsKw(heat: Heat): Float64Array {
  const loads = new Float64Array(heat.plan.ents.length);
  const { start } = heat.t.plants;
  for (const cdu of heat.t.cdus)
    share(heat, loads, cdu, (heat.states[cdu] as StateOf<"cdu">).loadKw);
  for (const unit of heat.t.coolingUnits)
    if ((heat.plan.models[unit] as CoolingModel).chilledWater)
      share(heat, loads, unit, (heat.states[unit] as StateOf<"cooling_unit">).loadKw);
  for (const rack of heat.t.racks)
    if ((start[rack + 1] as number) > (start[rack] as number))
      share(heat, loads, rack, (heat.states[rack] as StateOf<"rack">).liquidW / 1000);
  return loads;
}

function updateChiller(heat: Heat, i: number, loadKw: number, dt: number): void {
  const model = heat.plan.models[i] as ChillerModel;
  const state = heat.states[i] as StateOf<"chiller">;
  const faults = faultsAt(heat, i);
  const running = state.powered && state.adminOn && !hasFault(faults, "chiller_failure");
  const factor = faultParam(faults, "chiller_degraded", "factor") ?? 1;
  const capacityKw = running
    ? model.capacityKw * factor * ambientDerate(model.plant, heat.world.outdoorC())
    : 0;
  const bufferJPerK = model.bufferM3 * 1000 * WATER_J_PER_L_K;
  let supplyC: number;
  if (running && loadKw <= capacityKw)
    supplyC = approach(state.supplyC, model.supplySetpointC, dt, 60);
  else
    supplyC = Math.min(
      MAX_LOOP_C,
      state.supplyC + ((loadKw * 1000 - capacityKw * 1000) / bufferJPerK) * dt,
    );
  const spread = capacityKw > 0 ? 6 * clamp(loadKw / capacityKw, 0, 1.5) : 6;
  Object.assign(state, {
    running,
    loadKw,
    capacityKw,
    supplyC,
    returnC: supplyC + spread,
    powerW: running ? model.powerPerKw * loadKw * 1000 + 0.01 * model.capacityKw * 1000 : 0,
  });
}

/** One step of the plant: heat from the racks reaches the CDUs, then the chillers behind them. */
export function updatePlant(world: World, dt: number): void {
  const heat = heatOf(world);
  const cduLoads = cduLoadsW(heat);
  for (const cdu of heat.t.cdus) updateCdu(heat, cdu, cduLoads[cdu] as number, dt);
  const loads = plantLoadsKw(heat);
  for (const plant of heat.t.chillers) updateChiller(heat, plant, loads[plant] as number, dt);
}
