/**
 * Electrical model: which equipment has power, how much each draws, and how load adds up the chain
 * UPS -> panel -> PDU -> device. Devices with two feeds stay up while either supplier has power.
 *
 * Every step walks every device, so the walks go by position in the blueprint's entity list (see
 * power-plan.ts) over the world's state list, not by id. The arithmetic and the order of the sums are
 * the same as when this was written by id; `tests/spec/physics-golden.test.ts` holds the results bit for bit.
 */
import type {
  CduModel,
  CoolingModel,
  PanelModel,
  ServerModel,
  StorageModel,
  SwitchModel,
  UpsModel,
} from "@terrarium/core/catalog";
import { clamp, NotFoundError } from "@terrarium/core/kernel";
import {
  bulkPowerW,
  type Entity,
  type EntityState,
  type Fault,
  type StateOf,
  type World,
} from "@terrarium/core/world";
import { type PowerPlan, powerPlanOf, SLOT, SUPPLIER_KINDS } from "./power-plan";
import { faultParam, hasFault, isTransferSwitch, SupplyResolver } from "./power-supply";
import { cutDarkSites } from "./site-power";

export { isTransferSwitch, SupplyResolver };

export const POWER_FACTOR = 0.95;

/** The world as the electrical passes read it. */
export interface Pass {
  readonly plan: PowerPlan;
  readonly states: readonly EntityState[];
  readonly faults: ReadonlyArray<readonly Fault[]>;
  /** VMs an operator moved to another server: the VM's position and its new host's (absent while none was moved). */
  readonly moves?: ReadonlyMap<number, number> | undefined;
}

export const passOf = (world: World): Pass => ({
  plan: powerPlanOf(world.index, world.catalog),
  states: world.stateList(),
  faults: world.faultList(),
  moves: world.vmMoves(),
});

const positionOf = (world: World, id: string): number => {
  const at = world.index.positionOf(id);
  if (at === undefined) throw new NotFoundError(`no entity '${id}' in this world`);
  return at;
};

// ---------- servers and VMs ----------

/** A VM's CPU demand (0..1 of its vCPUs), including a vm_cpu_spike. */
function vmDemandAt(pass: Pass, v: number): number {
  const spike = faultParam(pass.faults[v] as readonly Fault[], "vm_cpu_spike", "demand") ?? 0;
  return Math.max((pass.states[v] as StateOf<"vm">).cpuDemand, spike);
}

export function vmDemand(world: World, vmId: string): number {
  return vmDemandAt(passOf(world), positionOf(world, vmId));
}

export function effectiveUtilAt(pass: Pass, i: number): number {
  const { plan, states, faults } = pass;
  const state = states[i] as StateOf<"server">;
  let vmLoad = 0;
  const to = plan.vmStart[i + 1] as number;
  for (let q = plan.vmStart[i] as number; q < to; q++) {
    const v = plan.vmOn[q] as number;
    if (pass.moves?.has(v)) continue; // moved away
    if ((states[v] as StateOf<"vm">).running)
      vmLoad += vmDemandAt(pass, v) * (plan.vcpus[v] as number);
  }
  if (pass.moves)
    for (const [v, host] of pass.moves)
      if (host === i && (states[v] as StateOf<"vm">).running)
        vmLoad += vmDemandAt(pass, v) * (plan.vcpus[v] as number);
  const runaway = faultParam(faults[i] as readonly Fault[], "cpu_runaway", "util") ?? 0;
  const util = Math.max(state.cpuUtil + vmLoad / (plan.cores[i] as number), runaway);
  return clamp(state.throttled ? Math.min(util, 0.7) : util, 0, 1);
}

/** Effective CPU utilisation of a server: its own load, its VMs' demand and any runaway process. */
export function effectiveUtil(world: World, server: Entity): number {
  return effectiveUtilAt(passOf(world), positionOf(world, server.id));
}

// ---------- device updates ----------

type Updater = (sup: SupplyResolver, i: number) => void;

const psuFailed = (list: readonly Fault[], k: number): boolean => {
  for (const f of list) if (f.type === "psu_failure" && (f.params.psuIndex ?? 0) === k) return true;
  return false;
};

/** The per-PSU state of a server, reusing the list it had when nothing changed. */
function psuStates(list: readonly Fault[], count: number, before: boolean[]): boolean[] {
  let same = before.length === count;
  for (let k = 0; same && k < count; k++) same = before[k] === !psuFailed(list, k);
  return same ? before : Array.from({ length: count }, (_, k) => !psuFailed(list, k));
}

