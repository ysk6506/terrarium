/**
 * The state of the accelerator layer and of the power and cooling ladders (REQ-107, ADR-0130): GPUs with their temperature,
 * power, clocks and Xid errors, NVLink domains, the InfiniBand/RoCE fabric, the job scheduler, training jobs, inference pools,
 * rack batteries (BBU), 48 V buses, the substation, rear doors and immersion tanks. The rest of the world's state is in
 * state.ts, which re-exports these. Physics (physics/accel.ts, physics/facility-ext.ts) keeps them current.
 */
interface Base {
  health: "ok" | "warning" | "critical";
}

export type AccelStatus = "ok" | "degraded" | "down";

/** One GPU of a server. `clockPct` is what its clocks are of the full speed (thermal and power limits lower it). */
export interface GpuState extends Base {
  kind: "gpu";
  status: AccelStatus;
  why?: string;
  tempC: number;
  powerW: number;
  utilPct: number;
  memUsedGiB: number;
  xidErrors: number;
  throttled: boolean;
  clockPct: number;
  /** Times an operator reset it (nvidia-smi --gpu-reset). */
  resets: number;
  /** World time it went down (Xid, out of memory), and the time an out-of-memory process is back. */
  badSince?: number;
  oomUntil?: number;
}

export interface NvlinkState extends Base {
  kind: "nvlink_domain";
  status: AccelStatus;
  why?: string;
}

export interface IbFabricState extends Base {
  kind: "ib_fabric";
  status: AccelStatus;
  why?: string;
}

export interface IbLinkState extends Base {
  kind: "ib_link";
  status: "up" | "down";
  /** Times the link went down and up again (a flapping cable or transceiver). */
  flaps: number;
  why?: string;
}

export interface SchedulerState extends Base {
  kind: "job_scheduler";
  status: "ok" | "down";
  why?: string;
  queued: number;
  running: number;
  /** Nodes (servers) taken out of scheduling: new jobs do not land on them. */
  drained: string[];
}

export type JobPhase = "running" | "paused" | "failed" | "resumed";

export interface TrainingJobState extends Base {
  kind: "training_job";
  phase: JobPhase;
  why?: string;
  step: number;
  /** The step of the last checkpoint that was written whole, and when. */
  checkpointStep: number;
  checkpointAt: number;
  /** World time the job failed; the scheduler restarts it from the checkpoint after the restart delay. */
  failedAt?: number;
  /** Steps lost to failures so far (what had to be redone). */
  lostSteps: number;
  restarts: number;
  /** The nodes it trains on now (the scheduler swaps a bad node for a spare); absent: the ones the blueprint names. */
  nodes?: string[];
  /** World time it began to be slowed by a flapping fabric link. */
  slowSince?: number;
}

export interface InferencePoolState extends Base {
  kind: "inference_pool";
  status: AccelStatus;
  why?: string;
  desired: number;
  /** Replicas that answer (not counting ones taken out for a bad GPU or a leak). */
  replicas: number;
  p50Ms: number;
  p99Ms: number;
  migSlices: number;
  /** Replicas the pool took out by itself (a GPU with a Xid). */
  removed: string[];
}

/** A battery pack in the rack (OCP-style BBU) that carries the servers when the feed drops. */
export interface BbuState extends Base {
  kind: "bbu";
  status: AccelStatus;
  why?: string;
  chargePct: number;
  /** Minutes the pack carries the rack's load at the load of now. */
  runtimeMin: number;
  onBattery: boolean;
  cellsFailed: number;
}

export interface DcBusState extends Base {
  kind: "dc_bus";
  status: AccelStatus;
  why?: string;
  voltageV: number;
}

export interface SubstationState extends Base {
  kind: "substation";
  status: AccelStatus;
  why?: string;
  /** Utility feeds 1 and 2: do they carry voltage. */
  feeds: [boolean, boolean];
  /** Feed the transformers draw from now (1 or 2). */
  activeFeed: 1 | 2;
  transformersOk: [boolean, boolean];
  transformerC: [number, number];
  loadPct: number;
  /** World time the active feed was lost and the automatic transfer is waiting (absent while none is). */
  lostSince?: number;
}

export interface RdhxState extends Base {
  kind: "rdhx";
  status: AccelStatus;
  why?: string;
  waterInC: number;
  waterOutC: number;
  valvePct: number;
}

export interface TankState extends Base {
  kind: "immersion_tank";
  status: AccelStatus;
  why?: string;
  fluidC: number;
  pumpOk: boolean;
  levelPct: number;
}

export type AccelStates =
  | GpuState
  | NvlinkState
  | IbFabricState
  | IbLinkState
  | SchedulerState
  | TrainingJobState
  | InferencePoolState
  | BbuState
  | DcBusState
  | SubstationState
  | RdhxState
  | TankState;

type Factory = () => AccelStates;

export const ACCEL_FACTORIES: Readonly<Record<AccelStates["kind"], Factory>> = {
  gpu: () => ({
    kind: "gpu",
    health: "ok",
    status: "ok",
    tempC: 40,
    powerW: 80,
    utilPct: 0,
    memUsedGiB: 0,
    xidErrors: 0,
    throttled: false,
    clockPct: 100,
    resets: 0,
  }),
  nvlink_domain: () => ({ kind: "nvlink_domain", health: "ok", status: "ok" }),
  ib_fabric: () => ({ kind: "ib_fabric", health: "ok", status: "ok" }),
  ib_link: () => ({ kind: "ib_link", health: "ok", status: "up", flaps: 0 }),
  job_scheduler: () => ({
    kind: "job_scheduler",
    health: "ok",
    status: "ok",
    queued: 0,
    running: 0,
    drained: [],
  }),
  training_job: () => ({
    kind: "training_job",
    health: "ok",
    phase: "running",
    step: 0,
    checkpointStep: 0,
    checkpointAt: 0,
    lostSteps: 0,
    restarts: 0,
  }),
  inference_pool: () => ({
    kind: "inference_pool",
    health: "ok",
    status: "ok",
    desired: 0,
    replicas: 0,
    p50Ms: 40,
    p99Ms: 120,
    migSlices: 0,
    removed: [],
  }),
  bbu: () => ({
    kind: "bbu",
    health: "ok",
    status: "ok",
    chargePct: 100,
    runtimeMin: 5,
    onBattery: false,
    cellsFailed: 0,
  }),
  dc_bus: () => ({ kind: "dc_bus", health: "ok", status: "ok", voltageV: 48 }),
  substation: () => ({
    kind: "substation",
    health: "ok",
    status: "ok",
    feeds: [true, true],
    activeFeed: 1,
    transformersOk: [true, true],
    transformerC: [55, 55],
    loadPct: 0,
  }),
  rdhx: () => ({
    kind: "rdhx",
    health: "ok",
    status: "ok",
    waterInC: 18,
    waterOutC: 18,
    valvePct: 100,
  }),
  immersion_tank: () => ({
    kind: "immersion_tank",
    health: "ok",
    status: "ok",
    fluidC: 40,
    pumpOk: true,
    levelPct: 100,
  }),
};
