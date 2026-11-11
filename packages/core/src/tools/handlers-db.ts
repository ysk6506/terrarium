/**
 * The handlers of the database and storage-HA tools (REQ-095): they read the state the physics keeps and give a
 * command to the world. A promotion says plainly how many seconds of writes it lost, because that is what an operator
 * would want to know before and after.
 */
import { InvalidValueError, round } from "@terrarium/core/kernel";
import {
  backupAgeS,
  bestCandidate,
  clusterOf,
  controllersOf,
  DB_ROLE_LABELS,
  DB_SHAPE_LABELS,
  dbClusterDef,
  type Entity,
  hostedOn,
  instancesOf,
  nodesOfPool,
  poolDef,
  poolOfInstance,
  RESTORE_S,
  type WorldPort,
} from "@terrarium/core/world";
import type { Args, ToolContext } from "./handlers";

type Handler = (ctx: ToolContext, args: Args) => unknown;

const str = (args: Args, key: string): string => String(args[key]);

/** The cluster an id names: the cluster itself, or the cluster of an instance. */
function clusterNamed(world: WorldPort, id: string): Entity {
  const e = world.index.entity(id);
  const cluster = e.kind === "db_instance" ? clusterOf(world.index, id) : e;
  if (!cluster || cluster.kind !== "db_cluster")
    throw new InvalidValueError(`'${id}'는 데이터베이스 클러스터도 인스턴스도 아니에요`);
  return cluster;
}

function instanceRow(world: WorldPort, e: Entity) {
  const s = world.stateAs(e.id, "db_instance");
  const host = hostedOn(world.index, e.id);
  const pool = poolOfInstance(world.index, e.id);
  return {
    id: e.id,
    name: e.name,
    role: s.role,
    roleLabel: DB_ROLE_LABELS[s.role],
    status: s.status,
    ...(s.why ? { why: s.why } : {}),
    lagSeconds: round(s.lagS, 1),
    canWrite: s.status !== "down" && !s.readOnly && s.role === "primary",
    ...(s.dataLoss ? { dataLoss: `${round(s.lostS, 1)}초만큼의 쓰기를 잃었어요` } : {}),
    ...(host ? { host } : {}),
    ...(pool ? { pool } : {}),
    ...(s.restore ? { restoring: s.restore.backup } : {}),
    ...(s.restoreError ? { lastRestoreError: s.restoreError } : {}),
  };
}

const dbStatus: Handler = (ctx, args) => {
  const { world } = ctx;
  const cluster = clusterNamed(world, str(args, "cluster"));
  const def = dbClusterDef(cluster);
  const cs = world.stateAs(cluster.id, "db_cluster");
  const primary = cs.primary ? world.stateAs(cs.primary, "db_instance") : undefined;
  const waiting =
    def.failover === "auto" &&
    !cs.splitBrain &&
    cs.downSince !== undefined &&
    (primary === undefined || primary.status === "down");
  return {
    cluster: cluster.id,
    name: cluster.name,
    shape: def.shape,
    shapeLabel: DB_SHAPE_LABELS[def.shape],
    failover: def.failover,
    ...(def.failover === "auto" ? { detectSeconds: def.detectS } : {}),
    primary: cs.primary,
    splitBrain: cs.splitBrain,
    failovers: cs.failovers,
    ...(cs.failovers > 0 ? { lastPromotionLostSeconds: round(cs.lastLostS, 1) } : {}),
    instances: instancesOf(world.index, cluster.id).map((e) => instanceRow(world, e)),
    backups: Array.from({ length: def.backups }, (_, i) => ({
      id: `backup-${i + 1}`,
      ageHours: round(backupAgeS(cluster, i + 1) / 3600, 1),
    })),
    ...(waiting
      ? {
          autoFailover: {
            promotesInSeconds: Math.max(
              0,
              Math.round(def.detectS - (world.time() - (cs.downSince as number))),
            ),
          },
        }
      : {}),
  };
};

/** What a promotion did, in the words of the answer. */
function promoted(world: WorldPort, id: string, lagBefore: number, split: boolean) {
  const s = world.stateAs(id, "db_instance");
  const cs = world.stateAs(clusterOf(world.index, id)?.id ?? "", "db_cluster");
  return {
    instance: id,
    role: s.role,
    ...(split
      ? {
          note: `다른 인스턴스는 격리했어요. 분리된 뒤 그쪽에 쓴 ${round(cs.lastLostS, 0)}초만큼의 쓰기는 버려졌어요.`,
          discardedSeconds: round(cs.lastLostS, 0),
        }
      : {
          lostSeconds: round(lagBefore, 1),
          note:
            lagBefore >= 1
              ? `복제 지연 ${round(lagBefore, 1)}초만큼의 쓰기를 잃었어요.`
              : "복제가 거의 따라와 있어서 잃은 쓰기는 1초 미만이에요.",
        }),
  };
}

