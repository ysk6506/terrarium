/**
 * Databases and storage pools move with time and with the faults on them (REQ-095, ADR-0107 item 6): a broken
 * replication lets the lag climb, a lost storage node is made again copy by copy, a restore from a backup finishes
 * (or fails on a bad backup), and a cluster set to fail over by itself promotes a secondary once it has seen the
 * primary gone for the detection time. That promotion is a world event with the cause `cluster`, so scoring can tell
 * a recovery the cluster made from one the agent made.
 *
 * Each step: pools first (controllers, paths, copies), then instances (what is up, who lags), then clusters (who is
 * primary, split brain, the cluster's own failover). Services read the result in the same step (services.ts).
 */
import { hash53 } from "@terrarium/core/kernel";
import {
  backupAgeS,
  bestCandidate,
  clusterOf,
  controllersOf,
  DB_PROCESS,
  type DbStatus,
  DISK_FULL_PCT,
  dbClusterDef,
  hostedOn,
  hostVerdict,
  instancesOf,
  line,
  logTo,
  MULTIPATH_SWITCH_S,
  nodesOfPool,
  poolDef,
  poolOfInstance,
  type StateOf,
  serviceDef,
  type World,
  type WorldEvent,
} from "@terrarium/core/world";

const CAUSE = "physics";
/** The cluster software, not an operator and not physics: the cause of a promotion it makes by itself. */
export const CLUSTER_CAUSE = "cluster";
/** A copy that fell behind catches up this many seconds of lag each second. */
const CATCH_UP = 10;
/** A probe service with the default conditions, to ask how a host is doing without a particular service in mind. */
const PROBE = serviceDef({ id: "probe", kind: "service", name: "probe", props: {} });

const RANK: Readonly<Record<DbStatus, number>> = { ok: 0, degraded: 1, down: 2 };
const pct = (v: number): number => Math.round(v);

/** How far an asynchronous copy trails when nothing is wrong, seconds. */
export const baselineLag = (id: string): number => 0.2 + (hash53(`${id}|lag`) % 5) / 10;

// ── pools ──────────────────────────────────────────────────────────────────────────────────

function updateControllers(world: World, poolId: string): void {
  for (const c of controllersOf(world.index, poolId)) {
    const s = world.stateAs(c.id, "storage_controller");
    const faults = world.faultsOn(c.id);
    const array = hostedOn(world.index, c.id);
    const arrayOn = array
      ? (() => {
          const a = world.stateAs(array, "storage");
          return a.powered && a.adminOn;
        })()
      : true;
    s.status =
      !arrayOn || faults.some((f) => f.type === "storage_controller_failure") ? "down" : "ok";
    s.path = faults.some((f) => f.type === "storage_path_cut") ? "cut" : "ok";
  }
}

const usable = (s: StateOf<"storage_controller">): boolean => s.status === "ok" && s.path === "ok";

/** The system fixing itself is told in the log with the cause `cluster`, so scoring can tell it from the agent's work. */
function healed(world: World, events: WorldEvent[], text: string): void {
  events.push(world.apply({ type: "note", text }, CLUSTER_CAUSE));
}

function updateDualPool(
  world: World,
  pool: StateOf<"storage_pool">,
  poolId: string,
  events: WorldEvent[],
): void {
  const def = poolDef(world.index.entity(poolId));
  const list = controllersOf(world.index, poolId);
  const states = list.map((c) => ({ c, s: world.stateAs(c.id, "storage_controller") }));
  const now = world.time();
  const active = states.find((x) => x.c.id === pool.activePath);
  delete pool.why;
  if (active && usable(active.s)) {
    delete pool.switchesAt;
    pool.status = def.multipath && states.some((x) => !usable(x.s)) ? "degraded" : "ok";
    if (pool.status === "degraded") pool.why = "컨트롤러 하나로 버티고 있어요";
  } else {
    const other = states.find((x) => x.c.id !== pool.activePath && usable(x.s));
    const name = active?.c.name ?? "활성 경로";
    if (!other) {
      pool.status = "down";
      pool.why = "쓸 수 있는 경로가 없어요";
      delete pool.switchesAt;
    } else if (def.multipath) {
      pool.switchesAt ??= now + MULTIPATH_SWITCH_S;
      pool.status = "degraded";
      pool.why = "멀티패스가 다른 경로로 바꾸는 중이에요";
      if (now >= pool.switchesAt) {
        pool.activePath = other.c.id;
        delete pool.switchesAt;
        pool.why = "컨트롤러 하나로 버티고 있어요";
        healed(
          world,
          events,
          `${world.index.entity(poolId).name}: 멀티패스가 ${other.c.name} 경로로 바꿨어요`,
        );
      }
    } else {
      pool.status = "down";
      pool.why = `${name} 경로를 못 써요 — 다른 경로로 직접 바꿔야 해요`;
    }
  }
  for (const x of states) x.s.active = x.c.id === pool.activePath;
}

