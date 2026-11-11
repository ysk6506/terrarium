/**
 * What an operator does to the accelerator layer and to the power and cooling ladders (REQ-107, ADR-0130): reset a GPU,
 * resume a job from its checkpoint, drain a node out of scheduling, change the size of a serving pool, cap a server's power,
 * move the substation to the other utility feed, start the standby pump of a CDU. They are world events and change state only
 * through the reducers here. The scheduler, the pool and the substation move by themselves too (physics, cause `cluster`).
 */
import { ConflictError, InvalidValueError } from "@terrarium/core/kernel";
import {
  jobDef,
  jobOnServer,
  nodeAvoid,
  poolCapacity,
  poolDef,
  schedulerOf,
  swapNodes,
} from "./accel";
import type { WorldReader } from "./world";

export type AccelCommand =
  /** A GPU is reset; the Xid or memory leak a reset can end is gone, and the job on its node fails (its process was killed). */
  | { readonly type: "gpu.reset"; readonly target: string }
  /** A paused or failed training job continues from its last checkpoint. */
  | { readonly type: "job.resume"; readonly target: string }
  /** A node is taken out of scheduling (`on` true), or put back (false). */
  | { readonly type: "node.drain"; readonly target: string; readonly on: boolean }
  /** A serving pool is asked to run this many replicas. */
  | { readonly type: "pool.scale"; readonly target: string; readonly replicas: number }
  /** A server's power is capped at `watts`; null takes the cap off. */
  | { readonly type: "power.cap"; readonly target: string; readonly watts: number | null }
  /** The substation draws from this utility feed. */
  | { readonly type: "feed.transfer"; readonly target: string; readonly feed: 1 | 2 }
  /** The standby pump of a CDU is started by hand. */
  | { readonly type: "cdu.pump_switch"; readonly target: string };

const TYPES = [
  "gpu.reset",
  "job.resume",
  "node.drain",
  "pool.scale",
  "power.cap",
  "feed.transfer",
  "cdu.pump_switch",
];
export const isAccelCommand = (type: string): boolean => TYPES.includes(type);

function kindOf(world: WorldReader, id: string, kind: string, words: string) {
  const e = world.index.find(id);
  if (e?.kind !== kind) throw new InvalidValueError(`'${id}'는 ${words}이(가) 아니에요`);
  return e;
}

/** A running job is worth putting back in the queue when one of its nodes is one the scheduler would avoid (drained, flapping). */
function needsRequeue(world: WorldReader, target: string): boolean {
  const job = world.index.entity(target);
  const drained = world.stateAs(schedulerOf(world.index)?.id ?? "", "job_scheduler").drained;
  const now = world.stateAs(target, "training_job").nodes ?? [...jobDef(job).nodes];
  return now.some((n) => nodeAvoid(world as never, n, drained));
}

function checkResume(world: WorldReader, target: string): void {
  kindOf(world, target, "training_job", "학습 잡");
  const job = world.stateAs(target, "training_job");
  if ((job.phase === "running" || job.phase === "resumed") && !needsRequeue(world, target))
    throw new ConflictError(`'${target}'는 이미 제대로 돌고 있어요`);
  const sched = schedulerOf(world.index);
  if (sched && world.stateAs(sched.id, "job_scheduler").status === "down")
    throw new ConflictError(
      "잡 스케줄러가 멈춰 있어서 잡을 이어갈 수 없어요(먼저 스케줄러를 살리세요)",
    );
}

function checkDrain(world: WorldReader, target: string, on: boolean): void {
  const e = kindOf(world, target, "server", "서버");
  if (world.index.ofKind("gpu").every((g) => g.props.server !== e.id))
    throw new ConflictError(`'${target}'는 GPU 서버가 아니에요`);
  const sched = schedulerOf(world.index);
  if (!sched) throw new ConflictError("이 세계에는 잡 스케줄러가 없어요");
  const has = world.stateAs(sched.id, "job_scheduler").drained.includes(target);
  if (on && has) throw new ConflictError(`'${target}'는 이미 스케줄에서 빠져 있어요`);
  if (!on && !has) throw new ConflictError(`'${target}'는 빠져 있지 않아요`);
}

function checkScale(world: WorldReader, target: string, replicas: number): void {
  const e = kindOf(world, target, "inference_pool", "추론 풀");
  const cap = poolCapacity(poolDef(e));
  if (!Number.isInteger(replicas) || replicas < 1 || replicas > cap)
    throw new InvalidValueError(`복제본은 1~${cap}개 사이로 정해요`);
}

function checkCap(world: WorldReader, target: string, watts: number | null): void {
  kindOf(world, target, "server", "서버");
  if (watts !== null && !(watts > 0))
    throw new InvalidValueError("캡은 0보다 큰 와트로 정해요(캡을 풀려면 watts를 비워요)");
}