const dbPromote: Handler = (ctx, args) => {
  const id = str(args, "instance");
  const before = ctx.world.stateAs(id, "db_instance").lagS;
  const cluster = clusterOf(ctx.world.index, id);
  const split = cluster ? ctx.world.stateAs(cluster.id, "db_cluster").splitBrain : false;
  ctx.world.apply({ type: "db.promote", target: id }, "tool:db_promote");
  return promoted(ctx.world, id, before, split);
};

const dbFailover: Handler = (ctx, args) => {
  const { world } = ctx;
  const id = world.index.entity(str(args, "cluster")).id;
  const pick = bestCandidate(world, world.index.entity(id));
  const before = pick ? world.stateAs(pick.id, "db_instance").lagS : 0;
  world.apply({ type: "db.failover", target: id }, "tool:db_failover");
  return { cluster: id, ...(pick ? promoted(world, pick.id, before, false) : {}) };
};

const dbRestore: Handler = (ctx, args) => {
  const id = str(args, "instance");
  const backup = args.backup === undefined ? "latest" : str(args, "backup");
  const e = ctx.world.index.entity(id);
  const cluster = clusterOf(ctx.world.index, id);
  const primary = ctx.world.stateAs(id, "db_instance").role === "primary";
  ctx.world.apply({ type: "db.restore", target: id, backup }, "tool:db_restore");
  const n = Number(
    /\d+/.exec(ctx.world.stateAs(id, "db_instance").restore?.backup ?? "1")?.[0] ?? 1,
  );
  return {
    instance: e.id,
    backup: ctx.world.stateAs(id, "db_instance").restore?.backup ?? backup,
    restoreTakesSeconds: RESTORE_S,
    note: primary
      ? `복원하는 동안 멈춰요. 끝나면 백업 이후의 쓰기(약 ${round(cluster ? backupAgeS(cluster, n) / 3600 : 0, 1)}시간치)를 잃어요. db_status로 진행을 보세요.`
      : "복원하는 동안 멈춰요. 끝나면 프라이머리를 따라잡아요. db_status로 진행을 보세요.",
  };
};

function poolRow(world: WorldPort, poolId: string) {
  const pool = world.index.entity(poolId);
  const def = poolDef(pool);
  const s = world.stateAs(poolId, "storage_pool");
  const common = {
    pool: poolId,
    name: pool.name,
    mode: def.mode,
    status: s.status,
    ...(s.why ? { why: s.why } : {}),
    dataLoss: s.dataLoss,
  };
  if (def.mode === "distributed")
    return {
      ...common,
      copies: s.copies,
      wanted: s.wanted,
      rebuildPercent: round(s.rebuildPct, 0),
      rebuildTakesSeconds: def.rebuildS,
      nodes: nodesOfPool(world.index, poolId).map((n) => ({
        id: n.id,
        up: world.faultsOn(n.id).every((f) => f.type !== "storage_node_lost"),
      })),
    };
  return {
    ...common,
    multipath: def.multipath,
    activePath: s.activePath,
    ...(s.switchesAt !== undefined
      ? { switchingInSeconds: Math.max(0, Math.round(s.switchesAt - world.time())) }
      : {}),
    controllers: controllersOf(world.index, poolId).map((c) => {
      const cs = world.stateAs(c.id, "storage_controller");
      return { id: c.id, name: c.name, active: cs.active, status: cs.status, path: cs.path };
    }),
  };
}

const storageStatus: Handler = (ctx, args) => {
  const { world } = ctx;
  const e = world.index.entity(str(args, "id"));
  if (e.kind === "storage_pool") return poolRow(world, e.id);
  if (e.kind !== "storage_controller")
    throw new InvalidValueError(`'${e.id}'는 스토리지 풀도 컨트롤러도 아니에요`);
  const pool = world.index.outgoing(e.id, "member_of")[0]?.to;
  const cs = world.stateAs(e.id, "storage_controller");
  return {
    controller: e.id,
    name: e.name,
    active: cs.active,
    status: cs.status,
    path: cs.path,
    ...(pool ? { pool: poolRow(world, pool) } : {}),
  };
};

const storagePathSwitch: Handler = (ctx, args) => {
  const id = str(args, "controller");
  const pool = ctx.world.index.outgoing(id, "member_of")[0]?.to as string;
  const from = ctx.world.stateAs(pool, "storage_pool").activePath;
  ctx.world.apply({ type: "storage.path_switch", target: id }, "tool:storage_path_switch");
  return {
    controller: id,
    pool,
    from,
    to: id,
    note: "호스트가 이제 이 컨트롤러를 거쳐요. storage_status로 확인하세요.",
  };
};

export const DB_HANDLERS: Readonly<Record<string, Handler>> = {
  db_status: dbStatus,
  db_promote: dbPromote,
  db_failover: dbFailover,
  db_restore: dbRestore,
  storage_status: storageStatus,
  storage_path_switch: storagePathSwitch,
};
