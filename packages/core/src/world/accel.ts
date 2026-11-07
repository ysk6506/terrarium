/**
 * The accelerator layer (REQ-107, ADR-0130, docs/design-docs/gpu-layer.md): what stands between a model and the silicon.
 * A GPU server has its GPUs, one NVLink domain and one fabric link; training jobs run on a set of nodes under a scheduler;
 * an inference pool serves a model from the GPUs of its servers. Settings are props; the state of each is kept by physics
 * (physics/accel.ts); health is read in accel-health.ts.
 */
import type { Entity } from "./blueprint";
import type { BlueprintIndex } from "./graph";
import type { EntityState, StateOf } from "./state";

/** GPU temperature (°C) above which the clocks go down, and the clock lost per degree above it. */
export const GPU_THROTTLE_C = 83;
export const GPU_CLOCK_LOSS_PER_C = 4;
/** Seconds from a job's failure to the scheduler starting it again from the last checkpoint. */
export const JOB_RESTART_S = 300;
/** Seconds the scheduler needs to notice a Xid and drain the node. */
export const DRAIN_AFTER_S = 30;
/** Seconds between two checkpoints of a job, and seconds one step takes. */
export const CKPT_EVERY_S = 600;
export const STEP_S = 2;
/** A job paused or stuck this long without a resume loses its last checkpoint (it was half written). */
export const CKPT_CORRUPT_S = 1800;
/** Seconds a serving process lives after its GPU memory is full before the kernel kills it (OOM) and the pool restarts it. */
export const OOM_RESTART_S = 90;
/** GPU memory (GiB) a healthy serving process holds. */
export const SERVING_GIB = 48;
/** Model replicas one server runs when its GPUs are split with MIG, and when they are not. */
export const MIG_REPLICAS = 4;

const num = (props: Entity["props"], key: string, def: number): number =>
  typeof props[key] === "number" ? (props[key] as number) : def;
const csv = (props: Entity["props"], key: string): string[] =>
  typeof props[key] === "string" && props[key] !== "" ? String(props[key]).split(",") : [];

const byId = (a: { id: string }, b: { id: string }): number => a.id.localeCompare(b.id);

/** The GPUs of a server, by id. */
export const gpusOf = (index: BlueprintIndex, serverId: string): Entity[] =>
  index
    .ofKind("gpu")
    .filter((g) => g.props.server === serverId)
    .sort(byId);

export const nvlinkOf = (index: BlueprintIndex, serverId: string): Entity | undefined =>
  index.ofKind("nvlink_domain").find((n) => n.props.server === serverId);

export const ibLinkOf = (index: BlueprintIndex, serverId: string): Entity | undefined =>
  index.ofKind("ib_link").find((n) => n.props.server === serverId);

/** The server a GPU, NVLink domain or fabric link stands in. */
export const serverOfAccel = (e: Entity): string => String(e.props.server ?? "");

export interface JobDef {
  /** The nodes (servers) it trains on, and the spare ones it can move to. */
  readonly nodes: readonly string[];
  readonly spares: readonly string[];
  readonly ckptEveryS: number;
  readonly stepS: number;
}
export const jobDef = (e: Entity): JobDef => ({
  nodes: csv(e.props, "nodes"),
  spares: csv(e.props, "spares"),
  ckptEveryS: num(e.props, "ckptEveryS", CKPT_EVERY_S),
  stepS: num(e.props, "stepS", STEP_S),
});

export interface PoolDef {
  /** The servers whose GPUs serve the model. */
  readonly servers: readonly string[];
  readonly mig: boolean;
  /** Requests per second the pool is asked, in units of one replica's capacity. */
  readonly load: number;
}
export const poolDef = (e: Entity): PoolDef => ({
  servers: csv(e.props, "servers"),
  mig: e.props.mig === true,
  load: num(e.props, "load", 1),
});

export const jobsOf = (index: BlueprintIndex): Entity[] =>
  [...index.ofKind("training_job")].sort(byId);
export const poolsOf = (index: BlueprintIndex): Entity[] =>
  [...index.ofKind("inference_pool")].sort(byId);
export const schedulerOf = (index: BlueprintIndex): Entity | undefined =>
  [...index.ofKind("job_scheduler")].sort(byId)[0];
export const fabricOf = (index: BlueprintIndex): Entity | undefined =>
  [...index.ofKind("ib_fabric")].sort(byId)[0];

/** The job that trains on this server now, if any. */
export const jobOnServer = (index: BlueprintIndex, serverId: string): Entity | undefined =>
  jobsOf(index).find((j) => jobDef(j).nodes.includes(serverId));

/** Whether the world has any accelerator entity at all. */
export const hasAccel = (index: BlueprintIndex): boolean => index.ofKind("gpu").length > 0;

/** Replicas one pool can run at most when all its servers are well. */
export const poolCapacity = (def: PoolDef): number =>
  def.servers.length * (def.mig ? MIG_REPLICAS : 1);

// ── nodes a job may stand on ─────────────────────────────────────────────

/** The part of the world these helpers read. */
export interface AccelWorld {
  readonly index: BlueprintIndex;
  stateAs<K extends EntityState["kind"]>(id: string, kind: K): StateOf<K>;
  faultsOn(id: string): readonly { readonly type: string }[];
}

const serverUp = (world: AccelWorld, id: string): boolean => {
  const s = world.stateAs(id, "server");
  return s.powered && s.adminOn;
};

/** Why a node cannot run a job now, or undefined: drained, off, an NVLink domain down or a GPU off the bus. */
export function nodeBad(
  world: AccelWorld,
  server: string,
  drained: readonly string[],
): string | undefined {
  if (drained.includes(server)) return "스케줄에서 빠져 있어요";
  if (!serverUp(world, server)) return "서버가 꺼져 있어요";
  const nv = nvlinkOf(world.index, server);
  if (nv && world.stateAs(nv.id, "nvlink_domain").status === "down") return "NVLink가 끊겼어요";
  const bad = gpusOf(world.index, server).find((g) => world.stateAs(g.id, "gpu").status === "down");
  return bad ? `${bad.name}이(가) 떨어졌어요` : undefined;
}

/** A node the scheduler would not put a job on: a bad one, or one whose fabric link is flapping. */
export function nodeAvoid(world: AccelWorld, server: string, drained: readonly string[]): boolean {
  const link = ibLinkOf(world.index, server);
  const flapping = link ? world.faultsOn(link.id).some((f) => f.type === "ib_link_flap") : false;
  return flapping || nodeBad(world, server, drained) !== undefined;
}

/** The nodes of a job after the scheduler swaps the ones it avoids for spares; undefined when there are not enough good ones. */
export function swapNodes(
  world: AccelWorld,
  job: Entity,
  now: readonly string[],
  drained: readonly string[],
): string[] | undefined {
  const def = jobDef(job);
  const spares = def.spares.filter((n) => !nodeAvoid(world, n, drained) && !now.includes(n));
  const out: string[] = [];
  for (const n of now) {
    if (!nodeAvoid(world, n, drained)) out.push(n);
    else if (spares.length > 0) out.push(spares.shift() as string);
  }
  return out.length === def.nodes.length ? out : undefined;
}
