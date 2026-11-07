/**
 * The accelerator layer moves with time and with the faults on it (REQ-107, ADR-0130): a GPU heats with its load and the
 * air it breathes and slows its clocks above 83 °C, a Xid takes a GPU off the bus, a leaking serving process fills the GPU
 * memory until the kernel kills it. The scheduler drains a node whose GPU dropped and, after five minutes, starts a failed
 * job again from its last checkpoint on a spare node. A serving pool takes a bad replica out by itself. Each of these is a
 * world event with the cause `cluster`, so scoring can tell a recovery the system made from one the agent made.
 *
 * Each step: fabric links and NVLink domains (what is up), then GPUs (what each one does), then the scheduler, jobs and pools.
 */
import {
  Accel,
  type Entity,
  type StateOf,
  type World,
  type WorldEvent,
} from "@terrarium/core/world";
import { CLUSTER_CAUSE } from "./db";

const {
  CKPT_CORRUPT_S,
  DRAIN_AFTER_S,
  GPU_CLOCK_LOSS_PER_C,
  GPU_THROTTLE_C,
  gpusOf,
  ibLinkOf,
  JOB_RESTART_S,
  jobDef,
  jobsOf,
  nodeBad,
  OOM_RESTART_S,
  poolCapacity,
  poolDef,
  poolsOf,
  SERVING_GIB,
  schedulerOf,
  serverOfAccel,
  swapNodes,
} = Accel;

const note = (world: World, events: WorldEvent[], text: string, cause = CLUSTER_CAUSE): void => {
  events.push(world.apply({ type: "note", text }, cause));
};

const has = (world: World, id: string, type: string) =>
  world.faultsOn(id).find((f) => f.type === type);
const serverUp = (world: World, id: string): boolean => {
  const s = world.stateAs(id, "server");
  return s.powered && s.adminOn;
};

// ── fabric and NVLink ─────────────────────────────────────────────────────

function updateIbLink(world: World, link: Entity): void {
  const t = world.time();
  const s = world.stateAs(link.id, "ib_link");
  const flap = has(world, link.id, "ib_link_flap");
  const period = flap?.params.periodS ?? 90;
  const flapUp = flap ? (t - flap.since) % period < period / 2 : true;
  const was = s.status;
  delete s.why;
  if (!serverUp(world, serverOfAccel(link))) {
    s.status = "down";
    s.why = "서버가 꺼져 있어요";
  } else if (!flapUp) {
    s.status = "down";
    s.why = "링크가 끊겼다 붙기를 되풀이해요(플래핑)";
  } else s.status = "up";
  if (was === "up" && s.status === "down" && flap) s.flaps += 1;
}

function updateFabric(world: World, fabric: Entity): void {
  const links = world.index.incoming(fabric.id, "member_of").map((l) => l.from);
  const sched = schedulerOf(world.index);
  const drained = sched ? (world.stateAs(sched.id, "job_scheduler").drained ?? []) : [];
  // a drained node carries no job: its link, flapping or not, no longer says anything about the fabric
  const mine = links.filter(
    (id) =>
      world.index.find(id)?.kind === "ib_link" &&
      !drained.includes(serverOfAccel(world.index.entity(id))),
  );
  const down = mine.filter((id) => world.stateAs(id, "ib_link").status === "down").length;
  const s = world.stateAs(fabric.id, "ib_fabric");
  delete s.why;
  s.status = mine.length > 0 && down === mine.length ? "down" : down > 0 ? "degraded" : "ok";
  if (down > 0) s.why = `링크 ${down}/${mine.length}개가 끊겨 있어요`;
}

function updateNvlink(world: World, nv: Entity): void {
  const s = world.stateAs(nv.id, "nvlink_domain");
  delete s.why;
  if (has(world, nv.id, "nvlink_down")) {
    s.status = "down";
    s.why = "NVLink가 끊겨 GPU끼리 빠르게 주고받지 못해요";
  } else s.status = "ok";
}

