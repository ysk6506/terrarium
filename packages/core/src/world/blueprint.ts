/**
 * The world blueprint: a declarative, JSON-serialisable description of everything that exists.
 * The builder UI, worldgen and realimport all produce blueprints; a World is built from one.
 *
 * Containment tree: site > building > floor > room > (containment) > rack > rack-mounted device.
 * Floor-standing equipment (cooling units, panels, UPS) stands in a room. Virtual entities (vCenter,
 * clusters, VMs, datastores) have no physical parent and are connected by links.
 *
 * Links point in the *dependency* direction (consumer -> supplier), like the cloud_topology graph:
 * a server is POWERED by a PDU, a rack is COOLED by a cooling unit, a VM RUNS ON a host.
 */
import type { Rotation } from "@terrarium/core/spatial";

export const BLUEPRINT_SCHEMA_VERSION = 1;

export type SpaceKind = "site" | "parcel" | "building" | "floor" | "room" | "containment";
export type RackMountedKind = "server" | "switch" | "storage" | "pdu";
export type FloorStandingKind = "cooling_unit" | "power_panel" | "ups" | "cdu";
/** Plant equipment: stands in a yard or on a roof, outside the data halls. */
export type PlantKind = "chiller" | "generator";
export type VirtualKind = "vcenter" | "cluster" | "vm" | "datastore";
export type EntityKind =
  | SpaceKind
  | "rack"
  | RackMountedKind
  | FloorStandingKind
  | PlantKind
  | VirtualKind;

export const ENTITY_KINDS: readonly EntityKind[] = [
  "site",
  "building",
  "floor",
  "room",
  "containment",
  "parcel",
  "rack",
  "server",
  "switch",
  "storage",
  "pdu",
  "cooling_unit",
  "power_panel",
  "ups",
  "cdu",
  "chiller",
  "generator",
  "vcenter",
  "cluster",
  "vm",
  "datastore",
]; // prettier-ignore

export const MODELLED_KINDS: ReadonlySet<EntityKind> = new Set([
  "server",
  "switch",
  "storage",
  "pdu",
  "cooling_unit",
  "power_panel",
  "ups",
  "cdu",
  "chiller",
  "generator",
]);

/** Which parent kinds each kind may have; an empty list means "no physical parent". */
export const ALLOWED_PARENTS: Readonly<Record<EntityKind, readonly EntityKind[]>> = {
  site: [],
  parcel: ["site"],
  building: ["site"],
  floor: ["building"],
  room: ["floor"],
  containment: ["room"],
  rack: ["room", "containment"],
  server: ["rack"],
  switch: ["rack"],
  storage: ["rack"],
  pdu: ["rack"],
  cooling_unit: ["room", "containment"],
  power_panel: ["room", "floor", "building", "site"],
  ups: ["room", "floor"],
  cdu: ["room", "floor"],
  chiller: ["site", "building"],
  generator: ["site", "building"],
  vcenter: [],
  cluster: [],
  vm: [],
  datastore: [],
};

/** Where something is, relative to its parent. Units are metres; racks use units (U). */
export type Placement =
  | { readonly type: "land"; readonly w: number; readonly d: number }
  | {
      readonly type: "area";
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly d: number;
    }
  | { readonly type: "level"; readonly level: number; readonly height: number }
  | { readonly type: "spot"; readonly x: number; readonly y: number; readonly rotation: Rotation }
  | { readonly type: "unit"; readonly u: number };

/** The placement type each kind uses (virtual kinds have none). */
export const PLACEMENT_OF: Readonly<Record<EntityKind, Placement["type"] | undefined>> = {
  site: "land",
  parcel: "area",
  building: "area",
  floor: "level",
  room: "area",
  containment: "area",
  rack: "spot",
  server: "unit",
  switch: "unit",
  storage: "unit",
  pdu: "unit",
  cooling_unit: "spot",
  power_panel: "spot",
  ups: "spot",
  cdu: "spot",
  chiller: "spot",
  generator: "spot",
  vcenter: undefined,
  cluster: undefined,
  vm: undefined,
  datastore: undefined,
};

export type PropValue = string | number | boolean;

export interface Entity {
  readonly id: string;
  readonly kind: EntityKind;
  readonly name: string;
  readonly parentId?: string;
  readonly modelId?: string;
  readonly placement?: Placement;
  /** Free-form properties: containment aisle type, VM size, site preset, imported source fields... */
  readonly props: Readonly<Record<string, PropValue>>;
}

export type LinkKind =
  | "power"
  | "network"
  | "cooling"
  | "runs_on"
  | "member_of"
  | "managed_by"
  | "stored_on"
  | "backed_by";

/** Allowed (from kinds, to kinds) per link kind. `from` depends on `to`. */
export const LINK_RULES: Readonly<
  Record<LinkKind, { readonly from: readonly EntityKind[]; readonly to: readonly EntityKind[] }>
> = {
  power: {
    from: [
      "server",
      "switch",
      "storage",
      "rack",
      "pdu",
      "cooling_unit",
      "power_panel",
      "cdu",
      "chiller",
      "ups",
    ],
    to: ["pdu", "power_panel", "ups", "generator"],
  },
  network: { from: ["server", "storage", "switch"], to: ["switch"] },
  cooling: { from: ["rack", "cooling_unit", "cdu"], to: ["cooling_unit", "cdu", "chiller"] },
  runs_on: { from: ["vm"], to: ["server"] },
  member_of: { from: ["server"], to: ["cluster"] },
  managed_by: { from: ["cluster"], to: ["vcenter"] },
  stored_on: { from: ["vm"], to: ["datastore"] },
  backed_by: { from: ["datastore"], to: ["storage"] },
};

export interface Link {
  readonly id: string;
  readonly kind: LinkKind;
  readonly from: string;
  readonly to: string;
  /** Ports, cable type, length... */
  readonly props: Readonly<Record<string, PropValue>>;
}

export interface Blueprint {
  readonly schemaVersion: number;
  readonly id: string;
  readonly name: string;
  readonly entities: readonly Entity[];
  readonly links: readonly Link[];
  readonly meta: Readonly<Record<string, PropValue>>;
}

export function emptyBlueprint(id: string, name: string): Blueprint {
  return { schemaVersion: BLUEPRINT_SCHEMA_VERSION, id, name, entities: [], links: [], meta: {} };
}

export const isRackMountedKind = (kind: EntityKind): kind is RackMountedKind =>
  kind === "server" || kind === "switch" || kind === "storage" || kind === "pdu";

export const isFloorStandingKind = (kind: EntityKind): kind is FloorStandingKind =>
  kind === "cooling_unit" || kind === "power_panel" || kind === "ups" || kind === "cdu";

export const isPlantKind = (kind: EntityKind): kind is PlantKind =>
  kind === "chiller" || kind === "generator";

export const isVirtualKind = (kind: EntityKind): kind is VirtualKind =>
  kind === "vcenter" || kind === "cluster" || kind === "vm" || kind === "datastore";
