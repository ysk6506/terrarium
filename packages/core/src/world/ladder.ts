/**
 * The HA ladders (REQ-094, ADR-0107): eight layers, each a row of choices from cheap-and-often-down on the left to
 * dear-and-rarely-down on the right. This file holds what the core needs of a choice: its id, its place in the
 * ladder, whether the core can imitate it at all (a dotted chip, ADR-0107 item 5), what it makes of a generated
 * world, and which faults its structure makes possible. The words, pictures and cards of each choice belong to
 * the screen (apps/web/src/logic/world-shape/ladders.ts); a test keeps the two lists in step.
 */
import type { FaultType, MistakeType } from "./faults";

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

/** What a chip makes of the generated world. Absent fields leave the generator's default alone. */
export interface ChipBuild {
  /** Spine switches per server room. */
  readonly spines?: number;
  /** Hosts a service needs for its nodes: how nodes share hosts (`pack`), and spare hosts kept idle. */
  readonly pack?: number;
  readonly spareHosts?: number;
  /** Services run on servers directly, no virtual machines. */
  readonly bare?: boolean;
  /** Services take a place on a shared storage array. */
  readonly sharedStorage?: boolean;
  /** Power feeds into every rack. */
  readonly feeds?: 1 | 2;
  readonly cooling?: "N" | "N+1" | "2N";
  readonly containment?: boolean;
  /** Server rooms, and whether they stand in separate buildings. */
  readonly rooms?: number;
  readonly buildings?: number;
}

export interface ChipMech {
  readonly id: string;
  readonly layer: LayerId;
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
  id,
  layer,
  modeled: rest.modeled ?? true,
  ...(rest.buildsAs ? { buildsAs: rest.buildsAs } : {}),
  build: rest.build ?? {},
  stops: rest.stops ?? [],
  slows: rest.slows ?? [],
  costM: rest.costM ?? 0,
});

const dotted = (layer: LayerId, id: string, buildsAs: string, costM = 0): ChipMech =>
  c(layer, id, { modeled: false, buildsAs, costM });

/** Every choice of every layer, left to right. 44 in all. */
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
    dotted("network", "net-sdn", "net-leaf-spine", 150),
    dotted("network", "net-cloud-native", "net-leaf-spine", 150),
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
      build: { pack: 3 },
      stops: ["kernel_panic", "bmc_unresponsive"],
      slows: ["psu_failure", "vm_cpu_spike", "memory_leak", "cpu_runaway", "fan_failure"],
      costM: 30,
    }),
    dotted("compute", "cmp-drs", "cmp-virt-ha", 20),
    dotted("compute", "cmp-containers", "cmp-virt-ha", 40),
    dotted("compute", "cmp-multicluster", "cmp-virt-ha", 120),
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
      build: { sharedStorage: true },
      stops: ["disk_failure", "disk_full", "fs_readonly"],
      slows: [],
      costM: 25,
    }),
    dotted("storage", "sto-dual-controller", "sto-shared", 60),
    dotted("storage", "sto-distributed", "sto-shared", 90),
    dotted("storage", "sto-geo", "sto-shared", 150),
  ],
  database: [
    dotted("database", "db-single", "db-single", 0),
    dotted("database", "db-active-passive", "db-single", 15),
    dotted("database", "db-shared-aa", "db-single", 40),
    dotted("database", "db-primary-secondary", "db-single", 30),
    dotted("database", "db-auto-failover", "db-single", 45),
    dotted("database", "db-distributed-sql", "db-single", 80),
    dotted("database", "db-managed-multiaz", "db-single", 120),
  ],
  app: [
    c("app", "app-single", { stops: ["process_crashloop", "memory_leak", "cert_expired"] }),
    c("app", "app-lb-sticky", {
      stops: ["cert_expired"],
      slows: ["process_crashloop", "memory_leak", "log_flood"],
      costM: 10,
    }),
    dotted("app", "app-stateless", "app-lb-sticky", 10),
    dotted("app", "app-microservices", "app-lb-sticky", 20),
    dotted("app", "app-mesh", "app-lb-sticky", 40),
    dotted("app", "app-multiregion", "app-lb-sticky", 150),
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
    dotted("site", "site-dr-warm", "site-two-buildings", 600),
    dotted("site", "site-multi-active", "site-two-buildings", 1200),
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