function updateLinks(world: World): void {
  for (const link of world.index.ofKind("ib_link")) updateIbLink(world, link);
  for (const fabric of world.index.ofKind("ib_fabric")) updateFabric(world, fabric);
  for (const nv of world.index.ofKind("nvlink_domain")) updateNvlink(world, nv);
}

// ── GPUs ──────────────────────────────────────────────────────────────────

/** What the GPUs of a server are asked to do, 0..1: a training node works hard, a serving node as the traffic asks. */
function loadOf(world: World, server: string): number {
  const job = jobsOf(world.index).find((j) =>
    (world.stateAs(j.id, "training_job").nodes ?? jobDef(j).nodes).includes(server),
  );
  if (job) {
    const phase = world.stateAs(job.id, "training_job").phase;
    return phase === "running" || phase === "resumed" ? 0.95 : 0.03;
  }
  const pool = poolsOf(world.index).find((p) => poolDef(p).servers.includes(server));
  if (pool) return world.stateAs(pool.id, "inference_pool").removed.includes(server) ? 0.02 : 0.6;
  return Math.min(0.9, world.stateAs(server, "server").cpuUtil);
}

/** The temperature a GPU settles at, °C: the air or coolant it breathes plus what its load adds. */
function targetTemp(world: World, server: string, util: number): number {
  const rack = world.index.find(server)?.parentId;
  const r = rack ? world.stateAs(rack, "rack") : undefined;
  const s = world.stateAs(server, "server");
  if (r && r.bathC > 0) return r.bathC + 8 + 14 * util;
  if (r && r.coolantC > 0) return r.coolantC + 12 + 22 * util;
  return s.inletC + 26 + 30 * util;
}

const num = (v: unknown, def: number): number => (typeof v === "number" ? v : def);

/** Why a GPU is off the bus right now, or undefined when it is not. */
function downWhy(world: World, gpu: Entity, up: boolean): string | undefined {
  const s = world.stateAs(gpu.id, "gpu");
  const xid = has(world, gpu.id, "gpu_xid_error");
  if (!up) return "서버가 꺼져 있어요";
  if (xid) return `Xid ${xid.params.code ?? 79}: GPU가 버스에서 떨어졌어요`;
  if (s.oomUntil !== undefined && world.time() < s.oomUntil)
    return "GPU 메모리가 가득 차 프로세스가 죽었어요(OOM)";
  return undefined;
}

/** The GPU memory a serving process holds, GiB: a leak grows it until the card is full (true: the kernel kills the process). */
function stepMemory(world: World, gpu: Entity, load: number, dt: number): boolean {
  const s = world.stateAs(gpu.id, "gpu");
  const leak = has(world, gpu.id, "gpu_memory_leak_inference");
  const memGiB = num(gpu.props.memGiB, 80);
  const base = load > 0.1 ? SERVING_GIB : 4;
  if (!leak) {
    s.memUsedGiB = load > 0.1 ? Math.max(s.memUsedGiB, base) : base;
    return false;
  }
  s.memUsedGiB = Math.min(
    memGiB,
    Math.max(s.memUsedGiB, base) + ((leak.params.giBPerMin ?? 4) * dt) / 60,
  );
  if (s.memUsedGiB < memGiB) return false;
  s.oomUntil = world.time() + OOM_RESTART_S;
  s.memUsedGiB = 0;
  return true;
}