function nodeAlive(world: World, id: string): boolean {
  const s = world.stateAs(id, "storage");
  return s.powered && s.adminOn && !world.faultsOn(id).some((f) => f.type === "storage_node_lost");
}

/**
 * Copies are made again one at a time; each takes `rebuildS` and cannot start with no copy left to read.
 * Returns true in the step that makes the last copy that can be made.
 */
function rebuild(
  pool: StateOf<"storage_pool">,
  goal: number,
  rebuildS: number,
  dt: number,
  now: number,
): boolean {
  if (pool.copies >= goal) {
    pool.rebuildPct = 100;
    delete pool.rebuildSince;
    return false;
  }
  pool.rebuildSince ??= now;
  if (pool.copies < 1) return false;
  if (pool.rebuildPct >= 100) pool.rebuildPct = 0;
  pool.rebuildPct = Math.min(100, pool.rebuildPct + (dt / rebuildS) * 100);
  if (pool.rebuildPct < 100) return false;
  pool.copies += 1;
  if (pool.copies < goal) {
    pool.rebuildPct = 0;
    pool.rebuildSince = now;
    return false;
  }
  delete pool.rebuildSince;
  return true;
}

function updateDistributedPool(
  world: World,
  pool: StateOf<"storage_pool">,
  poolId: string,
  dt: number,
  events: WorldEvent[],
): void {
  const def = poolDef(world.index.entity(poolId));
  const alive = nodesOfPool(world.index, poolId).filter((n) => nodeAlive(world, n.id)).length;
  const now = world.time();
  if (pool.nodesUp > alive) {
    pool.copies = Math.max(0, pool.copies - (pool.nodesUp - alive));
    pool.rebuildPct = 0;
    pool.rebuildSince = now;
  }
  pool.nodesUp = alive;
  const goal = Math.min(pool.wanted, alive);
  if (rebuild(pool, goal, def.rebuildS, dt, now))
    healed(world, events, `${world.index.entity(poolId).name}: 복제본을 다시 다 채웠어요`);
  delete pool.why;
  pool.dataLoss = pool.dataLoss || pool.copies <= 0;
  if (pool.copies <= 0) {
    pool.status = "down";
    pool.why = "복제본이 모두 사라져 데이터를 잃었어요";
  } else if (pool.copies === 1 && pool.wanted > 1) {
    pool.status = "down";
    pool.why = "복제본이 1개뿐이라 쓰기가 막혔어요 — 하나를 더 잃으면 데이터를 잃어요";
  } else if (pool.copies < pool.wanted) {
    pool.status = "degraded";
    pool.why =
      pool.rebuildSince !== undefined
        ? `복제본 ${pool.copies}/${pool.wanted}개 — 다시 만드는 중 ${pct(pool.rebuildPct)}%`
        : `노드가 모자라 복제본이 ${pool.copies}/${pool.wanted}개예요`;
  } else pool.status = "ok";
}

function updatePool(world: World, poolId: string, dt: number, events: WorldEvent[]): void {
  const pool = world.stateAs(poolId, "storage_pool");
  updateControllers(world, poolId);
  if (poolDef(world.index.entity(poolId)).mode === "distributed")
    updateDistributedPool(world, pool, poolId, dt, events);
  else updateDualPool(world, pool, poolId, events);
}

// ── instances ──────────────────────────────────────────────────────────────────────────────

const worse = (a: DbStatus, b: DbStatus): DbStatus => (RANK[a] >= RANK[b] ? a : b);

/** A restore that has run its course: it ends in a good instance, or in the error of a bad backup. */
function stepRestore(world: World, id: string, events: WorldEvent[]): void {
  const s = world.stateAs(id, "db_instance");
  const r = s.restore;
  if (!r) return;
  const now = world.time();
  if (r.failsAt !== undefined && now >= r.failsAt) {
    s.restoreError = `${r.backup} 복원에 실패했어요 — 체크섬이 맞지 않아요(백업이 깨져 있어요)`;
    delete s.restore;
    return;
  }
  if (now < r.until) return;
  for (const f of world.faultsOn(id))
    if (f.type === "db_primary_down" || f.type === "db_secondary_down")
      events.push(world.apply({ type: "fault.remove", faultId: f.id }, CAUSE));
  const cluster = clusterOf(world.index, id);
  const n = Number(/\d+/.exec(r.backup)?.[0] ?? 1);
  if (s.role === "primary" && cluster) {
    s.lostS = backupAgeS(cluster, n);
    s.dataLoss = true;
  }
  s.lagS = 0;
  delete s.restore;
}

