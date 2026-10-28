/** Dynamic state of the world: JSON-serialisable so it can be snapshotted and sent between threads. */
import type { Catalog, EquipmentModel } from "@terrarium/core/catalog";
import type { EntityKind } from "./blueprint";
import type { Fault } from "./faults";
import type { BlueprintIndex } from "./graph";

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
}
export interface RoomState extends Base {
  kind: "room";
  ambientC: number;
}
export interface VmState extends Base {
  kind: "vm";
  adminOn: boolean;
  running: boolean;
  cpuDemand: number;
  memUtil: number;
}
export interface PlainState extends Base {
  kind: "site" | "building" | "floor" | "containment" | "vcenter" | "cluster" | "datastore";
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
  | RoomState
  | VmState
  | PlainState;

export type StateOf<K extends EntityKind> = Extract<EntityState, { kind: K }>;

export interface Alarm {
  readonly id: string;
  readonly entityId: string;
  readonly code: string;
  readonly severity: "warning" | "critical";
  readonly message: string;
  readonly since: number;
}

export interface WorldState {
  t: number;
  entities: Record<string, EntityState>;
  links: Record<string, { up: boolean }>;
  faults: Record<string, Fault>;
  alarms: Record<string, Alarm>;
}

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
  }),
  room: () => ({ kind: "room", health: "ok", ambientC: AMBIENT_C }),
  vm: () => ({
    kind: "vm",
    health: "ok",
    adminOn: true,
    running: true,
    cpuDemand: 0.3,
    memUtil: 0.5,
  }),
};

function initial(kind: EntityKind, modelId: string | undefined, catalog: Catalog): EntityState {
  const model = modelId && catalog.has(modelId) ? catalog.get(modelId) : undefined;
  return FACTORIES[kind]?.(model) ?? ({ kind, health: "ok" } as EntityState);
}

export function initialState(index: BlueprintIndex, catalog: Catalog): WorldState {
  const entities: Record<string, EntityState> = {};
  for (const entity of index.all()) {
    const state = initial(entity.kind, entity.modelId, catalog);
    if (state.kind === "vm" && typeof entity.props.cpuDemand === "number")
      state.cpuDemand = entity.props.cpuDemand;
    if (state.kind === "server" && typeof entity.props.cpuUtil === "number")
      state.cpuUtil = entity.props.cpuUtil;
    if (state.kind === "cooling_unit" && typeof entity.props.setpointC === "number")
      state.setpointC = entity.props.setpointC;
    entities[entity.id] = state;
  }
  const links: Record<string, { up: boolean }> = {};
  for (const link of index.allLinks()) if (link.kind === "network") links[link.id] = { up: true };
  return { t: 0, entities, links, faults: {}, alarms: {} };
}
