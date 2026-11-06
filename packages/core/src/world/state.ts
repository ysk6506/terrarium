/** Dynamic state of the world: JSON-serialisable so it can be snapshotted and sent between threads. */
import type { Catalog, EquipmentModel } from "@terrarium/core/catalog";
import type { Entity, EntityKind } from "./blueprint";
import { bulkOf } from "./bulk";
import type { Fault } from "./faults";
import { type FirmwareJob, SHIPPED_FIRMWARE } from "./firmware";
import type { BlueprintIndex } from "./graph";
import type { NetPatch } from "./net-config";
import type { HostOs } from "./os";
import type { ServiceStatus } from "./service";

export type Health = "ok" | "warning" | "critical";

interface Base {
  health: Health;
}

export interface ServerState extends Base {
  kind: "server";
  adminOn: boolean;
  powered: boolean;
  cpuUtil: number;
  inletC: number;
  cpuC: number;
  fanRpm: number[];
  psuOk: boolean[];
  powerW: number;
  throttled: boolean;
  /** The operating system, once something needed it (see os.ts). */
  os?: HostOs;
  /** Firmware versions; the BMC says "shipped" until it is updated (the profile's own version shows then). */
  bmcVersion: string;
  biosVersion: string;
  /** Whether a firmware update has the server down for its reboot. */
  rebooting: boolean;
  /** The update under way, absent otherwise. */
  fw?: FirmwareJob;
  /** What the last update tried when it failed ("BIOS 2.4.1"); absent once an update has worked. */
  fwFailed?: string;
}
export interface SwitchState extends Base {
  kind: "switch";
  adminOn: boolean;
  powered: boolean;
  powerW: number;
}
export interface StorageState extends Base {
  kind: "storage";
  adminOn: boolean;
  powered: boolean;
  powerW: number;
  failedDisks: number;
  usedPct: number;
}
export interface PduState extends Base {
  kind: "pdu";
  powered: boolean;
  tripped: boolean;
  loadW: number;
  /** Outlets an operator switched off (`Outlet.PowerControl`), ascending, numbered from 1; absent when none. */
  outletsOff?: number[];
}
export interface PanelState extends Base {
  kind: "power_panel";
  powered: boolean;
  tripped: boolean;
  loadW: number;
  loadA: number;
}
export interface UpsState extends Base {
  kind: "ups";
  inputOk: boolean;
  onBattery: boolean;
  batteryPct: number;
  loadW: number;
}
export interface CoolingState extends Base {
  kind: "cooling_unit";
  adminOn: boolean;
  powered: boolean;
  running: boolean;
  setpointC: number;
  supplyC: number;
  returnC: number;
  loadKw: number;
  capacityKw: number;
}
export interface RackState extends Base {
  kind: "rack";
  inletC: number;
  outletC: number;
  powerW: number;
  /** Whether a light rack is fed (always true for a rack that holds its devices itself). */
  powered: boolean;
  /** Mean CPU load of a light rack's servers, 0..1. */
  util: number;
  /** Heat the liquid loop carries away, W (0 for an air-cooled rack). */
  liquidW: number;
  /** Coolant temperature at the rack, °C; 0 when the rack has no liquid loop. */
  coolantC: number;
  /** Fluid temperature in an immersion tank, °C; 0 for a rack. */
  bathC: number;
  /** The most servers of this rack that were rebooting for firmware at the same time. */
  rebootPeak: number;
}
export interface CduState extends Base {
  kind: "cdu";
  adminOn: boolean;
  powered: boolean;
  running: boolean;
  setpointC: number;
  /** Coolant sent to the racks and coming back, °C. */
  supplyC: number;
  returnC: number;
  loadKw: number;
  capacityKw: number;
  pumpsOk: boolean[];
}
export interface ChillerState extends Base {
  kind: "chiller";
  adminOn: boolean;
  powered: boolean;
  running: boolean;
  /** Water sent out and coming back, °C. */
  supplyC: number;
  returnC: number;
  loadKw: number;
  capacityKw: number;
  powerW: number;
}
export interface GeneratorState extends Base {
  kind: "generator";
  adminOn: boolean;
  /** standby: waiting for the grid to fail. starting: cranking. running: carrying load. failed: could not start. */
  phase: "standby" | "starting" | "running" | "failed";
  /** Seconds since the start signal while starting. */
  startedFor: number;
  fuelPct: number;
  loadKw: number;
}
export interface ContainmentState extends Base {
  kind: "containment";
  /** Mean air temperature at the rack fronts and backs inside, °C. */
  coldC: number;
  hotC: number;
}
export interface RoomState extends Base {
  kind: "room";
  ambientC: number;
}
export interface VmState extends Base {
  kind: "vm";
  adminOn: boolean;
  running: boolean;
  /** What the workload asks for (0..1 of its vCPUs); scenarios and load changes set this. */
  cpuDemand: number;
  /** What it actually uses after spikes and host throttling; physics computes this. */
  cpuUsage: number;
  memUtil: number;
  /** The server it runs on after a migration (`migrate_vm`); absent while it is where the blueprint put it. */
  hostId?: string;
  /** The operating system, once something needed it (see os.ts). */
  os?: HostOs;
}
/** A service (ADR-0091): its health is computed from what it runs on; `runsOn` and `standby` change on a failover. */
export interface ServiceState extends Base {
  kind: "service";
  status: ServiceStatus;
  /** Why it is not healthy, one short sentence each (empty while healthy). */
  reasons: string[];
  /** Where it runs now, and where it can be moved to. */
  runsOn: string[];
  standby: string[];
  /** Work waiting because the service did not run (batch), in the unit of its queue. */
  backlog: number;
  /** Money lost so far while it was down or slow, KRW (an estimate: the hourly figure is a guess). */
  lostKrw: number;
  /** World time it stopped being healthy, absent while healthy. */
  since?: number;
  /** Times the operator moved it to its standby. */
  failovers: number;
}
export interface PlainState extends Base {
  kind: "parcel" | "building" | "floor" | "vcenter" | "cluster" | "datastore";
}
/** A site; `outdoorC` is filled in when it is read (the outdoor air belongs to the whole world, see World.stateOf). */
export interface SiteState extends Base {
  kind: "site";
  outdoorC?: number;
}

