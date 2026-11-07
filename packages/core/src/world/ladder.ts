/**
 * The HA ladders (REQ-094, ADR-0107): eight layers, each a row of choices from cheap-and-often-down on the left to
 * dear-and-rarely-down on the right. This file holds what the core needs of a choice: its id, its place in the
 * ladder, whether the core can imitate it at all (a dotted chip, ADR-0107 item 5), what it makes of a generated
 * world, and which faults its structure makes possible. The words, pictures and cards of each choice belong to
 * the screen (apps/web/src/logic/world-shape/ladders.ts); a test keeps the two lists in step.
 */

import type { FaultType, MistakeType } from "./faults";
import type { ChipBuild } from "./ladder-build";
import { DISTRIBUTED_SQL_CHIP, GEO_CHIP, MANAGED_MULTIAZ_CHIP, SITE_CHIPS } from "./ladder-site";

export type {
  AppBuild,
  ChipBuild,
  DatabaseBuild,
  DbxBuild,
  K8sBuild,
  OverlayBuild,
  PoolBuild,
  SiteBuild,
} from "./ladder-build";

/** A fault or a mistake: both are things that go wrong. */
export type Problem = FaultType | MistakeType;

export type LayerId =
  | "network"
  | "compute"
  | "storage"
  | "database"
  | "app"
  | "power"
  | "cooling"
  | "site";

export const LAYER_IDS: readonly LayerId[] = [
  "network",
  "compute",
  "storage",
  "database",
  "app",
  "power",
  "cooling",
  "site",
];

/** One place on a ladder: the layer, and a choice of it. */
export interface LadderSpot {
  readonly layer: LayerId;
  readonly atLeast: string;
}

/**
 * What a choice needs under it (REQ-102, ADR-0123): another layer at `atLeast` or further right on its ladder, or, when
 * `orElse` is there, either of the two. A choice whose need is not met is shown muted and asks before it is taken.
 */
export interface Need extends LadderSpot {
  readonly orElse?: LadderSpot;
}

/** A pair that is allowed but makes little sense together: the note says why, in one line. */
export interface Pointless {
  readonly layer: LayerId;
  readonly chip: string;
  readonly note: string;
}

export interface ChipMech {
  readonly id: string;
  readonly layer: LayerId;
  /** Needs of other layers (all of them), see `Need`. Absent: none. */
  readonly requires?: readonly Need[];
  /** Pairs that make little sense with this choice. */
  readonly pointlessWith?: readonly Pointless[];
  /** False: the core has no model for this structure (a dotted chip); it builds as `buildsAs` and makes no scenarios. */
  readonly modeled: boolean;
  /** The nearest modelled chip of the layer, for a dotted one. */
  readonly buildsAs?: string;
  readonly build: ChipBuild;
  /** Faults this structure makes possible, and which of them it stops the service on (a single point) or only slows. */
  readonly stops: readonly Problem[];
  readonly slows: readonly Problem[];
  /** What the choice adds to the price, million won (switches, controllers, generators: round figures). */
  readonly costM: number;
}

const c = (
  layer: LayerId,
  id: string,
  rest: Omit<ChipMech, "id" | "layer" | "modeled" | "build" | "stops" | "slows" | "costM"> &
    Partial<Pick<ChipMech, "modeled" | "build" | "stops" | "slows" | "costM">>,
): ChipMech => ({
  ...rest,
  id,
  layer,
  modeled: rest.modeled ?? true,
  build: rest.build ?? {},
  stops: rest.stops ?? [],
  slows: rest.slows ?? [],
  costM: rest.costM ?? 0,
});

const at = (layer: LayerId, atLeast: string): LadderSpot => ({ layer, atLeast });
const SHARED: Need = at("storage", "sto-shared");
const CONTAINERS: Need = at("compute", "cmp-containers");
const MANY_DB = at("database", "db-distributed-sql");

/** Every choice of every layer, left to right. 46 in all. */
const APP_SLOWS = [
  "process_crashloop",
  "memory_leak",
  "log_flood",
  "lb_backend_flapping",
  "session_store_down",
] as const;
const APP_MESH_SLOWS = [
  ...APP_SLOWS,
  "circuit_breaker_stuck_open",
  "retry_storm",
  "sidecar_crash",
  "mesh_control_down",
] as const;

