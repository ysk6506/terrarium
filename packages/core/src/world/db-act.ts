/**
 * What an operator does to a database or to storage (REQ-095, ADR-0107 item 6): promote an instance, force a
 * failover of a cluster, restore an instance from a backup, switch the path of a storage pool to the other
 * controller. Like the other commands they are world events and change state only through the reducers here. The
 * cluster itself gives the first two when it fails over by itself (cause `cluster`).
 */
import { ConflictError, InvalidValueError } from "@terrarium/core/kernel";
import type { Entity } from "./blueprint";
import {
  clusterOf,
  controllersOf,
  DB_SHAPE_LABELS,
  dbClusterDef,
  instancesOf,
  RESTORE_FAIL_S,
  RESTORE_S,
  STANDBY_START_S,
} from "./db";
import type { WorldReader } from "./world";

export type DbCommand =
  /** Make this instance the primary. With two primaries (split brain) it is the one that is kept. */
  | { readonly type: "db.promote"; readonly target: string }
  /** Promote the best secondary of this cluster (the cluster software does it, or an operator forces it). */
  | { readonly type: "db.failover"; readonly target: string }
  /** Restore this instance from a backup (`latest` or `backup-N`, 1 the newest). */
  | { readonly type: "db.restore"; readonly target: string; readonly backup: string }
  /** Hosts talk to the pool through this controller from now on. */
  | { readonly type: "storage.path_switch"; readonly target: string };

export const isDbCommand = (type: string): boolean =>
  type === "db.promote" ||
  type === "db.failover" ||
  type === "db.restore" ||
  type === "storage.path_switch";

const alive = (world: WorldReader, id: string): boolean =>
  world.stateAs(id, "db_instance").status !== "down";

/** The backup a request names as its number, 1 the newest; `undefined` when it names none. */
export function backupNumber(backup: string, kept: number): number | undefined {
  if (backup === "latest") return 1;
  const n = /^backup-(\d+)$/.exec(backup)?.[1];
  const k = n === undefined ? NaN : Number(n);
  return Number.isInteger(k) && k >= 1 && k <= kept ? k : undefined;
}

function clusterAndShape(world: WorldReader, instanceId: string): Entity {
  const cluster = clusterOf(world.index, instanceId);
  if (!cluster) throw new InvalidValueError(`'${instanceId}'는 어느 클러스터에도 속하지 않아요`);
  return cluster;
}

function checkPromote(world: WorldReader, id: string): void {
  const state = world.stateAs(id, "db_instance");
  const cluster = clusterAndShape(world, id);
  const cdef = dbClusterDef(cluster);
  const cs = world.stateAs(cluster.id, "db_cluster");
  if (cdef.shape === "single" || cdef.shape === "shared_aa")
    throw new InvalidValueError(`${DB_SHAPE_LABELS[cdef.shape]}에는 승격할 곳이 없어요`);
  if (state.status === "down")
    throw new InvalidValueError(`'${id}'가 멈춰 있어서 승격할 수 없어요`);
  if (state.restore) throw new ConflictError(`'${id}'는 복원 중이에요`);
  if (!cs.splitBrain && cs.primary === id) throw new ConflictError(`'${id}'는 이미 프라이머리예요`);
}

function checkFailover(world: WorldReader, id: string): void {
  const cluster = world.index.entity(id);
  if (cluster.kind !== "db_cluster")
    throw new InvalidValueError(`'${id}'는 데이터베이스 클러스터가 아니에요`);
  const cdef = dbClusterDef(cluster);
  const cs = world.stateAs(id, "db_cluster");
  if (cdef.shape === "single" || cdef.shape === "shared_aa")
    throw new InvalidValueError(`${DB_SHAPE_LABELS[cdef.shape]}에는 넘겨받을 인스턴스가 없어요`);
  if (cs.splitBrain)
    throw new ConflictError("스플릿 브레인이라 자동으로 고를 수 없어요. 남길 쪽을 골라 승격하세요");
  if (!bestCandidate(world, cluster)) throw new ConflictError("이어받을 수 있는 인스턴스가 없어요");
}

function checkRestore(world: WorldReader, id: string, backup: string): void {
  const state = world.stateAs(id, "db_instance");
  const cluster = clusterAndShape(world, id);
  if (backupNumber(backup, dbClusterDef(cluster).backups) === undefined)
    throw new InvalidValueError(
      `백업은 latest 또는 backup-1 … backup-${dbClusterDef(cluster).backups} 중에서 골라요`,
    );
  if (state.restore) throw new ConflictError(`'${id}'는 이미 복원 중이에요`);
}

function checkPathSwitch(world: WorldReader, id: string): void {
  const controller = world.stateAs(id, "storage_controller");
  const pool = world.index.outgoing(id, "member_of")[0]?.to;
  if (!pool) throw new InvalidValueError(`'${id}'는 어느 풀에도 속하지 않아요`);
  const ps = world.stateAs(pool, "storage_pool");
  if (ps.activePath === id) throw new ConflictError(`이미 '${id}' 경로를 쓰고 있어요`);
  if (controller.status === "down" || controller.path === "cut")
    throw new InvalidValueError(`'${id}' 경로도 쓸 수 없어요(고장이거나 끊겼어요)`);
}

/** Refuse commands that make no sense before they are recorded. */
export function checkDbCommand(world: WorldReader, command: DbCommand): void {
  if (command.type === "db.promote") checkPromote(world, command.target);
  else if (command.type === "db.failover") checkFailover(world, command.target);
  else if (command.type === "db.restore") checkRestore(world, command.target, command.backup);
  else checkPathSwitch(world, command.target);
}

