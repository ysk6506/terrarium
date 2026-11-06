/**
 * What an operator does to a cluster (REQ-096): restart a workload's rollout, scale it, cordon or uncordon a node,
 * drain a node, delete a pod. Like the other commands they are world events and change state only through the
 * reducers here. They all go through the API, so none works while the control plane is down. Physics does the rest
 * (physics/k8s.ts): it makes the pods a workload is missing and places the ones that wait.
 */
import { ConflictError, InvalidValueError } from "@terrarium/core/kernel";
import { clusterOfK8s } from "./k8s";
import type { WorkloadRef } from "./k8s-sched";
import type { WorldReader } from "./world";

export type K8sCommand =
  /** Replace the pods of a workload one by one, and let it pick up a fixed image or configuration. */
  | { readonly type: "k8s.rollout_restart"; readonly target: string }
  | { readonly type: "k8s.scale"; readonly target: string; readonly replicas: number }
  /** `on`: no new pods on this node (cordon); otherwise uncordon. */
  | { readonly type: "k8s.cordon"; readonly target: string; readonly on: boolean }
  | { readonly type: "k8s.drain"; readonly target: string }
  | { readonly type: "k8s.delete_pod"; readonly target: string; readonly pod: string };

export const K8S_COMMAND_TYPES: readonly string[] = [
  "k8s.rollout_restart",
  "k8s.scale",
  "k8s.cordon",
  "k8s.drain",
  "k8s.delete_pod",
];
export const isK8sCommand = (type: string): boolean => K8S_COMMAND_TYPES.includes(type);

export const MAX_REPLICAS = 50;

const REFUSED =
  "The connection to the server was refused — did you specify the right host or port? (컨트롤 플레인이 멈춰 있어요)";

function apiOf(world: WorldReader, id: string): void {
  const cluster = clusterOfK8s(world.index, id);
  if (!cluster) throw new InvalidValueError(`'${id}'는 어느 클러스터에도 속하지 않아요`);
  if (!world.stateAs(cluster.id, "k8s_cluster").apiUp) throw new ConflictError(REFUSED);
}

/** The workload that owns a pod, by the pod's name. */
export function workloadOfPod(world: WorldReader, pod: string): string | undefined {
  for (const w of world.index.ofKind("k8s_workload"))
    if (world.stateAs(w.id, "k8s_workload").pods.some((p) => p.name === pod)) return w.id;
  return undefined;
}

export function checkK8sCommand(world: WorldReader, c: K8sCommand): void {
  const kind = world.index.find(c.target)?.kind;
  if (c.type === "k8s.cordon" || c.type === "k8s.drain") {
    if (kind !== "k8s_node") throw new InvalidValueError(`'${c.target}'는 노드가 아니에요`);
    apiOf(world, c.target);
    return;
  }
  if (kind !== "k8s_workload") throw new InvalidValueError(`'${c.target}'는 워크로드가 아니에요`);
  apiOf(world, c.target);
  if (
    c.type === "k8s.scale" &&
    (!Number.isInteger(c.replicas) || c.replicas < 0 || c.replicas > MAX_REPLICAS)
  )
    throw new InvalidValueError(`레플리카는 0~${MAX_REPLICAS} 사이의 정수예요`);
  if (c.type === "k8s.delete_pod") {
    const s = world.stateAs(c.target, "k8s_workload");
    if (!s.pods.some((p) => p.name === c.pod))
      throw new InvalidValueError(`'${c.pod}' 파드가 '${c.target}'에 없어요`);
  }
}

/** What the reducers read of the world beyond reading it. */
export interface K8sActContext {
  readonly world: WorldReader;
  readonly t: number;
  dropFault(faultId: string): void;
}

const refOf = (ctx: K8sActContext, id: string): WorkloadRef => ({
  entity: ctx.world.index.entity(id),
  s: ctx.world.stateAs(id, "k8s_workload"),
});

/** A rollout restart: the config or image is the fixed one from now on, and the pods are replaced one at a time. */
export function rolloutRestart(ctx: K8sActContext, id: string): void {
  for (const f of ctx.world.faultsOn(id)) if (f.type === "k8s_pod_crashloop") ctx.dropFault(f.id);
  const w = refOf(ctx, id);
  w.s.gen += 1;
  w.s.rollQueue = w.s.pods.filter((p) => p.phase !== "Evicted").map((p) => p.name);
}

export function scale(ctx: K8sActContext, id: string, replicas: number): void {
  refOf(ctx, id).s.desired = replicas;
}

export function cordon(ctx: K8sActContext, id: string, on: boolean): void {
  const s = ctx.world.stateAs(id, "k8s_node");
  s.unschedulable = on;
  if (!on) s.cordonedByPressure = false;
}

/** Cordon, then send every pod off the node; the workloads make their replacements elsewhere. */
export function drain(ctx: K8sActContext, id: string): void {
  cordon(ctx, id, true);
  const cluster = clusterOfK8s(ctx.world.index, id);
  if (!cluster) return;
  for (const w of ctx.world.index.ofKind("k8s_workload")) {
    if (clusterOfK8s(ctx.world.index, w.id)?.id !== cluster.id) continue;
    const s = ctx.world.stateAs(w.id, "k8s_workload");
    s.pods = s.pods.filter((p) => p.node !== id || p.phase === "Evicted");
    if (s.rollQueue) s.rollQueue = s.rollQueue.filter((n) => s.pods.some((p) => p.name === n));
  }
}

export function deletePod(ctx: K8sActContext, id: string, pod: string): void {
  const s = ctx.world.stateAs(id, "k8s_workload");
  s.pods = s.pods.filter((p) => p.name !== pod);
}

/** Restarting kubelet or containerd on a host ends what a restart can: a stopped kubelet, a dead network plugin. */
export function restartKubelet(ctx: K8sActContext, hostId: string): void {
  for (const l of ctx.world.index.incoming(hostId, "hosted_on")) {
    if (ctx.world.index.find(l.from)?.kind !== "k8s_node") continue;
    for (const f of ctx.world.faultsOn(l.from))
      if (
        f.type === "k8s_node_notready" ||
        f.type === "k8s_control_plane_down" ||
        f.type === "k8s_cni_failure"
      )
        ctx.dropFault(f.id);
  }
}
