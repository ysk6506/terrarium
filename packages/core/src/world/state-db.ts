/**
 * The state of the database and storage-HA entities (REQ-095), and how they start: roles and the primary where the
 * blueprint's props and links put them. The rest of the world's state is in state.ts, which re-exports these.
 */
import type { Entity } from "./blueprint";
import {
  controllersOf,
  type DbRole,
  type DbStatus,
  instancesOf,
  nodesOfPool,
  poolDef,
  roleOfProps,
} from "./db";
import type { BlueprintIndex } from "./graph";
import type { EntityState } from "./state";

interface Base {
  health: "ok" | "warning" | "critical";
}

/** A database instance (REQ-095): its role now, how far behind the primary it is, and whether it holds lost data. */
export interface DbInstanceState extends Base {
  kind: "db_instance";
  role: DbRole;
  status: DbStatus;
  /** Seconds of writes this copy has not yet received from the primary. */
  lagS: number;
  /** Seconds of writes that were lost when this instance became primary (or was restored), 0 when none were. */
  lostS: number;
  dataLoss: boolean;
  /** Up, but nothing can be written (the disk is full, the file system is read-only). */
  readOnly: boolean;
  /** Why it is not ok, one short sentence; absent while ok. */
  why?: string;
  /** A restore from a backup under way, and the error of the last one that failed. */
  restore?: { backup: string; startedAt: number; until: number; failsAt?: number };
  restoreError?: string;
}
/** A database cluster (REQ-095): who is primary, and the clock of the cluster's own failover. */
export interface DbClusterState extends Base {
  kind: "db_cluster";
  /** The instance that takes writes; `null` when there is none. */
  primary: string | null;
  /** World time the cluster first found its primary gone (auto failover counts `detectS` from here). */
  downSince?: number;
  /** Two instances both think they are primary. */
  splitBrain: boolean;
  /** Promotions so far, by an operator or by the cluster. */
  failovers: number;
  /** Seconds of writes the last promotion lost. */
  lastLostS: number;
  /** World time an active-passive standby is up after a takeover (the standby needs a minute or two to start). */
  startsAt?: number;
}
/** A storage controller (REQ-095): active or waiting, and whether its path to the hosts is cut. */
export interface StorageControllerState extends Base {
  kind: "storage_controller";
  active: boolean;
  status: "ok" | "down";
  path: "ok" | "cut";
}
/** A storage pool (REQ-095): how many full copies of the data stand, and how far the next copy is made. */
export interface StoragePoolState extends Base {
  kind: "storage_pool";
  status: "ok" | "degraded" | "down";
  /** Copies of the data that stand now, and how many there should be. */
  copies: number;
  wanted: number;
  /** 0..100: how much of the missing copy has been made again (100 when nothing is being made). */
  rebuildPct: number;
  /** World time the copy being made started. */
  rebuildSince?: number;
  dataLoss: boolean;
  /** Storage nodes standing at the last step (a distributed pool; a drop is a lost copy). */
  nodesUp: number;
  /** The controller the hosts talk to now (a pair of controllers), `null` for a distributed pool. */
  activePath: string | null;
  /** World time multipath is on the other path (the hosts need seconds to notice). */
  switchesAt?: number;
  why?: string;
}

type StateFactory = () =>
  | DbInstanceState
  | DbClusterState
  | StorageControllerState
  | StoragePoolState;

export const DB_FACTORIES: Readonly<
  Record<"db_instance" | "db_cluster" | "storage_controller" | "storage_pool", StateFactory>
> = {
  db_instance: () => ({
    kind: "db_instance",
    health: "ok",
    role: "primary",
    status: "ok",
    lagS: 0,
    lostS: 0,
    dataLoss: false,
    readOnly: false,
  }),
  db_cluster: () => ({
    kind: "db_cluster",
    health: "ok",
    primary: null,
    splitBrain: false,
    failovers: 0,
    lastLostS: 0,
  }),
  storage_controller: () => ({
    kind: "storage_controller",
    health: "ok",
    active: false,
    status: "ok",
    path: "ok",
  }),
  storage_pool: () => ({
    kind: "storage_pool",
    health: "ok",
    status: "ok",
    copies: 1,
    wanted: 1,
    rebuildPct: 100,
    dataLoss: false,
    nodesUp: 0,
    activePath: null,
  }),
};

function placePool(state: StoragePoolState, entity: Entity, index: BlueprintIndex): void {
  const def = poolDef(entity);
  const nodes = nodesOfPool(index, entity.id).length;
  state.wanted = def.mode === "distributed" && nodes > 0 ? def.copies : 1;
  state.copies = state.wanted;
  state.nodesUp = nodes;
  state.activePath = controllersOf(index, entity.id)[0]?.id ?? null;
}

/** Roles, primary and active controller start where the blueprint's props and links put them. */
export function placeDatabase(state: EntityState, entity: Entity, index: BlueprintIndex): void {
  if (state.kind === "db_instance") state.role = roleOfProps(entity);
  else if (state.kind === "db_cluster") {
    const members = instancesOf(index, entity.id);
    state.primary = (members.find((m) => roleOfProps(m) === "primary") ?? members[0])?.id ?? null;
  } else if (state.kind === "storage_pool") placePool(state, entity, index);
  else if (state.kind === "storage_controller") {
    const pool = index.outgoing(entity.id, "member_of")[0]?.to;
    state.active = pool !== undefined && controllersOf(index, pool)[0]?.id === entity.id;
  }
}