/** The instance a failover picks: one that is up and not the primary, the one least behind first. */
export function bestCandidate(world: WorldReader, cluster: Entity): Entity | undefined {
  const cs = world.stateAs(cluster.id, "db_cluster");
  return instancesOf(world.index, cluster.id)
    .filter((e) => e.id !== cs.primary && alive(world, e.id))
    .filter((e) => world.stateAs(e.id, "db_instance").role !== "primary")
    .sort(
      (a, b) =>
        world.stateAs(a.id, "db_instance").lagS - world.stateAs(b.id, "db_instance").lagS ||
        a.id.localeCompare(b.id),
    )[0];
}

/** What the reducers read of the world beyond reading it. */
export interface DbActContext {
  readonly world: WorldReader;
  readonly t: number;
  dropFault(faultId: string): void;
}

function splitBrainFault(ctx: DbActContext, clusterId: string) {
  return ctx.world.faultsOn(clusterId).find((f) => f.type === "db_split_brain");
}

/** Two primaries: the chosen one stays, the other is fenced and what it wrote since the split is thrown away. */
function keepOne(ctx: DbActContext, cluster: Entity, keep: string): void {
  const cs = ctx.world.stateAs(cluster.id, "db_cluster");
  const fault = splitBrainFault(ctx, cluster.id);
  const discarded = fault ? Math.max(0, Math.round(ctx.t - fault.since)) : 0;
  for (const e of instancesOf(ctx.world.index, cluster.id)) {
    const s = ctx.world.stateAs(e.id, "db_instance");
    if (e.id === keep) {
      s.role = "primary";
      s.lostS = 0;
      s.dataLoss = false;
    } else if (s.role === "primary") {
      s.role = "secondary";
      s.lagS = discarded;
      s.lostS = discarded;
    }
  }
  if (fault) ctx.dropFault(fault.id);
  cs.splitBrain = false;
  cs.primary = keep;
  cs.failovers += 1;
  cs.lastLostS = discarded;
  delete cs.downSince;
}

/** Make `id` the primary of its cluster. */
export function promote(ctx: DbActContext, id: string): void {
  const cluster = clusterOf(ctx.world.index, id) as Entity;
  const cs = ctx.world.stateAs(cluster.id, "db_cluster");
  if (cs.splitBrain) {
    keepOne(ctx, cluster, id);
    return;
  }
  const cdef = dbClusterDef(cluster);
  const next = ctx.world.stateAs(id, "db_instance");
  const lost = Math.round(next.lagS);
  const previous = cs.primary ? ctx.world.stateAs(cs.primary, "db_instance") : undefined;
  if (previous) {
    previous.role = cdef.shape === "active_passive" ? "standby" : "secondary";
  }
  for (const e of instancesOf(ctx.world.index, cluster.id)) {
    const s = ctx.world.stateAs(e.id, "db_instance");
    if (e.id !== id && s.role !== "primary" && s.status !== "down") s.lagS = 0;
  }
  next.role = "primary";
  next.lostS = lost;
  next.dataLoss = lost > 0;
  next.lagS = 0;
  cs.primary = id;
  cs.failovers += 1;
  cs.lastLostS = lost;
  delete cs.downSince;
  if (cdef.shape === "active_passive") cs.startsAt = ctx.t + STANDBY_START_S;
  else delete cs.startsAt;
}

/** The cluster promotes the instance it likes best. */
export function failoverCluster(ctx: DbActContext, id: string): void {
  const cluster = ctx.world.index.entity(id);
  const pick = bestCandidate(ctx.world, cluster);
  if (pick) promote(ctx, pick.id);
}

/** Start restoring an instance from a backup; physics finishes it (physics/db.ts). */
export function startRestore(ctx: DbActContext, id: string, backup: string): void {
  const cluster = clusterOf(ctx.world.index, id) as Entity;
  const n = backupNumber(backup, dbClusterDef(cluster).backups) ?? 1;
  const bad = ctx.world.faultsOn(cluster.id).find((f) => f.type === "db_backup_corrupt");
  const corrupt = bad !== undefined && n <= (bad.params.bad ?? 1);
  const s = ctx.world.stateAs(id, "db_instance");
  delete s.restoreError;
  s.restore = {
    backup: n === 1 ? "backup-1" : backup,
    startedAt: ctx.t,
    until: ctx.t + RESTORE_S,
    ...(corrupt ? { failsAt: ctx.t + RESTORE_FAIL_S } : {}),
  };
}

/** The hosts use this controller's path from now on. */
export function switchPath(ctx: DbActContext, id: string): void {
  const pool = ctx.world.index.outgoing(id, "member_of")[0]?.to as string;
  const ps = ctx.world.stateAs(pool, "storage_pool");
  ps.activePath = id;
  delete ps.switchesAt;
  for (const c of controllersOf(ctx.world.index, pool))
    ctx.world.stateAs(c.id, "storage_controller").active = c.id === id;
}

/** How a backup is described: its number and how old it is, for tools and messages. */
export function backupAgeS(cluster: Entity, n: number): number {
  return dbClusterDef(cluster).backupAgeS + (n - 1) * 86_400;
}

/** Restarting the database process on a host ends the faults a restart can: a stopped secondary, a broken replication. */
export function restartDatabase(ctx: DbActContext, hostId: string): void {
  for (const l of ctx.world.index.incoming(hostId, "hosted_on")) {
    for (const f of ctx.world.faultsOn(l.from))
      if (f.type === "db_replication_broken" || f.type === "db_secondary_down") ctx.dropFault(f.id);
  }
}
