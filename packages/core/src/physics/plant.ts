/**
 * The plant outside the data halls (REQ-044): generators that take over when the utility fails,
 * coolant distribution units (CDU) that carry heat out of liquid-cooled racks, and chillers, dry
 * coolers and cooling towers that carry it away. Heat flows rack -> CDU -> plant; each stage has a
 * capacity and a water temperature that rises when the stage behind it cannot keep up.
 */
import { approach, clamp } from "@terrarium/core/kernel";
import type { Entity, World } from "@terrarium/core/world";
import { isTransferSwitch, type SupplyResolver } from "./power";

/** Outdoor air, °C: dry coolers and towers lose capacity as it warms. */
export const OUTDOOR_C = 25;
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
      model.fuelLitres,
    );
    world.patch(gen.id, "generator", { phase, startedFor, fuelPct });
  }
}

// ---------- shared helpers ----------

/** Plants a consumer draws water from; empty means "an implicit plant" (older worlds). */
const plantsOf = (world: World, id: string): Entity[] =>
  world.index
    .outgoing(id, "cooling")
    .map((l) => world.index.entity(l.to))
    .filter((e) => e.kind === "chiller");

/**
 * How much of its water a consumer gets from the plants behind it: 1 while the water is cold, less as
 * it warms. A stopped plant keeps cooling for a while on the water in its buffer, then fades out.
 */
export function plantAvailability(world: World, id: string): number {
  const plants = plantsOf(world, id);
  if (plants.length === 0) return 1;
  let sum = 0;
  for (const plant of plants) {
    const s = world.stateAs(plant.id, "chiller");
    const model = world.catalog.getOf(plant.modelId ?? "", "chiller");
    sum += clamp(1 - Math.max(0, s.supplyC - model.supplySetpointC - 1) / 8, 0, 1);
  }
  return sum / plants.length;
}

function ambientDerate(plant: "chiller" | "dry_cooler" | "cooling_tower"): number {
  if (plant === "dry_cooler") return clamp(1.1 - 0.01 * (OUTDOOR_C - 15), 0.3, 1);
  if (plant === "cooling_tower") return clamp(1.04 - 0.004 * (OUTDOOR_C - 15), 0.5, 1);
  return 1;
}

// ---------- CDUs ----------

/** Whether coolant is still flowing into a rack: its CDU is running and no leak has been isolated. */
export function leakIsolated(world: World, id: string): boolean {
  const leak = fault(world, id, "coolant_leak");
  return leak !== undefined && world.time() - leak.since >= (leak.params.shutoffSeconds ?? 120);
}

/** Heat each running CDU carries away, from the liquid racks linked to it, W. */
function cduLoadsW(world: World): Map<string, number> {
  const loads = new Map<string, number>();
  for (const rack of world.index.ofKind("rack")) {
    const liquidW = world.stateAs(rack.id, "rack").liquidW;
    if (liquidW <= 0) continue;
    const serving = world.index
      .outgoing(rack.id, "cooling")
      .map((l) => l.to)
      .filter((id) => world.index.entity(id).kind === "cdu" && world.stateAs(id, "cdu").running);
    for (const id of serving) loads.set(id, (loads.get(id) ?? 0) + liquidW / serving.length);
  }
  return loads;
}

function updateCdu(world: World, cdu: Entity, loadW: number, dt: number): void {
  const model = world.catalog.getOf(cdu.modelId ?? "", "cdu");
  const state = world.stateAs(cdu.id, "cdu");
  const failedPumps = world
    .faultsOn(cdu.id)
    .filter((f) => f.type === "cdu_pump_failure")
    .reduce((n, f) => n + (f.params.pumps ?? 1), 0);
  const pumpsOk = Array.from({ length: model.pumps }, (_, i) => i >= failedPumps);
  const running =
    state.powered &&
    state.adminOn &&
    !fault(world, cdu.id, "cdu_failure") &&
    !leakIsolated(world, cdu.id);
  const duty = Math.max(1, model.pumps - 1);
  const pumpFactor = running ? Math.min(1, pumpsOk.filter(Boolean).length / duty) : 0;
  const capacityKw = model.capacityKw * pumpFactor * plantAvailability(world, cdu.id);
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
  world.patch(cdu.id, "cdu", {
    running,
    pumpsOk,
    loadKw,
    capacityKw,
    supplyC,
    returnC: supplyC + spread,
  });
}

// ---------- chillers ----------

/** Heat each running plant carries away: CDUs, chilled-water cooling units, and rear-door racks wired to it. */
function plantLoadsKw(world: World): Map<string, number> {
  const loads = new Map<string, number>();
  // Water keeps circulating through a stopped plant's loop, so its buffer takes its share of the heat.
  const share = (consumerId: string, kw: number) => {
    const serving = plantsOf(world, consumerId);
    for (const p of serving) loads.set(p.id, (loads.get(p.id) ?? 0) + kw / serving.length);
  };
  for (const cdu of world.index.ofKind("cdu")) share(cdu.id, world.stateAs(cdu.id, "cdu").loadKw);
  for (const unit of world.index.ofKind("cooling_unit")) {
    const model = world.catalog.getOf(unit.modelId ?? "", "cooling_unit");
    if (model.chilledWater) share(unit.id, world.stateAs(unit.id, "cooling_unit").loadKw);
  }
  for (const rack of world.index.ofKind("rack"))
    if (plantsOf(world, rack.id).length > 0)
      share(rack.id, world.stateAs(rack.id, "rack").liquidW / 1000);
  return loads;
}

function updateChiller(world: World, plant: Entity, loadKw: number, dt: number): void {
  const model = world.catalog.getOf(plant.modelId ?? "", "chiller");
  const state = world.stateAs(plant.id, "chiller");
  const running = state.powered && state.adminOn && !fault(world, plant.id, "chiller_failure");
  const factor = fault(world, plant.id, "chiller_degraded")?.params.factor ?? 1;
  const capacityKw = running ? model.capacityKw * factor * ambientDerate(model.plant) : 0;
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
  world.patch(plant.id, "chiller", {
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
  const cduLoads = cduLoadsW(world);
  for (const cdu of world.index.ofKind("cdu")) updateCdu(world, cdu, cduLoads.get(cdu.id) ?? 0, dt);
  const loads = plantLoadsKw(world);
  for (const plant of world.index.ofKind("chiller"))
    updateChiller(world, plant, loads.get(plant.id) ?? 0, dt);
}