export type EntityState =
  | ServerState
  | SwitchState
  | StorageState
  | PduState
  | PanelState
  | UpsState
  | CoolingState
  | RackState
  | CduState
  | ChillerState
  | GeneratorState
  | ContainmentState
  | RoomState
  | VmState
  | ServiceState
  | SiteState
  | PlainState;

export type StateOf<K extends EntityKind> = Extract<EntityState, { kind: K }>;

export interface Alarm {
  readonly id: string;
  readonly entityId: string;
  readonly code: string;
  /** Which part of the world raised it when that is not the equipment itself: a service, or a host's operating system. */
  readonly kind?: "service" | "os";
  readonly severity: "warning" | "critical";
  readonly message: string;
  readonly since: number;
}

export interface WorldState {
  t: number;
  entities: Record<string, EntityState>;
  /** `up` follows faults; `adminDown` names the ends an operator has shut (absent while none is). */
  links: Record<string, { up: boolean; adminDown?: { from?: true; to?: true } }>;
  faults: Record<string, Fault>;
  alarms: Record<string, Alarm>;
  /** What operators changed in the layer-2/3 configuration of a switch (REQ-064); absent while nobody has. */
  netconf?: Record<string, NetPatch>;
  /** Outdoor air, °C; absent means the default, so worlds that never change it keep their old snapshots and digests. */
  outdoorC?: number;
}

/** Outdoor air while no scenario has changed it, °C. */
export const DEFAULT_OUTDOOR_C = 25;

export const AMBIENT_C = 22;

type Factory = (model: EquipmentModel | undefined) => EntityState;

