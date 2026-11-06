/**
 * The database and storage-HA layers (REQ-095, ADR-0107 item 6, docs/design-docs/db-storage-layers.md).
 *
 * A database cluster is a set of instances; one is the primary (it takes writes), the others are secondaries (a copy
 * that follows the primary, `lagS` seconds behind) or a standby (a copy that is only started when the primary is gone).
 * What the cluster is built as (`shape`) and how it reacts to losing its primary (`failover`) are settings in the
 * entity's props; who is primary now, the lag, and whether data was lost are state (state.ts). A storage pool is the
 * place the data lives: behind a pair of controllers and paths (`dual`) or spread over nodes in copies (`distributed`).
 * Services lean on a cluster or a pool with a `depends_on` link; their health follows the state (db-health.ts).
 */
import type { Entity, PropValue } from "./blueprint";
import type { BlueprintIndex } from "./graph";

export type DbShape = "single" | "active_passive" | "shared_aa" | "replicated" | "auto_failover";
export type DbRole = "primary" | "secondary" | "standby";
export type DbStatus = "ok" | "degraded" | "down";

export const DB_SHAPES: readonly DbShape[] = [
  "single",
  "active_passive",
  "shared_aa",
  "replicated",
  "auto_failover",
];

export const DB_SHAPE_LABELS: Readonly<Record<DbShape, string>> = {
  single: "단일 인스턴스 + 백업",
  active_passive: "액티브-패시브 클러스터",
  shared_aa: "공유 디스크 액티브-액티브",
  replicated: "프라이머리-세컨더리 복제",
  auto_failover: "자동 페일오버 + 다중 복제",
};

export const DB_ROLE_LABELS: Readonly<Record<DbRole, string>> = {
  primary: "프라이머리",
  secondary: "세컨더리",
  standby: "대기",
};

/** How the cluster is set and what it does when the primary is gone. */
export interface DbClusterDef {
  readonly shape: DbShape;
  /** `auto`: the cluster promotes by itself once it has seen the primary gone for `detectS`. */
  readonly failover: "manual" | "auto";
  /** Seconds the cluster needs to notice that the primary is gone (auto only). */
  readonly detectS: number;
  /** Voting members; with fewer than 3 a cluster cannot tell a dead primary from a cut wire (split brain is possible). */
  readonly quorum: number;
  /** Replication lag above which the service is slow, seconds. */
  readonly lagSlowS: number;
  /** Backups kept, newest first, and how old the newest is. */
  readonly backups: number;
  readonly backupAgeS: number;
}

export const DEFAULT_DETECT_S = 30;
export const DEFAULT_LAG_SLOW_S = 30;
/** Seconds a restore from a backup takes. */
export const RESTORE_S = 1200;
/** Seconds a restore runs before the check on a bad backup fails it. */
export const RESTORE_FAIL_S = 240;
/** Seconds a standby of an active-passive cluster needs to take over after it was told to. */
export const STANDBY_START_S = 90;

const num = (props: Entity["props"], key: string): number | undefined =>
  typeof props[key] === "number" ? (props[key] as number) : undefined;

export function dbClusterDef(entity: Entity): DbClusterDef {
  const p = entity.props;
  const shape = DB_SHAPES.find((s) => s === p.shape) ?? "single";
  return {
    shape,
    failover: p.failover === "auto" ? "auto" : "manual",
    detectS: num(p, "detectS") ?? DEFAULT_DETECT_S,
    quorum: num(p, "quorum") ?? (shape === "auto_failover" ? 3 : 1),
    lagSlowS: num(p, "lagSlowS") ?? DEFAULT_LAG_SLOW_S,
    backups: num(p, "backups") ?? 2,
    backupAgeS: num(p, "backupAgeS") ?? 6 * 3600,
  };
}