interface Reading {
  readonly status: DbStatus;
  readonly why?: string;
  readonly readOnly: boolean;
}

const DOWN = (why: string): Reading => ({ status: "down", why, readOnly: false });

/** What stops an instance by itself: a restore under way, a fault on it. */
function stoppedByItself(world: World, id: string): Reading | undefined {
  const s = world.stateAs(id, "db_instance");
  const faults = world.faultsOn(id);
  if (s.restore) {
    const done = (world.time() - s.restore.startedAt) / (s.restore.until - s.restore.startedAt);
    return DOWN(`${s.restore.backup}에서 복원하는 중이에요 (${pct(done * 100)}%)`);
  }
  if (faults.some((f) => f.type === "db_primary_down"))
    return DOWN("인스턴스가 죽었고 다시 시작해도 안 떠요(데이터 파일이 깨졌어요)");
  if (faults.some((f) => f.type === "db_secondary_down")) return DOWN("인스턴스가 멈춰 있어요");
  return undefined;
}

/** What the host under the instance does to it: dead, slow, or a disk that cannot be written. */
function fromHost(world: World, id: string): Reading {
  const host = hostedOn(world.index, id);
  if (!host) return { status: "ok", readOnly: false };
  const v = hostVerdict(world, host, PROBE);
  if (v.state === "dead") return DOWN(`올라간 곳이 멈췄어요 — ${v.why ?? ""}`);
  const os = (world.stateOf(host) as StateOf<"vm"> | StateOf<"server">).os;
  if (os && (os.diskPct >= DISK_FULL_PCT || os.fs === "ro"))
    return {
      status: "degraded",
      readOnly: true,
      why:
        os.fs === "ro"
          ? "파일시스템이 읽기 전용이라 쓸 수 없어요"
          : "디스크가 가득 차서 쓸 수 없어요",
    };
  return v.state === "slow"
    ? { status: "degraded", readOnly: false, ...(v.why ? { why: v.why } : {}) }
    : { status: "ok", readOnly: false };
}

/** What the pool that holds the data does to it. */
function fromPoolOf(world: World, id: string): Reading {
  const poolId = poolOfInstance(world.index, id);
  const p = poolId ? world.stateAs(poolId, "storage_pool") : undefined;
  if (p?.status === "down") return DOWN(`데이터가 있는 스토리지가 멈췄어요 — ${p.why ?? ""}`);
  return p?.status === "degraded"
    ? { status: "degraded", readOnly: false, ...(p.why ? { why: p.why } : {}) }
    : { status: "ok", readOnly: false };
}

function instanceStatus(world: World, id: string): Reading {
  const own = stoppedByItself(world, id);
  if (own) return own;
  const host = fromHost(world, id);
  if (host.status === "down") return host;
  const pool = fromPoolOf(world, id);
  if (pool.status === "down") return pool;
  const why = host.why ?? pool.why;
  return {
    status: worse(host.status, pool.status),
    readOnly: host.readOnly,
    ...(why ? { why } : {}),
  };
}

/** The lag of a copy: it grows while the copy cannot follow a primary that is writing, and shrinks once it can. */
function stepLag(world: World, id: string, dt: number, status: DbStatus): void {
  const s = world.stateAs(id, "db_instance");
  const cluster = clusterOf(world.index, id);
  if (!cluster || s.role === "primary") {
    s.lagS = 0;
    return;
  }
  const cdef = dbClusterDef(cluster);
  const cs = world.stateAs(cluster.id, "db_cluster");
  if (cdef.shape === "active_passive") {
    s.lagS = 0;
    return;
  }
  const primary = cs.primary ? world.stateAs(cs.primary, "db_instance") : undefined;
  if (!primary || primary.status === "down") return; // no new writes: the lag stays where it was
  const broken = world.faultsOn(id).find((f) => f.type === "db_replication_broken");
  if (broken) s.lagS += ((broken.params.lagPerMin ?? 120) * dt) / 60;
  else if (status === "down") s.lagS += dt;
  else s.lagS = Math.max(baselineLag(id), s.lagS - CATCH_UP * dt);
  s.lagS = Math.round(s.lagS * 10) / 10;
}

