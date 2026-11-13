/**
 * The world blueprint: a declarative, JSON-serialisable description of everything that exists.
 * The builder UI and worldgen produce blueprints; a World is built from one.
 *
 * Containment tree: site > building > floor > room > (containment) > rack > rack-mounted device.
 * Floor-standing equipment (cooling units, panels, UPS) stands in a room. Virtual entities (vCenter,
 * clusters, VMs, datastores) have no physical parent and are connected by links.
 *
 * Links point in the *dependency* direction (consumer -> supplier), like the cloud_topology graph:
 * a server is POWERED by a PDU, a rack is COOLED by a cooling unit, a VM RUNS ON a host.
 */
import type { PhysicsProfile } from "@terrarium/core/physics/slots";
import type { Rect, Rotation } from "@terrarium/core/spatial";
import type { LinkKind } from "./blueprint-links";

export const BLUEPRINT_SCHEMA_VERSION = 1;

export type SpaceKind = "site" | "parcel" | "building" | "floor" | "room" | "containment";
export type RackMountedKind = "server" | "switch" | "storage" | "pdu";
export type FloorStandingKind = "cooling_unit" | "power_panel" | "ups" | "cdu";
/** Plant equipment: stands in a yard or on a roof, outside the data halls. */
export type PlantKind = "chiller" | "generator";
export type VirtualKind =
  | "vcenter"
  | "cluster"
  | "vm"
  | "datastore"
  | "service"
  /** Database and storage-HA layers (REQ-095, ADR-0107 item 6). */
  | "db_cluster"
  | "db_instance"
  | "storage_pool"
  | "storage_controller"
  /** SDN overlay and cloud-native network layers (REQ-097, ADR-0107 item 6). */
  | "sdn_controller"
  | "vtep"
  | "overlay_segment"
  | "nfv_function"
  | "cni"
  | "network_policy"
  | "ingress"
  /** Container layer (REQ-096, ADR-0107 item 6): a cluster, its nodes, and the workloads whose pods run on them. */
  | "k8s_cluster"
  | "k8s_node"
  | "k8s_workload"
  /** Application layer (REQ-100, ADR-0121): replicas, balancers, sessions, breakers, the mesh, regions. */
  | "app_instance"
  | "load_balancer"
  | "session_store"
  | "circuit_breaker"
  | "mesh_sidecar"
  | "mesh_control"
  | "region"
  /** Site and DR layer (REQ-106, ADR-0129): a second site, the link, the copies, the plan; geo volumes; consensus and managed databases. */
  | "dr_site"
  | "site_link"
  | "replication_stream"
  | "dr_plan"
  | "volume"
  | "db_node"
  | "db_managed"
  /** GPU accelerator layer (REQ-107, ADR-0130): GPUs, NVLink domains, the InfiniBand/RoCE fabric, the scheduler, jobs and pools. */
  | "gpu"
  | "nvlink_domain"
  | "ib_fabric"
  | "ib_link"
  | "job_scheduler"
  | "training_job"
  | "inference_pool"
  /** Power and cooling ladders (REQ-107, ADR-0130): rack batteries, 48 V buses, the substation, rear doors, immersion tanks. */
  | "bbu"
  | "dc_bus"
  | "substation"
  | "rdhx"
  | "immersion_tank";
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
  "service",
  "db_cluster",
  "db_instance",
  "storage_pool",
  "storage_controller",
  "sdn_controller",
  "vtep",
  "overlay_segment",
  "nfv_function",
  "cni",
  "network_policy",
  "ingress",
  "k8s_cluster",
  "k8s_node",
  "k8s_workload",
  "app_instance",
  "load_balancer",
  "session_store",
  "circuit_breaker",
  "mesh_sidecar",
  "mesh_control",
  "region",
  "dr_site",
  "site_link",
  "replication_stream",
  "dr_plan",
  "volume",
  "db_node",
  "db_managed",
  "gpu",
  "nvlink_domain",
  "ib_fabric",
  "ib_link",
  "job_scheduler",
  "training_job",
  "inference_pool",
  "bbu",
  "dc_bus",
  "substation",
  "rdhx",
  "immersion_tank",
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
  service: [],
  db_cluster: [],
  db_instance: [],
  storage_pool: [],
  storage_controller: [],
  sdn_controller: [],
  vtep: [],
  overlay_segment: [],
  nfv_function: [],
  cni: [],
  network_policy: [],
  ingress: [],
  k8s_cluster: [],
  k8s_node: [],
  k8s_workload: [],
  app_instance: [],
  load_balancer: [],
  session_store: [],
  circuit_breaker: [],
  mesh_sidecar: [],
  mesh_control: [],
  region: [],
  dr_site: [],
  site_link: [],
  replication_stream: [],
  dr_plan: [],
  volume: [],
  db_node: [],
  db_managed: [],
  gpu: [],
  nvlink_domain: [],
  ib_fabric: [],
  ib_link: [],
  job_scheduler: [],
  training_job: [],
  inference_pool: [],
  bbu: [],
  dc_bus: [],
  substation: [],
  rdhx: [],
  immersion_tank: [],
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
      /** A room only (ADR-0080): rectangles attached edge to edge to the body, in the same frame. Absent = a plain rectangle. */
      readonly pieces?: readonly Rect[];
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
  service: undefined,
  db_cluster: undefined,
  db_instance: undefined,
  storage_pool: undefined,
  storage_controller: undefined,
  sdn_controller: undefined,
  vtep: undefined,
  overlay_segment: undefined,
  nfv_function: undefined,
  cni: undefined,
  network_policy: undefined,
  ingress: undefined,
  k8s_cluster: undefined,
  k8s_node: undefined,
  k8s_workload: undefined,
  app_instance: undefined,
  load_balancer: undefined,
  session_store: undefined,
  circuit_breaker: undefined,
  mesh_sidecar: undefined,
  mesh_control: undefined,
  region: undefined,
  dr_site: undefined,
  site_link: undefined,
  replication_stream: undefined,
  dr_plan: undefined,
  volume: undefined,
  db_node: undefined,
  db_managed: undefined,
  gpu: undefined,
  nvlink_domain: undefined,
  ib_fabric: undefined,
  ib_link: undefined,
  job_scheduler: undefined,
  training_job: undefined,
  inference_pool: undefined,
  bbu: undefined,
  dc_bus: undefined,
  substation: undefined,
  rdhx: undefined,
  immersion_tank: undefined,
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