const updateServer: Updater = (sup, i) => {
  const { plan, states, faults } = sup;
  const model = plan.models[i] as ServerModel;
  const state = states[i] as StateOf<"server">;
  const psuOk = psuStates(faults[i] as readonly Fault[], model.psuCount, state.psuOk);
  const powered = sup.fedAt(i) && psuOk.some(Boolean);
  const running = powered && state.adminOn;
  const util = effectiveUtilAt(sup, i);
  state.powered = powered;
  state.psuOk = psuOk;
  state.powerW = running ? model.idlePowerW + (model.maxPowerW - model.idlePowerW) * util : 0;
};

/** A light rack draws what its servers add up to while it is fed; losing its feeds darkens all of them. */
const updateLightRack: Updater = (sup, i) => {
  const light = sup.plan.light[i];
  if (!light) return;
  const state = sup.states[i] as StateOf<"rack">;
  const powered = sup.fedAt(i);
  state.powered = powered;
  state.powerW = powered ? bulkPowerW(light, sup.plan.models[i] as ServerModel, state.util) : 0;
};

const updateSwitch: Updater = (sup, i) => {
  const model = sup.plan.models[i] as SwitchModel;
  const state = sup.states[i] as StateOf<"switch">;
  const powered = sup.fedAt(i);
  const running =
    powered && state.adminOn && !hasFault(sup.faults[i] as readonly Fault[], "switch_failure");
  state.powered = powered;
  state.powerW = running ? model.powerW : 0;
};

const updateStorage: Updater = (sup, i) => {
  const model = sup.plan.models[i] as StorageModel;
  const state = sup.states[i] as StateOf<"storage">;
  const powered = sup.fedAt(i);
  let failed = 0;
  for (const f of sup.faults[i] as readonly Fault[])
    if (f.type === "disk_failure") failed += f.params.disks ?? 1;
  state.powered = powered;
  state.failedDisks = Math.min(failed, model.disks);
  state.powerW = powered && state.adminOn ? model.powerW : 0;
};

const updateCooling: Updater = (sup, i) => {
  const state = sup.states[i] as StateOf<"cooling_unit">;
  const powered = sup.fedAt(i);
  state.powered = powered;
  state.running =
    powered &&
    state.adminOn &&
    !hasFault(sup.faults[i] as readonly Fault[], "cooling_unit_failure");
};

/** Mains reach the UPS only through whatever feeds it; a grid_outage fault cuts them too. */
const updateUps: Updater = (sup, i) => {
  const state = sup.states[i] as StateOf<"ups">;
  state.inputOk = sup.fedAt(i) && !hasFault(sup.faults[i] as readonly Fault[], "grid_outage");
};

/** Pumps and compressors only need to be fed; whether they run is the plant model's call. */
const updatePlantFeed: Updater = (sup, i) => {
  (sup.states[i] as StateOf<"cdu"> | StateOf<"chiller">).powered = sup.fedAt(i);
};

const updateDistribution: Updater = (sup, i) => {
  (sup.states[i] as StateOf<"pdu"> | StateOf<"power_panel">).powered = sup.deliversAt(i);
};

const BY_SLOT: Updater[] = [];
BY_SLOT[SLOT.server] = updateServer;
BY_SLOT[SLOT.rack] = updateLightRack;
BY_SLOT[SLOT.switch] = updateSwitch;
BY_SLOT[SLOT.storage] = updateStorage;
BY_SLOT[SLOT.cooling] = updateCooling;
BY_SLOT[SLOT.ups] = updateUps;
BY_SLOT[SLOT.plantFeed] = updatePlantFeed;
BY_SLOT[SLOT.distribution] = updateDistribution;

function updateVms(sup: SupplyResolver): void {
  const { plan, states } = sup;
  for (const v of plan.vms) {
    const host = sup.moves?.get(v) ?? (plan.vmHost[v] as number);
    const hostState = host >= 0 ? (states[host] as StateOf<"server">) : undefined;
    const hostUp = hostState ? hostState.powered && hostState.adminOn : true;
    const state = states[v] as StateOf<"vm">;
    const running = state.adminOn && hostUp;
    // A throttled host caps what its VMs get, as it caps the host itself (see effectiveUtil).
    const demand = vmDemandAt(sup, v);
    state.running = running;
    state.cpuUsage = running ? (hostState?.throttled ? Math.min(demand, 0.7) : demand) : 0;
  }
}

/** Update `powered`, running flags and the power each device draws; then VMs follow their hosts. */
export function updateDevices(world: World, supply: SupplyResolver): void {
  const { plan } = supply;
  for (const i of plan.active) (BY_SLOT[plan.slot[i] as number] as Updater)(supply, i);
  cutDarkSites(world, supply);
  updateVms(supply);
}