function updateGpu(world: World, gpu: Entity, dt: number): void {
  const s = world.stateAs(gpu.id, "gpu");
  const server = serverOfAccel(gpu);
  const t = world.time();
  const sv = world.stateAs(server, "server");
  const up = serverUp(world, server);
  const load = loadOf(world, server);
  sv.gpuLoad = load;
  delete s.why;
  const xid = has(world, gpu.id, "gpu_xid_error");
  s.xidErrors = Math.max(s.xidErrors, xid ? 1 : 0);
  const why = downWhy(world, gpu, up);
  if (why !== undefined) {
    s.status = "down";
    s.why = why;
    s.badSince ??= t;
    Object.assign(s, { utilPct: 0, powerW: up ? 60 : 0, throttled: false, clockPct: 100 });
    s.tempC += (targetTemp(world, server, 0) - s.tempC) * Math.min(1, dt / 60);
    return;
  }
  if (s.oomUntil !== undefined) {
    delete s.oomUntil;
    s.memUsedGiB = SERVING_GIB;
  }
  delete s.badSince;
  if (stepMemory(world, gpu, load, dt)) return;
  const thermal = has(world, gpu.id, "gpu_thermal_throttle");
  const want = targetTemp(world, server, load) + (thermal?.params.deltaC ?? 0);
  s.tempC += (want - s.tempC) * Math.min(1, dt / 45);
  const hot = Math.max(0, s.tempC - GPU_THROTTLE_C);
  s.clockPct = Math.max(40, Math.min((sv.perf ?? 1) * 100, 100 - GPU_CLOCK_LOSS_PER_C * hot));
  s.throttled = s.clockPct < 99.5;
  s.utilPct = Math.round(load * 100);
  s.powerW = Math.round(60 + (num(gpu.props.tdpW, 700) - 60) * load * (s.clockPct / 100));
  describeGpu(world, gpu);
}

/** The status and the one line that says why, once the clocks and the memory are known. */
function describeGpu(world: World, gpu: Entity): void {
  const s = world.stateAs(gpu.id, "gpu");
  const memGiB = num(gpu.props.memGiB, 80);
  const leaking = has(world, gpu.id, "gpu_memory_leak_inference") && s.memUsedGiB > memGiB * 0.7;
  s.status = s.throttled || leaking ? "degraded" : "ok";
  if (s.throttled)
    s.why = `${Math.round(s.tempC)} °C라서 클럭이 ${Math.round(s.clockPct)}%로 낮아졌어요`;
  else if (leaking) s.why = `메모리를 ${Math.round(s.memUsedGiB)} GiB 쓰고 있어요(계속 늘어요)`;
}

// ── scheduler, jobs, pools ────────────────────────────────────────────────

/** A GPU that dropped off the bus long enough ago for the scheduler to notice, on a server that is up. */
function drainable(world: World, gpu: Entity, drained: readonly string[]): boolean {
  const g = world.stateAs(gpu.id, "gpu");
  const server = serverOfAccel(gpu);
  return (
    g.status === "down" &&
    g.badSince !== undefined &&
    world.time() - g.badSince >= DRAIN_AFTER_S &&
    serverUp(world, server) &&
    !drained.includes(server) &&
    g.oomUntil === undefined
  );
}

function updateScheduler(world: World, events: WorldEvent[]): void {
  const sched = schedulerOf(world.index);
  if (!sched) return;
  const s = world.stateAs(sched.id, "job_scheduler");
  delete s.why;
  if (has(world, sched.id, "scheduler_down")) {
    s.status = "down";
    s.why = "스케줄러가 멈췄어요";
    return;
  }
  s.status = "ok";
  for (const gpu of world.index.ofKind("gpu")) {
    if (!drainable(world, gpu, s.drained)) continue;
    const server = serverOfAccel(gpu);
    s.drained = [...s.drained, server].sort();
    note(
      world,
      events,
      `스케줄러가 ${gpu.name}(Xid)이(가) 난 노드 ${server}를 스케줄에서 뺐어요(drain)`,
    );
  }
  const jobs = jobsOf(world.index).map((j) => world.stateAs(j.id, "training_job"));
  s.running = jobs.filter((j) => j.phase === "running" || j.phase === "resumed").length;
  s.queued = jobs.filter((j) => j.phase === "failed").length;
}

function failJob(world: World, job: Entity, why: string, events: WorldEvent[]): void {
  const s = world.stateAs(job.id, "training_job");
  s.phase = "failed";
  s.failedAt = world.time();
  s.why = why;
  delete s.slowSince;
  note(world, events, `${job.name}이(가) 실패했어요: ${why}`, "physics");
}

