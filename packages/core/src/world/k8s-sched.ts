/**
 * The scheduler of the container layer (REQ-096): which node a pod goes to. It is a plain function of the nodes and
 * the pods standing now, so the world starts with the pods where the cluster itself would put them, and the cluster
 * puts replacements the same way later. A node takes a pod when it is Ready, not cordoned, not short of disk, and has
 * room left for what the pod asks for; among those the one with the most room left wins, ties by id.
 */
import type { Entity } from "./blueprint";
import type { BlueprintIndex } from "./graph";
import { k8sWorkloadDef, podSuffix } from "./k8s";
import type { K8sNodeState, K8sWorkloadState, PodState } from "./state-k8s";

export interface NodeRef {
  readonly id: string;
  readonly s: K8sNodeState;
}
export interface WorkloadRef {
  readonly entity: Entity;
  readonly s: K8sWorkloadState;
}

/** A pod that holds a place on its node (Evicted ones and ones with no node do not). */
export const holdsPlace = (p: PodState): boolean => p.node !== null && p.phase !== "Evicted";

export function usedOn(
  nodeId: string,
  workloads: readonly WorkloadRef[],
): { cpu: number; mem: number } {
  let cpu = 0;
  let mem = 0;
  for (const w of workloads) {
    const def = k8sWorkloadDef(w.entity);
    const n = w.s.pods.filter((p) => p.node === nodeId && holdsPlace(p)).length;
    cpu += n * def.cpuMilli;
    mem += n * def.memMiB;
  }
  return { cpu, mem };
}

export const takesPods = (n: K8sNodeState): boolean =>
  n.status === "Ready" && !n.unschedulable && !n.diskPressure;

/** The node with the most room for a pod of this workload, or undefined when none has room. */
export function pickNode(
  nodes: readonly NodeRef[],
  workloads: readonly WorkloadRef[],
  entity: Entity,
  skip?: string,
): NodeRef | undefined {
  const def = k8sWorkloadDef(entity);
  let best: { n: NodeRef; free: number } | undefined;
  for (const n of nodes) {
    if (n.id === skip || !takesPods(n.s)) continue;
    const used = usedOn(n.id, workloads);
    const cpuFree = n.s.allocCpuMilli - used.cpu - def.cpuMilli;
    const memFree = n.s.allocMemMiB - used.mem - def.memMiB;
    if (cpuFree < 0 || memFree < 0) continue;
    const free = cpuFree / Math.max(1, n.s.allocCpuMilli) + memFree / Math.max(1, n.s.allocMemMiB);
    if (!best || free > best.free + 1e-9) best = { n, free };
  }
  return best?.n;
}

/** A new pod of a workload, not yet on any node. */
export function newPod(w: WorkloadRef, now: number): PodState {
  w.s.made += 1;
  const rs = podSuffix(`${w.entity.id}|${w.s.gen}`);
  return {
    name: `${w.entity.name}-${rs}-${podSuffix(`${w.entity.id}|${w.s.gen}|${w.s.made}`)}`,
    node: null,
    phase: "Pending",
    restarts: 0,
    since: now,
    reason: "Unschedulable",
  };
}

/** The pods that count toward the replicas wanted: everything but Evicted. */
export const livePods = (s: K8sWorkloadState): PodState[] =>
  s.pods.filter((p) => p.phase !== "Evicted");

/**
 * Bind the pods that wait for a node. A pod that finds room starts (ContainerCreating until its image is pulled).
 * Returns how many were bound.
 */
export function bindPending(
  nodes: readonly NodeRef[],
  workloads: readonly WorkloadRef[],
  now: number,
  startS: number,
): number {
  let bound = 0;
  for (const w of workloads) {
    for (const p of w.s.pods) {
      if (p.node !== null || p.phase !== "Pending") continue;
      const n = pickNode(nodes, workloads, w.entity);
      if (!n) continue;
      p.node = n.id;
      p.phase = "ContainerCreating";
      p.startsAt = now + startS;
      delete p.reason;
      bound += 1;
    }
  }
  return bound;
}

/** The pods of a world at the start: as many as each workload wants, standing where the scheduler puts them, already running. */
export function initialPods(
  _index: BlueprintIndex,
  nodes: readonly NodeRef[],
  workloads: readonly WorkloadRef[],
): void {
  for (const w of workloads) {
    for (let i = 0; i < w.s.desired; i++) {
      const pod = newPod(w, 0);
      w.s.pods.push(pod);
      const n = pickNode(nodes, workloads, w.entity);
      if (n) {
        pod.node = n.id;
        pod.phase = "Running";
        delete pod.reason;
      }
    }
  }
}