// ---------- loads ----------

/** Power drawn by a cooling unit: its fans plus compressor work (a chilled-water unit has none: the plant pays). */
function coolingDrawW(model: CoolingModel, state: StateOf<"cooling_unit">): number {
  const work = model.chilledWater ? 0 : (state.loadKw * 1000) / 3;
  return state.running ? model.fanPowerW + work : 0;
}

/** Power drawn by a CDU: one pump's worth for each pump that runs. */
function cduDrawW(model: CduModel, state: StateOf<"cdu">): number {
  return state.running ? model.pumpPowerW * state.pumpsOk.filter(Boolean).length : 0;
}

function drawAt(pass: Pass, i: number): number {
  const state = pass.states[i] as EntityState;
  const model = pass.plan.models[i];
  switch (state.kind) {
    case "server":
    case "switch":
    case "storage":
    case "rack":
    case "chiller":
      return state.powerW;
    case "cooling_unit":
      return coolingDrawW(model as CoolingModel, state);
    case "cdu":
      return cduDrawW(model as CduModel, state);
    case "pdu":
    case "power_panel":
      return state.loadW;
    default:
      return 0;
  }
}

/** Power drawn by a consumer, in watts. */
export function drawW(world: World, id: string): number {
  return drawAt(passOf(world), positionOf(world, id));
}

/** Adds up what each supplier carries, from the devices up the chain. */
class Loads {
  private readonly done: Uint8Array;
  private readonly load: Float64Array;
  private readonly pass: Pass;

  constructor(private readonly supply: SupplyResolver) {
    const n = supply.plan.ents.length;
    this.done = new Uint8Array(n);
    this.load = new Float64Array(n);
    this.pass = supply;
  }

  /** What supplier `i` carries; a consumer with two live feeds splits its draw between them. */
  on(i: number): number {
    if (this.done[i] === 1) return this.load[i] as number;
    this.done[i] = 1; // cycle guard
    const { supply } = this;
    const { plan } = supply;
    let load = 0;
    const to = plan.inStart[i + 1] as number;
    for (let q = plan.inStart[i] as number; q < to; q++) {
      const from = plan.inFrom[q] as number;
      if (!supply.feeds(from, i)) continue;
      load += this.demandOf(from) / supply.feedCount(from);
    }
    this.load[i] = load;
    return load;
  }

  private demandOf(from: number): number {
    const kind = (this.supply.plan.ents[from] as Entity).kind;
    if (!SUPPLIER_KINDS.has(kind)) return drawAt(this.pass, from);
    const load = this.on(from);
    // A UPS also pays for its losses.
    return kind === "ups" ? load / (this.supply.plan.models[from] as UpsModel).efficiency : load;
  }
}

function patchLoad(pass: Pass, i: number, load: number): void {
  const state = pass.states[i] as EntityState;
  if (state.kind === "ups" || state.kind === "pdu") state.loadW = load;
  else if (state.kind === "generator") state.loadKw = load / 1000;
  else if (state.kind === "power_panel") {
    const model = pass.plan.models[i] as PanelModel;
    state.loadW = load;
    state.loadA = load / (Math.sqrt(3) * model.voltage * POWER_FACTOR);
  }
}

/**
 * Add up loads supplier by supplier, from the devices up the chain; a consumer with two live feeds
 * splits its draw between them, and a transfer switch loads only the source it is on.
 */
export function aggregateLoads(_world: World, supply: SupplyResolver): void {
  const loads = new Loads(supply);
  const { plan } = supply;
  for (const group of [plan.pdus, plan.panels, plan.upses, plan.generators])
    for (const i of group) patchLoad(supply, i, loads.on(i));
}

/** Capacity of a breaker-protected supplier in watts. */
export function capacityW(world: World, id: string): number {
  return powerPlanOf(world.index, world.catalog).capacity[positionOf(world, id)] as number;
}

/** Drain or recharge UPS batteries. */
export function updateBatteries(world: World, dt: number): void {
  const pass = passOf(world);
  for (const i of pass.plan.upses) {
    const state = pass.states[i] as StateOf<"ups">;
    const model = pass.plan.models[i] as UpsModel;
    const factor =
      faultParam(pass.faults[i] as readonly Fault[], "ups_battery_degraded", "factor") ?? 1;
    const capacityWs = model.batteryKwh * 1000 * 3600 * factor;
    const delta = state.inputOk ? 0.05 * dt : -((state.loadW * dt) / capacityWs) * 100;
    state.onBattery = !state.inputOk;
    state.batteryPct = clamp(state.batteryPct + delta, 0, 100);
  }
}