/** A failed job waits, then the scheduler puts it back on the nodes that are fine from its last checkpoint. */
function restartJob(world: World, job: Entity, events: WorldEvent[]): void {
  const s = world.stateAs(job.id, "training_job");
  const sched = schedulerOf(world.index);
  const ss = sched ? world.stateAs(sched.id, "job_scheduler") : undefined;
  if (ss?.status !== "ok" || s.failedAt === undefined) return;
  if (world.time() - s.failedAt < JOB_RESTART_S) return;
  const next = swapNodes(world, job, s.nodes ?? [...jobDef(job).nodes], ss.drained);
  if (!next) {
    s.why = "쓸 수 있는 노드가 모자라 다시 올리지 못해요";
    return;
  }
  s.nodes = next;
  s.lostSteps += Math.max(0, s.step - s.checkpointStep);
  s.step = s.checkpointStep;
  s.phase = "resumed";
  s.restarts += 1;
  delete s.failedAt;
  delete s.why;
  note(
    world,
    events,
    `스케줄러가 ${job.name}을(를) 체크포인트(스텝 ${s.checkpointStep})부터 다시 올렸어요`,
  );
}

/** The checkpoint store is stuck: the job waits, and a checkpoint left half written for too long is lost. */
function waitForCheckpoint(world: World, job: Entity): void {
  const s = world.stateAs(job.id, "training_job");
  s.phase = "paused";
  s.why = "체크포인트 저장소가 느려 쓰기를 기다리고 있어요";
  s.slowSince ??= world.time();
  if (world.time() - s.slowSince >= CKPT_CORRUPT_S && s.checkpointStep > 0) {
    s.checkpointStep = 0;
    s.why = "오래 기다리는 사이 마지막 체크포인트가 깨졌어요";
  }
}

/** Steps per second of the slowest GPU on the job's nodes, as a share of full speed. */
function stepRate(world: World, nodes: readonly string[], flapping: boolean): number {
  const clocks = nodes.flatMap((n) =>
    gpusOf(world.index, n).map((g) => world.stateAs(g.id, "gpu").clockPct),
  );
  return (clocks.length > 0 ? Math.min(...clocks) / 100 : 1) * (flapping ? 0.4 : 1);
}

/** A node of the job that is gone or cannot be used, with the reason. */
function lostNode(world: World, nodes: readonly string[]): readonly [string, string] | undefined {
  for (const n of nodes) {
    const why = nodeBad(world, n, []);
    if (why !== undefined) return [n, why];
  }
  return undefined;
}

const flappingOn = (world: World, nodes: readonly string[]): boolean =>
  nodes.some((n) => {
    const l = ibLinkOf(world.index, n);
    return l ? has(world, l.id, "ib_link_flap") !== undefined : false;
  });

/** A job that is flapping on its fabric slows down, and fails with an NCCL timeout when it goes on long enough. */
function watchFabric(world: World, job: Entity, flapping: boolean, events: WorldEvent[]): void {
  const s = world.stateAs(job.id, "training_job");
  if (!flapping) {
    delete s.slowSince;
    return;
  }
  s.slowSince ??= world.time();
  if (world.time() - s.slowSince >= 180)
    failJob(world, job, "NCCL 타임아웃: 패브릭 링크가 계속 흔들렸어요", events);
}

function updateJob(world: World, job: Entity, dt: number, events: WorldEvent[]): void {
  const s = world.stateAs(job.id, "training_job");
  const def = jobDef(job);
  const nodes = s.nodes ?? [...def.nodes];
  if (s.phase === "failed") {
    restartJob(world, job, events);
    return;
  }
  const lost = lostNode(world, nodes);
  if (lost) {
    failJob(world, job, `${lost[0]}: ${lost[1]}`, events);
    return;
  }
  if (has(world, job.id, "job_stuck_checkpoint")) {
    waitForCheckpoint(world, job);
    return;
  }
  if (s.phase === "paused") s.phase = "resumed";
  const flapping = flappingOn(world, nodes);
  const rate = stepRate(world, nodes, flapping);
  if (flapping) s.why = "패브릭 링크가 흔들려 스텝이 느려요";
  else if (rate < 0.99) s.why = "가장 느린 GPU에 맞춰 느려졌어요";
  else delete s.why;
  s.step += (rate * dt) / def.stepS;
  if (world.time() - s.checkpointAt >= def.ckptEveryS) {
    s.checkpointStep = Math.floor(s.step);
    s.checkpointAt = world.time();
  }
  watchFabric(world, job, flapping, events);
}