const FACTORIES: Partial<Record<EntityKind, Factory>> = {
  server: (model) => {
    const fans = model?.kind === "server" ? model.fanCount : 4;
    const psus = model?.kind === "server" ? model.psuCount : 2;
    return {
      kind: "server",
      health: "ok",
      adminOn: true,
      powered: true,
      cpuUtil: 0.3,
      inletC: AMBIENT_C,
      cpuC: 45,
      fanRpm: Array(fans).fill(6000),
      psuOk: Array(psus).fill(true),
      powerW: 0,
      throttled: false,
      bmcVersion: SHIPPED_FIRMWARE.bmc,
      biosVersion: SHIPPED_FIRMWARE.bios,
      rebooting: false,
    };
  },
  switch: () => ({ kind: "switch", health: "ok", adminOn: true, powered: true, powerW: 0 }),
  storage: () => ({
    kind: "storage",
    health: "ok",
    adminOn: true,
    powered: true,
    powerW: 0,
    failedDisks: 0,
    usedPct: 62,
  }),
  pdu: () => ({ kind: "pdu", health: "ok", powered: true, tripped: false, loadW: 0 }),
  power_panel: () => ({
    kind: "power_panel",
    health: "ok",
    powered: true,
    tripped: false,
    loadW: 0,
    loadA: 0,
  }),
  ups: () => ({
    kind: "ups",
    health: "ok",
    inputOk: true,
    onBattery: false,
    batteryPct: 100,
    loadW: 0,
  }),
  cooling_unit: (model) => ({
    kind: "cooling_unit",
    health: "ok",
    adminOn: true,
    powered: true,
    running: true,
    setpointC: 20,
    supplyC: 20,
    returnC: 30,
    loadKw: 0,
    capacityKw: model?.kind === "cooling_unit" ? model.capacityKw : 50,
  }), // prettier-ignore
  rack: () => ({
    kind: "rack",
    health: "ok",
    inletC: AMBIENT_C,
    outletC: AMBIENT_C + 10,
    powerW: 0,
    powered: true,
    util: 0,
    liquidW: 0,
    coolantC: 0,
    bathC: 0,
    rebootPeak: 0,
  }),
  cdu: (model) => ({
    kind: "cdu",
    health: "ok",
    adminOn: true,
    powered: true,
    running: true,
    setpointC: model?.kind === "cdu" ? model.supplySetpointC : 32,
    supplyC: model?.kind === "cdu" ? model.supplySetpointC : 32,
    returnC: 38,
    loadKw: 0,
    capacityKw: model?.kind === "cdu" ? model.capacityKw : 500,
    pumpsOk: Array(model?.kind === "cdu" ? model.pumps : 3).fill(true),
  }),
  chiller: (model) => ({
    kind: "chiller",
    health: "ok",
    adminOn: true,
    powered: true,
    running: true,
    supplyC: model?.kind === "chiller" ? model.supplySetpointC : 12,
    returnC: model?.kind === "chiller" ? model.supplySetpointC + 6 : 18,
    loadKw: 0,
    capacityKw: model?.kind === "chiller" ? model.capacityKw : 1000,
    powerW: 0,
  }),
  generator: () => ({
    kind: "generator",
    health: "ok",
    adminOn: true,
    phase: "standby",
    startedFor: 0,
    fuelPct: 100,
    loadKw: 0,
  }),
  containment: () => ({
    kind: "containment",
    health: "ok",
    coldC: AMBIENT_C,
    hotC: AMBIENT_C + 10,
  }),
  room: () => ({ kind: "room", health: "ok", ambientC: AMBIENT_C }),
  service: () => ({
    kind: "service",
    health: "ok",
    status: "healthy",
    reasons: [],
    runsOn: [],
    standby: [],
    backlog: 0,
    lostKrw: 0,
    failovers: 0,
  }),
  vm: () => ({
    kind: "vm",
    health: "ok",
    adminOn: true,
    running: true,
    cpuDemand: 0.3,
    cpuUsage: 0.3,
    memUtil: 0.5,
  }),
};

/** A blueprint can say how loaded a server is and which firmware versions it was built with. */
function applyServerProps(state: StateOf<"server">, props: Entity["props"]): void {
  if (typeof props.cpuUtil === "number") state.cpuUtil = props.cpuUtil;
  if (typeof props.bmcVersion === "string") state.bmcVersion = props.bmcVersion;
  if (typeof props.biosVersion === "string") state.biosVersion = props.biosVersion;
}

function initial(kind: EntityKind, modelId: string | undefined, catalog: Catalog): EntityState {
  const model = modelId && catalog.has(modelId) ? catalog.get(modelId) : undefined;
  return FACTORIES[kind]?.(model) ?? ({ kind, health: "ok" } as EntityState);
}

/** A service starts where the blueprint's `service_on` links say: the active places run it, the standby ones wait. */
function placeService(state: StateOf<"service">, id: string, index: BlueprintIndex): void {
  for (const link of index.outgoing(id, "service_on")) {
    (link.props.role === "standby" ? state.standby : state.runsOn).push(link.to);
  }
}

export function initialState(index: BlueprintIndex, catalog: Catalog): WorldState {
  const entities: Record<string, EntityState> = {};
  for (const entity of index.all()) {
    const state = initial(entity.kind, entity.modelId, catalog);
    if (state.kind === "vm" && typeof entity.props.cpuDemand === "number")
      state.cpuDemand = entity.props.cpuDemand;
    if (state.kind === "service") placeService(state, entity.id, index);
    if (state.kind === "server") applyServerProps(state, entity.props);
    if (state.kind === "rack") state.util = bulkOf(entity)?.util ?? 0;
    if (state.kind === "cooling_unit" && typeof entity.props.setpointC === "number")
      state.setpointC = entity.props.setpointC;
    entities[entity.id] = state;
  }
  const links: WorldState["links"] = {};
  for (const link of index.allLinks()) if (link.kind === "network") links[link.id] = { up: true };
  return { t: 0, entities, links, faults: {}, alarms: {} };
}
