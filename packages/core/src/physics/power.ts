/**
 * Electrical model: which equipment has power, how much each draws, and how load adds up the chain
 * UPS -> panel -> PDU -> device. Devices with two feeds stay up while either supplier has power.
 */
import { panelCapacityW } from "@terrarium/core/catalog";
import { clamp } from "@terrarium/core/kernel";
import type { Entity, StateOf, World } from "@terrarium/core/world";

export const POWER_FACTOR = 0.95;

const hasFault = (world: World, id: string, type: string) =>
  world.faultsOn(id).some((f) => f.type === type);

/** Whether a supplier delivers power to what is connected to it. Memoised per step, cycle-safe. */
export class SupplyResolver {
  private readonly memo = new Map<string, boolean>();
  private readonly visiting = new Set<string>();

  constructor(private readonly world: World) {}

  /** A consumer is fed when it has no power links (assumed utility) or any supplier delivers. */
  fed(id: string): boolean {
    const links = this.world.index.outgoing(id, "power");
    if (links.length === 0) return !hasFault(this.world, id, "utility_outage");
    return links.some((l) => this.delivers(l.to));
  }

  delivers(id: string): boolean {
    const known = this.memo.get(id);
    if (known !== undefined) return known;
    if (this.visiting.has(id)) return false;
    this.visiting.add(id);
    const result = this.compute(id);
    this.visiting.delete(id);
    this.memo.set(id, result);
    return result;
  }

  /** Whether the utility side of a transfer switch (its non-generator source) is live. */
  utilityOk(id: string): boolean {
    if (hasFault(this.world, id, "utility_outage")) return false;
    const upstream = this.world.index
      .outgoing(id, "power")
      .filter((l) => this.world.index.entity(l.to).kind !== "generator");
    return upstream.length === 0 || upstream.some((l) => this.delivers(l.to));
  }

  /** The suppliers that actually carry a consumer's load right now: a transfer switch uses one source. */
  activeFeeds(id: string): string[] {
    const links = this.world.index.outgoing(id, "power");
    if (!isTransferSwitch(this.world, id))
      return links.filter((l) => this.delivers(l.to)).map((l) => l.to);
    if (this.utilityOk(id)) {
      const upstream = links.filter((l) => this.world.index.entity(l.to).kind !== "generator");
      return upstream.length === 0
        ? []
        : upstream.filter((l) => this.delivers(l.to)).map((l) => l.to);
    }
    if (hasFault(this.world, id, "ats_stuck")) return [];
    const backup = links.find(
      (l) => this.world.index.entity(l.to).kind === "generator" && this.delivers(l.to),
    );
    return backup ? [backup.to] : [];
  }

  private compute(id: string): boolean {
    const state = this.world.stateOf(id);
    if (state.kind === "ups")
      return (this.fed(id) && !hasFault(this.world, id, "grid_outage")) || state.batteryPct > 0;
    if (state.kind === "generator") return state.phase === "running";
    if (state.kind === "pdu") return !state.tripped && this.fed(id);
    if (state.kind === "power_panel") return !state.tripped && this.panelFed(id);
    return false;
  }

  private panelFed(id: string): boolean {
    if (!isTransferSwitch(this.world, id)) return this.fed(id);
    if (this.utilityOk(id)) return true;
    if (hasFault(this.world, id, "ats_stuck")) return false;
    return this.world.index
      .outgoing(id, "power")
      .some((l) => this.world.index.entity(l.to).kind === "generator" && this.delivers(l.to));
  }
}

/** A power panel of style "ats": it picks the utility side, else a generator. */
export function isTransferSwitch(world: World, id: string): boolean {
  const entity = world.index.entity(id);
  if (entity.kind !== "power_panel" || !entity.modelId || !world.catalog.has(entity.modelId))
    return false;
  const model = world.catalog.get(entity.modelId);
  return model.kind === "power_panel" && model.style === "ats";
}

/** A VM's CPU demand (0..1 of its vCPUs), including a vm_cpu_spike. */
export function vmDemand(world: World, vmId: string): number {
  const spike = world.faultsOn(vmId).find((f) => f.type === "vm_cpu_spike")?.params.demand ?? 0;
  return Math.max(world.stateAs(vmId, "vm").cpuDemand, spike);
}