/** What the servers of a pool give: replicas that answer, the slowest clock, and the servers that dropped. */
interface Fleet {
  live: number;
  clock: number;
  drops: number;
}

function sweepPool(world: World, pool: Entity, removed: Set<string>, events: WorldEvent[]): Fleet {
  const def = poolDef(pool);
  const per = def.mig ? 4 : 1;
  const t = world.time();
  const fleet: Fleet = { live: 0, clock: 100, drops: 0 };
  for (const server of def.servers) {
    const gpus = gpusOf(world.index, server).map((g) => world.stateAs(g.id, "gpu"));
    const down = gpus.filter((g) => g.status === "down");
    const gone = !serverUp(world, server) || down.length > 0;
    if (gone) fleet.drops++;
    const longGone = down.some((g) => g.badSince !== undefined && t - g.badSince >= 20);
    if (longGone && !removed.has(server)) {
      removed.add(server);
      note(
        world,
        events,
        `${pool.name}이(가) 떨어진 GPU가 있는 ${server}의 복제본을 풀에서 뺐어요`,
      );
    }
    if (gone) continue;
    removed.delete(server);
    fleet.live += per;
    for (const g of gpus) fleet.clock = Math.min(fleet.clock, g.clockPct);
  }
  return fleet;
}

function updatePool(world: World, pool: Entity, events: WorldEvent[]): void {
  const s = world.stateAs(pool.id, "inference_pool");
  const def = poolDef(pool);
  const cap = poolCapacity(def);
  if (s.desired === 0) s.desired = cap;
  s.migSlices = def.mig ? cap : 0;
  const removed = new Set(s.removed);
  const fleet = sweepPool(world, pool, removed, events);
  s.removed = [...removed].sort();
  const mis = has(world, pool.id, "mig_misconfig") !== undefined;
  s.replicas = Math.min(mis ? Math.floor(fleet.live / 2) : fleet.live, s.desired);
  const u = s.replicas > 0 ? (def.load * cap) / s.replicas / cap : 99;
  const p50 = Math.round(
    40 * (100 / Math.max(40, fleet.clock)) * (u <= 0.7 ? 1 : 1 + (u - 0.7) * 8),
  );
  s.p50Ms = Math.min(p50, 30_000);
  s.p99Ms = Math.min(p50 * 3, 60_000);
  const hidden = def.servers.filter((x) => !removed.has(x) && !serverUp(world, x)).length;
  describePool(s, { cap, mis, deadWeight: fleet.drops - removed.size + hidden });
}

function describePool(
  s: StateOf<"inference_pool">,
  at: { cap: number; mis: boolean; deadWeight: number },
): void {
  delete s.why;
  if (s.replicas === 0) {
    s.status = "down";
    s.why = at.mis ? "MIG 분할이 모델과 안 맞아 복제본이 뜨지 못해요" : "답하는 복제본이 없어요";
  } else if (s.replicas < at.cap || s.p99Ms > 500 || at.deadWeight > 0) {
    s.status = "degraded";
    s.why =
      at.deadWeight > 0
        ? "죽은 복제본으로도 요청이 가서 일부가 실패해요(아직 풀에서 빼지 않았어요)"
        : at.mis
          ? "MIG 분할이 모델과 안 맞아 복제본이 일부만 떠요"
          : `복제본 ${s.replicas}/${at.cap}개, p99 ${s.p99Ms} ms`;
  } else s.status = "ok";
}

/** The accelerator layer for one step. */
export function updateAccel(world: World, dt: number): WorldEvent[] {
  const events: WorldEvent[] = [];
  if (world.index.ofKind("gpu").length === 0) return events;
  updateLinks(world);
  for (const gpu of world.index.ofKind("gpu")) updateGpu(world, gpu, dt);
  updateScheduler(world, events);
  for (const job of jobsOf(world.index)) updateJob(world, job, dt, events);
  for (const pool of poolsOf(world.index)) updatePool(world, pool, events);
  return events;
}
