/**
 * The state of the container layer (REQ-096): nodes (ready or not, cordoned, short of disk), workloads with their
 * pods, and the cluster's control plane. Where the pods stand at the start is decided by the same scheduler the
 * cluster uses later (k8s-sched.ts). The rest of the world's state is in state.ts, which re-exports these.
 */
import type { Entity } from "./blueprint";
import type { BlueprintIndex } from "./graph";
import { k8sNodeDef, k8sWorkloadDef, nodesOfCluster, workloadsOfCluster } from "./k8s";
import { initialPods } from "./k8s-sched";
import type { EntityState } from "./state";

interface Base {
  health: "ok" | "warning" | "critical";
}

export type PodPhase =
  | "Running"
  | "ContainerCreating"
  | "Pending"
  | "CrashLoopBackOff"
  | "ImagePullBackOff"
  | "Evicted";

/** One pod. `node` is the k8s_node it is bound to, `null` while the scheduler has not found room. */
export interface PodState {
  name: string;
  node: string | null;
  phase: PodPhase;
  restarts: number;
  /** World time it was created. */
  since: number;
  /** ContainerCreating: the time it is running. */
  startsAt?: number;
  /** CrashLoopBackOff: the time it is tried again. */
  backoffUntil?: number;
  /** Evicted: the time it stops being listed. */
  goneAt?: number;
  /** A pod of a rollout that is started before the old one goes: the old pod's name. */
  replaces?: string;
  /** Why it is not running, one short phrase (what `kubectl describe` shows as Reason). */
  reason?: string;
}

export interface K8sNodeState extends Base {
  kind: "k8s_node";
  /** What the API says. It lags behind `reachable` by the grace period, and stays as it was while the control plane is down. */
  status: "Ready" | "NotReady";
  /** Whether the machine under it works (physics reads the VM or server). */
  reachable: boolean;
  /** Cordoned: nothing new is scheduled here. */
  unschedulable: boolean;
  /** Cordoned by the cluster because the disk ran short, and still so until an operator uncordons it. */
  cordonedByPressure: boolean;
  diskPressure: boolean;
  /** The kubelet has already thrown pods out for this pressure (it does so once, when the pressure begins). */
  pressureSeen?: boolean;
  /** The network plugin on this node does not work: pods run but cannot talk. */
  cniBroken: boolean;
  /** What pods may ask for on this node. */
  allocCpuMilli: number;
  allocMemMiB: number;
  /** The fill of a disk-pressure fault was put on the disk (so that cleaning it ends the fault). */
  fillDone?: boolean;
  /** World time it was first found unreachable. */
  notReadySince?: number;
  why?: string;
}

export interface K8sWorkloadState extends Base {
  kind: "k8s_workload";
  /** Replicas wanted now (`kubectl scale` changes it; the entity's props are where it started). */
  desired: number;
  pods: PodState[];
  /** Rollout generation, and pods made so far (names stay unique). */
  gen: number;
  made: number;
  /** A rollout restart under way: the pods still to be replaced, oldest first. */
  rollQueue?: string[];
}

export interface K8sClusterState extends Base {
  kind: "k8s_cluster";
  /** The API answers and the scheduler places pods. */
  apiUp: boolean;
  etcdUp: number;
  etcdTotal: number;
  quorum: boolean;
  cpUp: number;
  cpTotal: number;
  /** Pods the cluster moved to other nodes by itself so far. */
  reschedules: number;
  /** A service has been sent to the other cluster because this one's workload stopped. */
  shifted: boolean;
  why?: string;
}

type StateFactory = () => K8sNodeState | K8sWorkloadState | K8sClusterState;

export const K8S_FACTORIES: Readonly<
  Record<"k8s_node" | "k8s_workload" | "k8s_cluster", StateFactory>
> = {
  k8s_node: () => ({
    kind: "k8s_node",
    health: "ok",
    status: "Ready",
    reachable: true,
    unschedulable: false,
    cordonedByPressure: false,
    diskPressure: false,
    cniBroken: false,
    allocCpuMilli: 0,
    allocMemMiB: 0,
  }),
  k8s_workload: () => ({
    kind: "k8s_workload",
    health: "ok",
    desired: 0,
    pods: [],
    gen: 1,
    made: 0,
  }),
  k8s_cluster: () => ({
    kind: "k8s_cluster",
    health: "ok",
    apiUp: true,
    etcdUp: 0,
    etcdTotal: 0,
    quorum: true,
    cpUp: 0,
    cpTotal: 0,
    reschedules: 0,
    shifted: false,
  }),
};

/** Settings that become state at the start: allocatable resources, replicas wanted, control-plane counts. */
export function placeK8sEntity(state: EntityState, entity: Entity, index: BlueprintIndex): void {
  if (state.kind === "k8s_node") {
    const def = k8sNodeDef(entity);
    state.allocCpuMilli = def.cpuMilli;
    state.allocMemMiB = def.memMiB;
  } else if (state.kind === "k8s_workload") state.desired = k8sWorkloadDef(entity).replicas;
  else if (state.kind === "k8s_cluster") {
    const nodes = nodesOfCluster(index, entity.id);
    const cp = nodes.filter((n) => k8sNodeDef(n).role === "control-plane").length;
    state.cpTotal = cp;
    state.cpUp = cp;
    state.etcdTotal = cp;
    state.etcdUp = cp;
  }
}

/** After every entity has its state: put the pods of each workload on nodes. */
export function placePods(states: Record<string, EntityState>, index: BlueprintIndex): void {
  for (const cluster of index.ofKind("k8s_cluster")) {
    const nodes = nodesOfCluster(index, cluster.id)
      .filter((n) => k8sNodeDef(n).role === "worker")
      .map((n) => ({ id: n.id, s: states[n.id] as K8sNodeState }));
    const workloads = workloadsOfCluster(index, cluster.id).map((w) => ({
      entity: w,
      s: states[w.id] as K8sWorkloadState,
    }));
    initialPods(nodes, workloads);
  }
}
