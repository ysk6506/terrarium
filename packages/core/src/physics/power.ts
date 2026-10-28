/**
 * Electrical model: which equipment has power, how much each draws, and how load adds up the chain
 * UPS -> panel -> PDU -> device. Devices with two feeds stay up while either supplier has power.
 */
import { panelCapacityW } from "@terrarium/core/catalog";
import { clamp } from "@terrarium/core/kernel";
import type { Entity, World } from "@terrarium/core/world";

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
    return links.length === 0 || links.some((l) => this.delivers(l.to));
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

  private compute(id: string): boolean {
    const state = this.world.stateOf(id);
    if (state.kind === "ups") return state.inputOk || state.batteryPct > 0;
    if (state.kind === "power_panel" || state.kind === "pdu") return !state.tripped && this.fed(id);
    return false;
  }
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

/** Power drawn by a consumer, in watts (cooling units draw fans plus compressor work). */
export function drawW(world: World, id: string): number {
  const state = world.stateOf(id);
  if (state.kind === "server" || state.kind === "switch" || state.kind === "storage")
    return state.powerW;
  if (state.kind === "cooling_unit") {
    const model = world.catalog.getOf(world.index.entity(id).modelId ?? "", "cooling_unit");
    return state.running ? model.fanPowerW + (state.loadKw * 1000) / 3 : 0;
  }
  if (state.kind === "pdu" || state.kind === "power_panel") return state.loadW;
  return 0;
}

/** Add up loads supplier by supplier; a consumer with two live feeds splits its draw between them. */
export function aggregateLoads(world: World, supply: SupplyResolver): void {
  const order = ["pdu", "power_panel", "ups"] as const;
  for (const kind of order) {
    for (const supplier of world.index.ofKind(kind)) {
      let load = 0;
      for (const link of world.index.incoming(supplier.id, "power")) {
        const feeds = world.index.outgoing(link.from, "power").filter((l) => supply.delivers(l.to));
        if (feeds.some((l) => l.to === supplier.id)) load += drawW(world, link.from) / feeds.length;
      }
      if (kind === "ups") world.patch(supplier.id, "ups", { loadW: load });
      else if (kind === "pdu") world.patch(supplier.id, "pdu", { loadW: load });
      else {
        const model = world.catalog.getOf(supplier.modelId ?? "", "power_panel");
        world.patch(supplier.id, "power_panel", {
          loadW: load,
          loadA: load / (Math.sqrt(3) * model.voltage * POWER_FACTOR),
        });
      }
    }
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
