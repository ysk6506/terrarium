/**
 * The choices REQ-106 turned from dotted into solid (ADR-0129): the sites from a cold DR site to active-active, the
 * geo-replicated storage, and the two databases that are not a `db_cluster` (a consensus ring, a managed multi-AZ service).
 * They live in a file of their own so ladder.ts stays small; ladder.ts puts them on the ladders in their places.
 */
import type { ChipMech, LadderSpot } from "./ladder";

const at = (layer: LadderSpot["layer"], atLeast: string): LadderSpot => ({ layer, atLeast });

const SITE_FAULTS = [
  "site_power_loss",
  "wan_link_down",
  "wan_degraded",
  "replication_broken",
  "dr_failover_stuck",
] as const;

/** Where the second site stands from the first, and how much of the hardware it holds, per choice. */
export const SITE_CHIPS: readonly ChipMech[] = [
  {
    id: "site-dr-cold",
    layer: "site",
    modeled: true,
    build: { rooms: 2, buildings: 2, site: { mode: "cold", distanceKm: 300, share: 1 } },
    stops: ["site_power_loss"],
    slows: ["dr_site_stale"],
    costM: 300,
  },
  {
    id: "site-dr-warm",
    layer: "site",
    modeled: true,
    requires: [{ ...at("storage", "sto-geo"), orElse: at("database", "db-primary-secondary") }],
    build: { rooms: 2, buildings: 2, site: { mode: "warm", distanceKm: 100, share: 0.5 } },
    stops: ["site_power_loss"],
    slows: ["wan_link_down", "wan_degraded", "replication_broken", "dr_failover_stuck"],
    costM: 600,
  },
  {
    id: "site-dr-hot",
    layer: "site",
    modeled: true,
    requires: [{ ...at("storage", "sto-geo"), orElse: at("database", "db-auto-failover") }],
    build: { rooms: 2, buildings: 2, site: { mode: "hot", distanceKm: 50, share: 1 } },
    stops: [],
    slows: [...SITE_FAULTS],
    costM: 900,
  },
  {
    id: "site-multi-active",
    layer: "site",
    modeled: true,
    requires: [{ ...at("storage", "sto-geo"), orElse: at("database", "db-distributed-sql") }],
    build: { rooms: 2, buildings: 2, site: { mode: "active", distanceKm: 100, share: 1 } },
    stops: [],
    slows: [...SITE_FAULTS, "split_brain"],
    costM: 1200,
  },
];

export const GEO_CHIP: ChipMech = {
  id: "sto-geo",
  layer: "storage",
  modeled: true,
  requires: [at("site", "site-dr-cold")],
  build: { sharedStorage: true, pool: { mode: "dual", multipath: true }, geo: true },
  stops: ["disk_full", "fs_readonly"],
  slows: [
    "disk_failure",
    "storage_controller_failure",
    "storage_path_cut",
    "geo_replication_lag",
    "geo_replica_broken",
  ],
  costM: 150,
};

export const DISTRIBUTED_SQL_CHIP: ChipMech = {
  id: "db-distributed-sql",
  layer: "database",
  modeled: true,
  build: { dbx: { kind: "raft", nodes: 3 } },
  stops: ["db_quorum_lost", "disk_full"],
  slows: ["db_leader_lost", "db_node_lagging"],
  costM: 80,
};

export const MANAGED_MULTIAZ_CHIP: ChipMech = {
  id: "db-managed-multiaz",
  layer: "database",
  modeled: true,
  build: { dbx: { kind: "managed", azs: 2 } },
  stops: [],
  slows: ["db_az_failure", "db_failover_flapping", "db_storage_full"],
  costM: 120,
};
