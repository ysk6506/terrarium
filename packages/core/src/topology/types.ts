/**
 * What the topology view is made of (REQ-078, ADR-0084). A *layer* is one way the world leans on itself (power,
 * cooling, network), cut into stages that read left to right from the source to the servers. A *board* is
 * what is drawn of a layer: tiles in columns (one column per stage) and pipes between them. Most of a big
 * world looks the same, so most of it is folded into group tiles; only what differs is drawn on its own.
 */
import type { Alarm, BlueprintIndex, EntityState, Fault } from "@terrarium/core/world";

export type LayerId = "power" | "cooling" | "network";

export const LAYER_IDS: readonly LayerId[] = ["power", "cooling", "network"];

export const LAYER_LABELS: Readonly<Record<LayerId, string>> = {
  power: "전원",
  cooling: "냉방",
  network: "네트워크·가상화",
};

/** The four colours of the board, and "ok" for everything that has nothing to say. */
export type TopoState = "ok" | "impact" | "alarm" | "fault";

/** What a tile looks like: the glyph is chosen by this. */
export type TopoKind =
  | "feed"
  | "generator"
  | "ups"
  | "panel"
  | "pdu"
  | "chiller"
  | "cdu"
  | "crah"
  | "room"
  | "rack"
  | "server"
  | "switch"
  | "storage"
  | "vm"
  | "cluster"
  | "service"
  | "db_cluster"
  | "db_instance"
  | "storage_pool"
  | "storage_controller"
  | "sdn_controller"
  | "vtep"
  | "overlay_segment"
  | "nfv_function"
  | "cni"
  | "network_policy"
  | "ingress"
  | "k8s_cluster"
  | "k8s_node"
  | "k8s_workload"
  | "app_instance"
  | "load_balancer"
  | "session_store"
  | "circuit_breaker"
  | "mesh_sidecar"
  | "mesh_control"
  | "region";

/** What the board reads of a world: the part of `WorldReader` that tells what is, and how it is doing. */
export interface TopologySource {
  readonly index: BlueprintIndex;
  time(): number;
  stateOf(id: string): EntityState;
  faults(): readonly Fault[];
  alarms(): readonly Alarm[];
  linkUp(linkId: string): boolean;
  /** What the agents have been touching, as equipment ids (ADR-0084 step 2; empty until a run is watched). */
  readonly touched?: ReadonlySet<string>;
  /** Equipment another team is working on right now, with the words for the tile ("교체 중 · 벤더"; REQ-093). */
  readonly partners?: ReadonlyMap<string, string>;
  /** An earlier reading, to tell which way the temperatures are going. */
  readonly earlier?: Earlier;
}

/** Rack inlet temperatures at an earlier time: enough to say how fast a room is warming. */
export interface Earlier {
  readonly t: number;
  readonly inletC: ReadonlyMap<string, number>;
}

export interface Stage {
  readonly id: string;
  readonly label: string;
}

/** One piece of equipment as the board sees it. */
export interface TopoNode {
  readonly id: string;
  readonly kind: TopoKind;
  readonly name: string;
  readonly state: TopoState;
  readonly touched: boolean;
  /** Set while another team works on it: the line says so instead of the usual status. */
  readonly partner?: string;
  /** The one line of status under the name, with one number in it. */
  readonly line: string;
  /** Servers that stand on this piece, or are inside it. */
  readonly servers: number;
}

/** The classes a group is made of: what the tile is about. Faults, alarms and what the agent touches stand alone first. */
export type TileClass = "fault" | "alarm" | "touch" | "impact" | "ok";

export interface Tile {
  /** The equipment id for a tile of one thing; a made-up id for a group. */
  readonly id: string;
  /** Index into `Board.stages`. */
  readonly stage: number;
  readonly kind: TopoKind;
  /** More than one thing folded into this tile. */
  readonly group: boolean;
  readonly name: string;
  /** The status line: one number. */
  readonly line: string;
  readonly state: TopoState;
  readonly touched: boolean;
  /** Another team is working on it: "교체 중 · 벤더". */
  readonly partner?: string;
  /** How many pieces of equipment the tile stands for (1 unless it is a group). */
  readonly count: number;
  /** Servers on it, counted once each. */
  readonly servers: number;
  /** The states of what leans on this tile one stage on, as shares that add to 1. */
  readonly bar: ReadonlyArray<readonly [number, TopoState]>;
  /** For a group: the path of containers to open so that it falls apart a level (see `Board.path`). */
  readonly open?: readonly string[];
  /** Where a group is, in words: the container it was folded under. */
  readonly where?: string;
  /** The tile is what was picked in the 3D view (or its neighbour in the direction asked for). */
  readonly focus: boolean;
}

export interface Edge {
  readonly from: string;
  readonly to: string;
  /** cold or hot for cooling (hot where the heat is the trouble), power, net. */
  readonly kind: "cold" | "hot" | "power" | "net";
  /** How many pieces of equipment on the receiving side lean on the supplying tile. */
  readonly count: number;
  /** The supply is cut: the pipe is drawn as dots. */
  readonly live: boolean;
}

export interface Crumb {
  readonly id: string;
  readonly name: string;
}

export interface Board {
  readonly layer: LayerId;
  readonly stages: readonly Stage[];
  readonly tiles: readonly Tile[];
  readonly edges: readonly Edge[];
  /** The containers that are opened, from the site down: the way back out. */
  readonly path: readonly Crumb[];
  /** How much was drawn and how much was folded. */
  readonly stats: { readonly tiles: number; readonly entities: number; readonly folded: number };
}

/** The most tiles a board holds (ADR-0084). */
export const MAX_TILES = 150;