/** Effective CPU utilisation of a server: its own load, its VMs' demand and any runaway process. */
export function effectiveUtil(world: World, server: Entity): number {
  const state = world.stateAs(server.id, "server");
  const model = world.catalog.getOf(server.modelId ?? "", "server");
  const cores = model.cpuSockets * model.coresPerSocket;
  let vmLoad = 0;
  for (const link of world.index.incoming(server.id, "runs_on")) {
    const vcpus = Number(world.index.entity(link.from).props.cpuCount ?? 4);
    if (world.stateAs(link.from, "vm").running) vmLoad += vmDemand(world, link.from) * vcpus;
  }
  const runaway = world.faultsOn(server.id).find((f) => f.type === "cpu_runaway")?.params.util ?? 0;
  const util = Math.max(state.cpuUtil + vmLoad / cores, runaway);
  return clamp(state.throttled ? Math.min(util, 0.7) : util, 0, 1);
}

type Updater = (world: World, entity: Entity, supply: SupplyResolver) => void;

const updateServer: Updater = (world, entity, supply) => {
  const id = entity.id;
  const model = world.catalog.getOf(entity.modelId ?? "", "server");
  const psuFaults = world.faultsOn(id).filter((f) => f.type === "psu_failure");
  const psuOk = Array.from(
    { length: model.psuCount },
    (_, i) => !psuFaults.some((f) => (f.params.psuIndex ?? 0) === i),
  );
  const powered = supply.fed(id) && psuOk.some(Boolean);
  const running = powered && world.stateAs(id, "server").adminOn;
  const util = effectiveUtil(world, entity);
  world.patch(id, "server", {
    powered,
    psuOk,
    powerW: running ? model.idlePowerW + (model.maxPowerW - model.idlePowerW) * util : 0,
  });
};

const updateSwitch: Updater = (world, entity, supply) => {
  const model = world.catalog.getOf(entity.modelId ?? "", "switch");
  const powered = supply.fed(entity.id);
  const running =
    powered &&
    world.stateAs(entity.id, "switch").adminOn &&
    !hasFault(world, entity.id, "switch_failure");
  world.patch(entity.id, "switch", { powered, powerW: running ? model.powerW : 0 });
};

const updateStorage: Updater = (world, entity, supply) => {
  const model = world.catalog.getOf(entity.modelId ?? "", "storage");
  const powered = supply.fed(entity.id);
  const failed = world
    .faultsOn(entity.id)
    .filter((f) => f.type === "disk_failure")
    .reduce((n, f) => n + (f.params.disks ?? 1), 0);
  const on = powered && world.stateAs(entity.id, "storage").adminOn;
  world.patch(entity.id, "storage", {
    powered,
    failedDisks: Math.min(failed, model.disks),
    powerW: on ? model.powerW : 0,
  });
};

const updateCooling: Updater = (world, entity, supply) => {
  const powered = supply.fed(entity.id);
  const running =
    powered &&
    world.stateAs(entity.id, "cooling_unit").adminOn &&
    !hasFault(world, entity.id, "cooling_unit_failure");
  world.patch(entity.id, "cooling_unit", { powered, running });
};

/** Mains reach the UPS only through whatever feeds it; a grid_outage fault cuts them too. */
const updateUps: Updater = (world, entity, supply) => {
  const inputOk = supply.fed(entity.id) && !hasFault(world, entity.id, "grid_outage");
  world.patch(entity.id, "ups", { inputOk });
};

/** Pumps and compressors only need to be fed; whether they run is the plant model's call. */
const updatePlantFeed: Updater = (world, entity, supply) => {
  if (entity.kind === "cdu" || entity.kind === "chiller")
    world.patch(entity.id, entity.kind, { powered: supply.fed(entity.id) });
};

const updateDistribution: Updater = (world, entity, supply) => {
  if (entity.kind === "pdu" || entity.kind === "power_panel")
    world.patch(entity.id, entity.kind, { powered: supply.delivers(entity.id) });
};

const UPDATERS: Partial<Record<Entity["kind"], Updater>> = {
  server: updateServer,
  switch: updateSwitch,
  storage: updateStorage,
  cooling_unit: updateCooling,
  pdu: updateDistribution,
  power_panel: updateDistribution,
  ups: updateUps,
  cdu: updatePlantFeed,
  chiller: updatePlantFeed,
};

/** Update `powered`, running flags and the power each device draws; then VMs follow their hosts. */
export function updateDevices(world: World, supply: SupplyResolver): void {
  for (const entity of world.index.all()) UPDATERS[entity.kind]?.(world, entity, supply);
  for (const vm of world.index.ofKind("vm")) {
    const host = world.index.outgoing(vm.id, "runs_on")[0];
    const hostState = host ? world.stateAs(host.to, "server") : undefined;
    const hostUp = hostState ? hostState.powered && hostState.adminOn : true;
    const running = world.stateAs(vm.id, "vm").adminOn && hostUp;
    // A throttled host caps what its VMs get, as it caps the host itself (see effectiveUtil).
    const demand = vmDemand(world, vm.id);
    const cpuUsage = running ? (hostState?.throttled ? Math.min(demand, 0.7) : demand) : 0;
    world.patch(vm.id, "vm", { running, cpuUsage });
  }
}

