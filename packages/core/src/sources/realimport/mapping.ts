/**
 * How graph records become world entities (REQ-010, ADR-0009). This is the only place that knows a
 * graph's schema. It is plain data, so a deployment can override it with a JSON file when its graph
 * names things differently; several spellings are listed where the schema has varied (PART_OF and
 * PORT_OF, NicPort and NICPort).
 *
 * Relationships follow the dependency direction (consumer → supplier), as in cloud_topology and in
 * Terrarium's links. A rule with `either: true` also matches the reverse orientation.
 */
import type { EntityKind, LinkKind } from "@terrarium/core/world";

/** What a node becomes. Ports, hypervisors and volumes are folded into links and entities. */
export type NodeRole =
  | Exclude<EntityKind, "site" | "floor" | "containment">
  | "hypervisor"
  | "nic_port"
  | "switch_port"
  | "volume";

export interface NodeRule {
  readonly labels: readonly string[];
  readonly role: NodeRole;
  /** Only nodes whose property has one of these values (absent property counts as a match when listed as null). */
  readonly where?: Readonly<Record<string, readonly (string | number | boolean | null)[]>>;
}

/** Structural meanings beyond plain dependency links. */
export type RelationMeaning =
  | LinkKind
  | "hosted_on"
  | "located_in"
  | "port_owner"
  | "uses_interface"
  | "wire"
  | "provides_volume"
  | "volume_backs";

export interface RelationRule {
  readonly types: readonly string[];
  readonly from: readonly NodeRole[];
  readonly to: readonly NodeRole[];
  readonly means: RelationMeaning;
  readonly either?: boolean;
}

export interface PropertyKeys {
  readonly name: readonly string[];
  readonly model: readonly string[];
  readonly role: readonly string[];
  readonly switchTier: readonly string[];
  readonly port: readonly string[];
}

export interface KgMapping {
  readonly name: string;
  readonly nodes: readonly NodeRule[];
  readonly relations: readonly RelationRule[];
  readonly keys: PropertyKeys;
  /** Labels known to exist but deliberately not modelled (reported as such, not as unknown). */
  readonly ignoredLabels: readonly string[];
  readonly ignoredRelations: readonly string[];
}

const PHYSICAL: readonly NodeRole[] = ["server", "switch", "storage"];

/** cloud_topology as built by itcloud-graph-loader. */
export const CLOUD_TOPOLOGY_MAPPING: KgMapping = {
  name: "cloud_topology",
  nodes: [
    { labels: ["VCenter", "vCenter"], role: "vcenter" },
    { labels: ["Cluster", "ClusterComputeResource"], role: "cluster" },
    { labels: ["ESXiHost", "ESXi", "HostSystem"], role: "hypervisor" },
    { labels: ["VM", "VirtualMachine"], role: "vm" },
    { labels: ["Datastore"], role: "datastore" },
    { labels: ["PhysicalServer"], role: "storage", where: { role: ["storage"] } },
    { labels: ["PhysicalServer"], role: "server" },
    { labels: ["StorageVolume"], role: "volume" },
    {
      labels: ["NetworkSwitch"],
      role: "switch",
      where: { x_service_tier_upper: ["CLOUD", "FABRIC", "OOB-MGMT", null] },
    },
    { labels: ["NicPort", "NICPort"], role: "nic_port" },
    { labels: ["SwitchPort"], role: "switch_port" },
    { labels: ["HVAC"], role: "cooling_unit" },
    { labels: ["RACK", "Rack"], role: "rack" },
    { labels: ["ServerRoom"], role: "room" },
    { labels: ["DataCenter"], role: "building" },
  ],
  relations: [
    {
      types: ["RUNS_ON", "HOSTED_ON", "RUNS_ON_HOST"],
      from: ["vm"],
      to: ["hypervisor", "server"],
      means: "runs_on",
    },
    {
      types: ["HOSTED_ON", "HOST_HYPERVISOR"],
      from: ["hypervisor"],
      to: ["server", "storage"],
      means: "hosted_on",
      either: true,
    },
    {
      types: ["MEMBER_OF", "BELONGS_TO", "IN_CLUSTER", "PART_OF"],
      from: ["hypervisor", "server"],
      to: ["cluster"],
      means: "member_of",
    },
    {
      types: ["MANAGED_BY", "BELONGS_TO", "PART_OF"],
      from: ["cluster"],
      to: ["vcenter"],
      means: "managed_by",
    },
    {
      types: ["USES_DATASTORE", "STORED_ON", "USES_STORAGE", "ON_DATASTORE"],
      from: ["vm"],
      to: ["datastore"],
      means: "stored_on",
    },
    {
      types: ["PROVIDES_VOLUME"],
      from: ["storage", "server"],
      to: ["volume"],
      means: "provides_volume",
    },
    { types: ["BACKS"], from: ["volume"], to: ["datastore"], means: "volume_backs" },
    { types: ["COOLED_BY"], from: ["rack"], to: ["cooling_unit"], means: "cooling" },
    {
      types: ["LOCATED_IN", "IN_ROOM", "SERVES", "PART_OF", "INSTALLED_IN"],
      from: ["cooling_unit", "rack"],
      to: ["room"],
      means: "located_in",
      either: true,
    },
    {
      types: ["LOCATED_IN", "PART_OF", "IN_DATACENTER"],
      from: ["room"],
      to: ["building"],
      means: "located_in",
      either: true,
    },
    {
      types: ["LOCATED_IN", "MOUNTED_IN", "INSTALLED_IN", "IN_RACK", "PART_OF"],
      from: PHYSICAL,
      to: ["rack"],
      means: "located_in",
      either: true,
    },
    {
      types: ["PART_OF", "PORT_OF", "HAS_PORT", "HAS_NIC"],
      from: ["nic_port"],
      to: ["server", "storage"],
      means: "port_owner",
      either: true,
    },
    {
      types: ["PART_OF", "PORT_OF", "HAS_PORT"],
      from: ["switch_port"],
      to: ["switch"],
      means: "port_owner",
      either: true,
    },
    { types: ["USES_INTERFACE"], from: ["hypervisor"], to: ["nic_port"], means: "uses_interface" },
    {
      types: ["CONNECTS_TO"],
      from: ["nic_port"],
      to: ["switch_port"],
      means: "wire",
      either: true,
    },
    { types: ["CONNECTS_TO"], from: PHYSICAL, to: ["switch"], means: "network" },
    { types: ["UPLINKS_TO"], from: ["switch"], to: ["switch"], means: "network" },
  ],
  keys: {
    name: ["name", "hostname", "display_name", "config_name", "id"],
    model: ["model", "model_name", "hw_model", "product_name"],
    role: ["role"],
    switchTier: ["topology_type", "tier"],
    port: ["name", "port_name", "interface", "id"],
  },
  ignoredLabels: ["VDS", "PortGroup", "VSwitch", "DistributedVirtualSwitch"],
  ignoredRelations: ["PEERS_WITH", "USES_VSWITCH", "HAS_PORTGROUP", "ASSIGNED_TO"],
};

/** Labels a mapping reads. */
export const mappedLabels = (m: KgMapping): string[] => [
  ...new Set(m.nodes.flatMap((r) => r.labels)),
];

/** Relationship types a mapping reads. */
export const mappedRelations = (m: KgMapping): string[] => [
  ...new Set(m.relations.flatMap((r) => r.types)),
];