function updateInstance(world: World, id: string, dt: number, events: WorldEvent[]): void {
  stepRestore(world, id, events);
  const s = world.stateAs(id, "db_instance");
  const now = instanceStatus(world, id);
  if (now.status === "down" && s.status !== "down") logDown(world, id, s.role === "primary");
  s.status = now.status;
  s.readOnly = now.readOnly;
  if (now.why) s.why = now.why;
  else delete s.why;
  stepLag(world, id, dt, now.status);
  const host = hostedOn(world.index, id);
  if (host && world.stateOf(host).kind !== "storage")
    markProcess(world, host, now.status === "down");
}

/** The instance's own log says what happened, for `journalctl -u postgresql` on its host. */
function logDown(world: World, id: string, primary: boolean): void {
  const host = hostedOn(world.index, id);
  if (!host || world.stateAs(id, "db_instance").restore) return;
  const os = world.ensureHostOs(host);
  const failed = world.faultsOn(id).some((f) => f.type === "db_primary_down");
  logTo(
    os,
    line(
      world.time(),
      DB_PROCESS,
      "err",
      failed || primary
        ? "PANIC:  could not locate a valid checkpoint record"
        : "FATAL:  the database system is shutting down",
    ),
  );
}

/** `systemctl status postgresql` shows a stopped process while the instance is down (only on hosts that already have a state). */
function markProcess(world: World, host: string, down: boolean): void {
  const os = (world.stateOf(host) as StateOf<"vm"> | StateOf<"server">).os;
  const p = os?.processes.find((q) => q.name === DB_PROCESS);
  if (!p) return;
  if (down && p.state === "running") p.state = "failed";
  else if (!down && p.state === "failed") p.state = "running";
}

// ── clusters ───────────────────────────────────────────────────────────────────────────────

function stepSplitBrain(world: World, clusterId: string): void {
  const cs = world.stateAs(clusterId, "db_cluster");
  const list = instancesOf(world.index, clusterId).map((e) => ({
    e,
    s: world.stateAs(e.id, "db_instance"),
  }));
  const fault = world.faultsOn(clusterId).some((f) => f.type === "db_split_brain");
  if (fault && !cs.splitBrain) {
    cs.splitBrain = true;
    const rival = list.find((x) => x.s.role !== "primary" && x.s.status !== "down");
    if (rival) rival.s.role = "primary";
  } else if (!fault && cs.splitBrain) {
    cs.splitBrain = false;
    for (const x of list)
      if (x.s.role === "primary" && x.e.id !== cs.primary) x.s.role = "secondary";
  }
}

function stepFailover(
  world: World,
  cluster: ReturnType<World["index"]["entity"]>,
  events: WorldEvent[],
): void {
  const cdef = dbClusterDef(cluster);
  const cs = world.stateAs(cluster.id, "db_cluster");
  if (
    cdef.failover !== "auto" ||
    cs.splitBrain ||
    cdef.shape === "single" ||
    cdef.shape === "shared_aa"
  )
    return;
  const primary = cs.primary ? world.stateAs(cs.primary, "db_instance") : undefined;
  if (primary && primary.status !== "down") {
    delete cs.downSince;
    return;
  }
  cs.downSince ??= world.time();
  if (world.time() - cs.downSince < cdef.detectS) return;
  const next = bestCandidate(world, cluster);
  if (next) events.push(world.apply({ type: "db.promote", target: next.id }, CLUSTER_CAUSE));
}

function updateCluster(world: World, clusterId: string, events: WorldEvent[]): void {
  const cluster = world.index.entity(clusterId);
  stepSplitBrain(world, clusterId);
  stepFailover(world, cluster, events);
}

/** Step every pool, instance and cluster of the world. Events: restores that end, and promotions the cluster makes. */
export function updateDb(world: World, dt: number): WorldEvent[] {
  const events: WorldEvent[] = [];
  const pools = world.index.ofKind("storage_pool");
  const instances = world.index.ofKind("db_instance");
  if (pools.length === 0 && instances.length === 0) return events;
  for (const p of [...pools].sort((a, b) => a.id.localeCompare(b.id)))
    updatePool(world, p.id, dt, events);
  for (const i of [...instances].sort((a, b) => a.id.localeCompare(b.id)))
    updateInstance(world, i.id, dt, events);
  for (const c of [...world.index.ofKind("db_cluster")].sort((a, b) => a.id.localeCompare(b.id)))
    updateCluster(world, c.id, events);
  return events;
}