/** The props of a cluster entity for the given settings (the inverse of `dbClusterDef`, for generators). */
export function dbClusterProps(
  def: Partial<DbClusterDef> & { shape: DbShape },
): Record<string, PropValue> {
  return {
    shape: def.shape,
    failover: def.failover ?? "manual",
    ...(def.detectS !== undefined ? { detectS: def.detectS } : {}),
    ...(def.quorum !== undefined ? { quorum: def.quorum } : {}),
    ...(def.lagSlowS !== undefined ? { lagSlowS: def.lagSlowS } : {}),
    ...(def.backups !== undefined ? { backups: def.backups } : {}),
    ...(def.backupAgeS !== undefined ? { backupAgeS: def.backupAgeS } : {}),
  };
}

export const roleOfProps = (entity: Entity): DbRole =>
  entity.props.role === "secondary" || entity.props.role === "standby"
    ? entity.props.role
    : "primary";

/** The pool's setting: how it is laid out, how many copies it keeps, and whether the host switches paths by itself. */
export interface PoolDef {
  readonly mode: "dual" | "distributed";
  /** Copies of the data a distributed pool keeps. */
  readonly copies: number;
  /** Whether the hosts switch to the other path by themselves (multipath); otherwise an operator does. */
  readonly multipath: boolean;
  /** Seconds a lost copy takes to be made again. */
  readonly rebuildS: number;
}

export const DEFAULT_REBUILD_S = 900;
/** Seconds multipath needs to notice a dead path and use the other one. */
export const MULTIPATH_SWITCH_S = 10;

export function poolDef(entity: Entity): PoolDef {
  const p = entity.props;
  return {
    mode: p.mode === "distributed" ? "distributed" : "dual",
    copies: num(p, "copies") ?? 3,
    multipath: p.multipath === true,
    rebuildS: num(p, "rebuildS") ?? DEFAULT_REBUILD_S,
  };
}

export function poolProps(def: Partial<PoolDef>): Record<string, PropValue> {
  return {
    mode: def.mode ?? "dual",
    copies: def.copies ?? 3,
    multipath: def.multipath ?? false,
    ...(def.rebuildS !== undefined ? { rebuildS: def.rebuildS } : {}),
  };
}

// ── looking things up in the blueprint ────────────────────────────────────────────────────────

/** The instances of a cluster, by id. */
export const instancesOf = (index: BlueprintIndex, clusterId: string): Entity[] =>
  index
    .incoming(clusterId, "member_of")
    .map((l) => index.find(l.from))
    .filter((e): e is Entity => e?.kind === "db_instance")
    .sort((a, b) => a.id.localeCompare(b.id));

export const clusterOf = (index: BlueprintIndex, instanceId: string): Entity | undefined => {
  const to = index.outgoing(instanceId, "member_of")[0]?.to;
  return to ? index.find(to) : undefined;
};

/** The VM or server a database instance runs on, or the storage array a controller sits in. */
export const hostedOn = (index: BlueprintIndex, id: string): string | undefined =>
  index.outgoing(id, "hosted_on")[0]?.to;

/** The pool an instance keeps its data in, if it has one. */
export const poolOfInstance = (index: BlueprintIndex, id: string): string | undefined =>
  index.outgoing(id, "stored_on").find((l) => index.find(l.to)?.kind === "storage_pool")?.to;

/** The controllers of a pool, by id. */
export const controllersOf = (index: BlueprintIndex, poolId: string): Entity[] =>
  index
    .incoming(poolId, "member_of")
    .map((l) => index.find(l.from))
    .filter((e): e is Entity => e?.kind === "storage_controller")
    .sort((a, b) => a.id.localeCompare(b.id));

/** The storage nodes behind a pool, by id. */
export const nodesOfPool = (index: BlueprintIndex, poolId: string): Entity[] =>
  index
    .outgoing(poolId, "backed_by")
    .map((l) => index.find(l.to))
    .filter((e): e is Entity => e?.kind === "storage")
    .sort((a, b) => a.id.localeCompare(b.id));

/** The pools and clusters a service leans on. */
export const dependenciesOf = (index: BlueprintIndex, serviceId: string): Entity[] =>
  index
    .outgoing(serviceId, "depends_on")
    .map((l) => index.find(l.to))
    .filter((e): e is Entity => e !== undefined);