export const LADDER: Readonly<Record<LayerId, readonly ChipMech[]>> = {
  network: [
    c("network", "net-legacy", {
      build: { spines: 1 },
      stops: ["switch_failure", "link_down"],
      slows: [],
    }),
    c("network", "net-three-tier", {
      build: { spines: 2 },
      stops: ["switch_failure"],
      slows: ["link_down", "port_vlan_mismatch", "port_shutdown"],
      costM: 60,
    }),
    c("network", "net-leaf-spine", {
      build: { spines: 2 },
      stops: ["switch_failure"],
      slows: ["link_down", "port_vlan_mismatch", "port_shutdown", "route_missing"],
      costM: 90,
    }),
    c("network", "net-sdn", {
      build: { spines: 2, overlay: { controllers: 2, nfv: true, cloudNative: false } },
      stops: ["switch_failure", "vxlan_tunnel_down"],
      slows: [
        "link_down",
        "port_vlan_mismatch",
        "port_shutdown",
        "route_missing",
        "sdn_controller_down",
        "sdn_sync_failed",
        "evpn_session_flap",
        "nfv_firewall_overload",
      ],
      costM: 150,
    }),
    c("network", "net-cloud-native", {
      requires: [CONTAINERS],
      build: { spines: 2, overlay: { controllers: 2, nfv: true, cloudNative: true } },
      stops: ["switch_failure", "vxlan_tunnel_down", "ingress_controller_down"],
      slows: [
        "link_down",
        "port_vlan_mismatch",
        "port_shutdown",
        "route_missing",
        "sdn_controller_down",
        "sdn_sync_failed",
        "evpn_session_flap",
        "nfv_firewall_overload",
        "cni_plugin_failure",
        "network_policy_deny",
      ],
      costM: 150,
    }),
    c("network", "net-ai-fabric", {
      build: { spines: 2 },
      stops: [],
      slows: ["link_down", "bgp_neighbor_shutdown", "route_missing", "switch_failure"],
      costM: 240,
    }),
  ],
  compute: [
    c("compute", "cmp-bare", {
      build: { bare: true, pack: 1 },
      stops: ["psu_failure", "kernel_panic", "cpu_runaway", "disk_failure", "fan_failure"],
      slows: [],
    }),
    c("compute", "cmp-bare-spare", {
      build: { bare: true, pack: 1, spareHosts: 1 },
      stops: ["psu_failure", "kernel_panic", "disk_failure"],
      slows: ["cpu_runaway", "fan_failure"],
      costM: 15,
    }),
    c("compute", "cmp-virt-ha", {
      requires: [SHARED],
      build: { pack: 3 },
      stops: ["kernel_panic", "bmc_unresponsive"],
      slows: ["psu_failure", "vm_cpu_spike", "memory_leak", "cpu_runaway", "fan_failure"],
      costM: 30,
    }),
    c("compute", "cmp-drs", {
      requires: [SHARED],
      build: { pack: 3, drs: true },
      stops: ["kernel_panic", "bmc_unresponsive"],
      slows: ["psu_failure", "vm_cpu_spike", "memory_leak", "cpu_runaway", "fan_failure"],
      costM: 20,
    }),
    c("compute", "cmp-containers", {
      build: { pack: 3, k8s: { clusters: 1 } },
      stops: ["k8s_pod_crashloop"],
      slows: [
        "k8s_node_notready",
        "k8s_control_plane_down",
        "k8s_etcd_quorum_lost",
        "k8s_resource_exhausted",
        "k8s_image_pull_failure",
        "k8s_disk_pressure",
        "k8s_cni_failure",
        "psu_failure",
      ],
      costM: 40,
    }),
    c("compute", "cmp-multicluster", {
      pointlessWith: [
        {
          layer: "site",
          chip: "site-one-room",
          note: "멀티클러스터인데 서버룸이 하나면 같은 방이 멈추면 둘 다 멈춰요",
        },
      ],
      build: { pack: 3, k8s: { clusters: 2 } },
      stops: [],
      slows: [
        "k8s_pod_crashloop",
        "k8s_node_notready",
        "k8s_control_plane_down",
        "k8s_etcd_quorum_lost",
        "k8s_resource_exhausted",
        "k8s_image_pull_failure",
        "k8s_disk_pressure",
        "k8s_cni_failure",
      ],
      costM: 120,
    }),
  ],
  storage: [
    c("storage", "sto-local", {
      stops: ["disk_failure", "disk_full", "fs_readonly"],
    }),
    c("storage", "sto-raid-backup", {
      stops: ["disk_full", "fs_readonly"],
      slows: ["disk_failure"],
      costM: 5,
    }),
    c("storage", "sto-shared", {
      build: { sharedStorage: true, pool: { mode: "dual", multipath: false } },
      stops: [
        "disk_failure",
        "disk_full",
        "fs_readonly",
        "storage_controller_failure",
        "storage_path_cut",
      ],
      slows: [],
      costM: 25,
    }),
    c("storage", "sto-dual-controller", {
      build: { sharedStorage: true, pool: { mode: "dual", multipath: true } },
      stops: ["disk_full", "fs_readonly"],
      slows: ["disk_failure", "storage_controller_failure", "storage_path_cut"],
      costM: 60,
    }),
    c("storage", "sto-distributed", {
      build: { pool: { mode: "distributed", nodes: 4, copies: 3 } },
      stops: ["disk_full", "fs_readonly"],
      slows: ["disk_failure", "storage_node_lost"],
      costM: 90,
    }),
    GEO_CHIP,
  ],
  database: [
    c("database", "db-single", {
      build: { database: { shape: "single", instances: 1, failover: "manual" } },
      stops: ["db_primary_down", "db_backup_corrupt", "disk_full"],
      slows: [],
    }),
    c("database", "db-active-passive", {
      build: {
        database: {
          shape: "active_passive",
          instances: 2,
          failover: "auto",
          detectS: 30,
          sharedDisk: true,
        },
      },
      stops: ["disk_full"],
      slows: ["db_primary_down"],
      costM: 15,
    }),
    c("database", "db-shared-aa", {
      requires: [SHARED],
      build: {
        database: { shape: "shared_aa", instances: 3, failover: "manual", sharedDisk: true },
      },
      stops: ["disk_full"],
      slows: ["db_primary_down"],
      costM: 40,
    }),
    c("database", "db-primary-secondary", {
      build: { database: { shape: "replicated", instances: 2, failover: "manual" } },
      stops: ["db_primary_down", "disk_full"],
      slows: ["db_replication_broken"],
      costM: 30,
    }),
    c("database", "db-auto-failover", {
      build: {
        database: {
          shape: "auto_failover",
          instances: 3,
          failover: "auto",
          detectS: 30,
          quorum: 3,
        },
      },
      stops: ["db_split_brain", "disk_full"],
      slows: ["db_primary_down", "db_replication_broken"],
      costM: 45,
    }),
    DISTRIBUTED_SQL_CHIP,
    MANAGED_MULTIAZ_CHIP,
  ],
  app: [
    c("app", "app-single", { stops: ["process_crashloop", "memory_leak", "cert_expired"] }),
    c("app", "app-lb-sticky", {
      stops: ["cert_expired"],
      slows: ["process_crashloop", "memory_leak", "log_flood"],
      costM: 10,
    }),
    c("app", "app-stateless", {
      build: { app: { sessionStore: true, breakers: false, mesh: false, regions: 1 } },
      stops: ["cert_expired"],
      slows: APP_SLOWS,
      costM: 10,
    }),
    c("app", "app-microservices", {
      build: { app: { sessionStore: true, breakers: true, mesh: false, regions: 1 } },
      stops: ["cert_expired"],
      slows: [...APP_SLOWS, "circuit_breaker_stuck_open"],
      costM: 20,
    }),
    c("app", "app-mesh", {
      requires: [CONTAINERS],
      build: { app: { sessionStore: true, breakers: true, mesh: true, regions: 1 } },
      stops: ["cert_expired"],
      slows: [...APP_MESH_SLOWS],
      costM: 40,
    }),
    c("app", "app-multiregion", {
      requires: [at("site", "site-multi-active"), MANY_DB],
      build: { app: { sessionStore: true, breakers: true, mesh: true, regions: 2 } },
      stops: [],
      slows: [...APP_MESH_SLOWS, "region_down", "replication_lag_high"],
      costM: 150,
    }),
  ],
  power: [
    c("power", "pwr-single", {
      build: { feeds: 1 },
      stops: ["breaker_trip", "grid_outage", "psu_failure"],
    }),
    c("power", "pwr-ab", {
      build: { feeds: 2 },
      stops: ["utility_outage"],
      slows: ["breaker_trip", "grid_outage", "ups_battery_degraded", "psu_failure", "outlet_off"],
      costM: 40,
    }),
    c("power", "pwr-2n-gen", {
      build: { feeds: 2 },
      stops: [],
      slows: ["breaker_trip", "grid_outage", "ups_battery_degraded", "generator_start_failure"],
      costM: 220,
    }),
    c("power", "pwr-2n-auto", {
      build: { feeds: 2 },
      stops: [],
      slows: ["ats_stuck", "generator_start_failure", "ups_battery_degraded"],
      costM: 330,
    }),
  ],
  cooling: [
    c("cooling", "cool-n", {
      build: { cooling: "N" },
      stops: ["cooling_unit_failure", "chiller_failure", "setpoint_drift"],
      slows: ["cooling_unit_degraded", "sensor_drift"],
    }),
    c("cooling", "cool-n1", {
      build: { cooling: "N+1" },
      stops: ["chiller_failure"],
      slows: ["cooling_unit_failure", "cooling_unit_degraded", "setpoint_drift", "sensor_drift"],
      costM: 25,
    }),
    c("cooling", "cool-2n", {
      build: { cooling: "2N", containment: true },
      stops: [],
      slows: ["cooling_unit_failure", "chiller_failure", "chiller_degraded", "setpoint_drift"],
      costM: 90,
    }),
    c("cooling", "cool-liquid", {
      build: { cooling: "2N", containment: true },
      stops: [],
      slows: ["cdu_failure", "cdu_pump_failure", "coolant_leak", "chiller_degraded"],
      costM: 200,
    }),
  ],
  site: [
    c("site", "site-one-room", { build: { rooms: 1, buildings: 1 } }),
    c("site", "site-two-rooms", { build: { rooms: 2, buildings: 1 }, costM: 120 }),
    c("site", "site-two-buildings", { build: { rooms: 2, buildings: 2 }, costM: 400 }),
    ...SITE_CHIPS,
  ],
};