/** Power drawn by a cooling unit: its fans plus compressor work (a chilled-water unit has none: the plant pays). */
function coolingDrawW(world: World, id: string, state: StateOf<"cooling_unit">): number {
  const model = world.catalog.getOf(world.index.entity(id).modelId ?? "", "cooling_unit");
  const work = model.chilledWater ? 0 : (state.loadKw * 1000) / 3;
  return state.running ? model.fanPowerW + work : 0;
}

/** Power drawn by a CDU: one pump's worth for each pump that runs. */
function cduDrawW(world: World, id: string, state: StateOf<"cdu">): number {
  const model = world.catalog.getOf(world.index.entity(id).modelId ?? "", "cdu");
  return state.running ? model.pumpPowerW * state.pumpsOk.filter(Boolean).length : 0;
}

/** Power drawn by a consumer, in watts. */
export function drawW(world: World, id: string): number {
  const state = world.stateOf(id);
  switch (state.kind) {
    case "server":
    case "switch":
    case "storage":
    case "chiller":
      return state.powerW;
    case "cooling_unit":
      return coolingDrawW(world, id, state);
    case "cdu":
      return cduDrawW(world, id, state);
    case "pdu":
    case "power_panel":
      return state.loadW;
    default:
      return 0;
  }
}

/** What a supplier takes from its own upstream: a UPS also pays for its losses. */
function upstreamW(world: World, id: string, loadW: number): number {
  const entity = world.index.entity(id);
  if (entity.kind !== "ups") return loadW;
  return loadW / world.catalog.getOf(entity.modelId ?? "", "ups").efficiency;
}

const SUPPLIER_KINDS = ["pdu", "power_panel", "ups", "generator"] as const;

/**
 * Add up loads supplier by supplier, from the devices up the chain; a consumer with two live feeds
 * splits its draw between them, and a transfer switch loads only the source it is on.
 */
export function aggregateLoads(world: World, supply: SupplyResolver): void {
  const memo = new Map<string, number>();
  const loadOn = (id: string): number => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    memo.set(id, 0); // cycle guard
    let load = 0;
    for (const link of world.index.incoming(id, "power")) {
      const feeds = supply.activeFeeds(link.from);
      if (!feeds.includes(id)) continue;
      const kind = world.index.entity(link.from).kind;
      const demand = (SUPPLIER_KINDS as readonly string[]).includes(kind)
        ? upstreamW(world, link.from, loadOn(link.from))
        : drawW(world, link.from);
      load += demand / feeds.length;
    }
    memo.set(id, load);
    return load;
  };
  for (const kind of SUPPLIER_KINDS)
    for (const supplier of world.index.ofKind(kind))
      patchLoad(world, supplier, loadOn(supplier.id));
}

function patchLoad(world: World, supplier: Entity, load: number): void {
  if (supplier.kind === "ups") world.patch(supplier.id, "ups", { loadW: load });
  else if (supplier.kind === "pdu") world.patch(supplier.id, "pdu", { loadW: load });
  else if (supplier.kind === "generator")
    world.patch(supplier.id, "generator", { loadKw: load / 1000 });
  else {
    const model = world.catalog.getOf(supplier.modelId ?? "", "power_panel");
    world.patch(supplier.id, "power_panel", {
      loadW: load,
      loadA: load / (Math.sqrt(3) * model.voltage * POWER_FACTOR),
    });
  }
}

/** Capacity of a breaker-protected supplier in watts. */
export function capacityW(world: World, id: string): number {
  const entity = world.index.entity(id);
  if (entity.kind === "pdu") return world.catalog.getOf(entity.modelId ?? "", "pdu").capacityW;
  return panelCapacityW(world.catalog.getOf(entity.modelId ?? "", "power_panel"));
}

/** Drain or recharge UPS batteries. */
export function updateBatteries(world: World, dt: number): void {
  for (const ups of world.index.ofKind("ups")) {
    const state = world.stateAs(ups.id, "ups");
    const model = world.catalog.getOf(ups.modelId ?? "", "ups");
    const factor =
      world.faultsOn(ups.id).find((f) => f.type === "ups_battery_degraded")?.params.factor ?? 1;
    const capacityWs = model.batteryKwh * 1000 * 3600 * factor;
    const delta = state.inputOk ? 0.05 * dt : -((state.loadW * dt) / capacityWs) * 100;
    world.patch(ups.id, "ups", {
      onBattery: !state.inputOk,
      batteryPct: clamp(state.batteryPct + delta, 0, 100),
    });
  }
}