export type { LinkKind } from "./blueprint-links";
export { LINK_RULES } from "./blueprint-links";

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
  /** The physics of this world when it is not the default (REQ-113): numbers, tables and weather changed from v1. */
  readonly physics?: PhysicsProfile;
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

const VIRTUAL_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
  "vcenter",
  "cluster",
  "vm",
  "datastore",
  "service",
  "db_cluster",
  "db_instance",
  "storage_pool",
  "storage_controller",
  "sdn_controller",
  "vtep",
  "overlay_segment",
  "nfv_function",
  "cni",
  "network_policy",
  "ingress",
  "k8s_cluster",
  "k8s_node",
  "k8s_workload",
  "app_instance",
  "load_balancer",
  "session_store",
  "circuit_breaker",
  "mesh_sidecar",
  "mesh_control",
  "region",
  "dr_site",
  "site_link",
  "replication_stream",
  "dr_plan",
  "volume",
  "db_node",
  "db_managed",
  "gpu",
  "nvlink_domain",
  "ib_fabric",
  "ib_link",
  "job_scheduler",
  "training_job",
  "inference_pool",
  "bbu",
  "dc_bus",
  "substation",
  "rdhx",
  "immersion_tank",
]);

export const isVirtualKind = (kind: EntityKind): kind is VirtualKind => VIRTUAL_KINDS.has(kind);