function checkTransfer(world: WorldReader, target: string, feed: 1 | 2): void {
  kindOf(world, target, "substation", "변전소");
  const s = world.stateAs(target, "substation");
  if (!s.feeds[feed - 1]) throw new ConflictError(`수전 ${feed}번 줄은 전압이 없어요`);
  if (s.activeFeed === feed) throw new ConflictError(`이미 수전 ${feed}번 줄에서 받고 있어요`);
}

function checkPumpSwitch(world: WorldReader, target: string): void {
  kindOf(world, target, "cdu", "CDU");
  if (world.stateAs(target, "cdu").standbyOn)
    throw new ConflictError(`'${target}'는 예비 펌프를 이미 돌리고 있어요`);
}

/** Refuse commands that make no sense before they are recorded. */
export function checkAccelCommand(world: WorldReader, command: AccelCommand): void {
  const { target } = command;
  switch (command.type) {
    case "gpu.reset":
      kindOf(world, target, "gpu", "GPU");
      break;
    case "job.resume":
      checkResume(world, target);
      break;
    case "node.drain":
      checkDrain(world, target, command.on);
      break;
    case "pool.scale":
      checkScale(world, target, command.replicas);
      break;
    case "power.cap":
      checkCap(world, target, command.watts);
      break;
    case "feed.transfer":
      checkTransfer(world, target, command.feed);
      break;
    case "cdu.pump_switch":
      checkPumpSwitch(world, target);
      break;
  }
}

/** What the reducers read of the world beyond reading it. */
export interface AccelActContext {
  readonly world: WorldReader;
  readonly t: number;
  dropFault(faultId: string): void;
}

function dropFaults(ctx: AccelActContext, target: string, types: readonly string[]): void {
  for (const f of ctx.world.faultsOn(target)) if (types.includes(f.type)) ctx.dropFault(f.id);
}

/** A job that was running when its process was killed fails now. */
export function failJob(ctx: AccelActContext, jobId: string, why: string): void {
  const s = ctx.world.stateAs(jobId, "training_job");
  if (s.phase === "failed") return;
  s.phase = "failed";
  s.failedAt = ctx.t;
  s.why = why;
}

export function resetGpu(ctx: AccelActContext, target: string): void {
  const gpu = ctx.world.index.entity(target);
  dropFaults(ctx, target, ["gpu_xid_error", "gpu_memory_leak_inference"]);
  const s = ctx.world.stateAs(target, "gpu");
  s.resets += 1;
  s.memUsedGiB = 0;
  const job = jobOnServer(ctx.world.index, String(gpu.props.server));
  if (job) failJob(ctx, job.id, `${gpu.name}을(를) 리셋해서 그 노드의 프로세스가 죽었어요`);
}

export function resumeJob(ctx: AccelActContext, target: string): void {
  dropFaults(ctx, target, ["job_stuck_checkpoint"]);
  const s = ctx.world.stateAs(target, "training_job");
  // the job goes back up on nodes the scheduler will have: a drained or flapping one is swapped for a spare
  const job = ctx.world.index.entity(target);
  const drained = ctx.world.stateAs(
    schedulerOf(ctx.world.index)?.id ?? "",
    "job_scheduler",
  ).drained;
  const next = swapNodes(ctx.world, job, s.nodes ?? [...jobDef(job).nodes], drained);
  if (next) s.nodes = next;
  s.lostSteps += Math.max(0, s.step - s.checkpointStep);
  s.step = s.checkpointStep;
  s.phase = "resumed";
  s.restarts += 1;
  delete s.failedAt;
  delete s.why;
}

export function drainNode(ctx: AccelActContext, target: string, on: boolean): void {
  const sched = schedulerOf(ctx.world.index);
  if (!sched) return;
  const s = ctx.world.stateAs(sched.id, "job_scheduler");
  s.drained = on
    ? [...new Set([...s.drained, target])].sort()
    : s.drained.filter((x) => x !== target);
}

export function scalePool(ctx: AccelActContext, target: string, replicas: number): void {
  dropFaults(ctx, target, ["mig_misconfig"]);
  ctx.world.stateAs(target, "inference_pool").desired = replicas;
}

export function capServer(ctx: AccelActContext, target: string, watts: number | null): void {
  const s = ctx.world.stateAs(target, "server");
  if (watts === null) {
    delete s.powerCapW;
    delete s.perf;
  } else s.powerCapW = watts;
}

export function transferFeed(ctx: AccelActContext, target: string, feed: 1 | 2): void {
  const s = ctx.world.stateAs(target, "substation");
  s.activeFeed = feed;
  delete s.lostSince;
}

export function switchPump(ctx: AccelActContext, target: string): void {
  ctx.world.stateAs(target, "cdu").standbyOn = true;
}