export const chipsOf = (layer: LayerId): readonly ChipMech[] => LADDER[layer];

/** The chip with this id, wherever it stands. */
export function chipById(id: string): ChipMech | undefined {
  for (const layer of LAYER_IDS) {
    const hit = LADDER[layer].find((chip) => chip.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/** The chip a layer's choice builds as: itself, or its nearest modelled neighbour when it is dotted. */
export function builtChip(layer: LayerId, id: string): ChipMech {
  const chip = LADDER[layer].find((x) => x.id === id) ?? (LADDER[layer][0] as ChipMech);
  if (chip.modeled) return chip;
  return LADDER[layer].find((x) => x.id === chip.buildsAs) ?? chip;
}

/** One choice per layer. */
export type Layers = Readonly<Record<LayerId, string>>;

export const LAYER_COUNT = LAYER_IDS.length;

/** The number of choices on all ladders. */
export const CHIP_COUNT = LAYER_IDS.reduce((sum, layer) => sum + LADDER[layer].length, 0);

/** Whether this set of choices is whole and every id belongs to its layer. */
export function layersProblem(layers: Layers): string | undefined {
  for (const layer of LAYER_IDS) {
    const id = layers[layer];
    if (!LADDER[layer].some((chip) => chip.id === id))
      return `${layer} 층에 '${String(id)}' 선택지는 없어요`;
  }
  return undefined;
}
