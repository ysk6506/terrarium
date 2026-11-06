/**
 * The container layer (REQ-096, ADR-0107 item 6, docs/design-docs/container-layer.md).
 *
 * A Kubernetes cluster is a set of nodes (control-plane or worker, each a VM or a server) and workloads (a Deployment:
 * replicas of a pod with the resources each asks for). Settings are props of the entity; where the pods are and what
 * state they are in is state (state-k8s.ts). Pods are not entities of the blueprint: they come and go with scaling and
 * rescheduling, so they live in the state of their workload. A service leans on a workload with `depends_on`.
 */
import type { Entity, PropValue } from "./blueprint";
import type { BlueprintIndex } from "./graph";

export type NodeRole = "control-plane" | "worker";

export const NODE_ROLE_LABELS: Readonly<Record<NodeRole, string>> = {
  "control-plane": "컨트롤 플레인",
  worker: "워커",
};

/** Seconds a node may be silent before the cluster calls it NotReady (kube-controller-manager's grace period). */
export const NODE_GRACE_S = 40;
/** Default `pod-eviction-timeout`: how long a NotReady node keeps its pods before they are moved. */
export const DEFAULT_EVICTION_S = 300;
/** Seconds a new pod needs to pull its image and start. */
export const POD_START_S = 15;
/** CrashLoopBackOff: the first wait, and the longest. */
export const BACKOFF_FIRST_S = 10;
export const BACKOFF_MAX_S = 300;
/** Disk use (%) at which the kubelet reports DiskPressure and starts evicting. */
export const DISK_PRESSURE_PCT = 85;
/** How long an Evicted pod is still listed. */
export const EVICTED_KEEP_S = 600;
/** DRS (virtualisation): a host this busy with a gap this wide to the idlest one has VMs moved off it. */
export const DRS_HOT_UTIL = 0.8;
export const DRS_GAP = 0.3;
export const DRS_MIGRATE_S = 30;

const num = (props: Entity["props"], key: string): number | undefined =>
  typeof props[key] === "number" ? (props[key] as number) : undefined;

export interface K8sClusterDef {
  readonly evictionS: number;
}
export function k8sClusterDef(entity: Entity): K8sClusterDef {
  return { evictionS: num(entity.props, "evictionS") ?? DEFAULT_EVICTION_S };
}
export const k8sClusterProps = (def: Partial<K8sClusterDef> = {}): Record<string, PropValue> =>
  def.evictionS !== undefined ? { evictionS: def.evictionS } : {};

export interface K8sNodeDef {
  readonly role: NodeRole;
  readonly cpuMilli: number;
  readonly memMiB: number;
}
export function k8sNodeDef(entity: Entity): K8sNodeDef {
  const p = entity.props;
  return {
    role: p.role === "control-plane" ? "control-plane" : "worker",
    cpuMilli: num(p, "cpuMilli") ?? 7800,
    memMiB: num(p, "memMiB") ?? 30_000,
  };
}
export const k8sNodeProps = (def: K8sNodeDef): Record<string, PropValue> => ({
  role: def.role,
  cpuMilli: def.cpuMilli,
  memMiB: def.memMiB,
});

export interface K8sWorkloadDef {
  readonly replicas: number;
  readonly cpuMilli: number;
  readonly memMiB: number;
  readonly namespace: string;
}
export function k8sWorkloadDef(entity: Entity): K8sWorkloadDef {
  const p = entity.props;
  return {
    replicas: num(p, "replicas") ?? 2,
    cpuMilli: num(p, "cpuMilli") ?? 500,
    memMiB: num(p, "memMiB") ?? 1024,
    namespace: typeof p.namespace === "string" ? p.namespace : "default",
  };
}
export const k8sWorkloadProps = (def: K8sWorkloadDef): Record<string, PropValue> => ({
  replicas: def.replicas,
  cpuMilli: def.cpuMilli,
  memMiB: def.memMiB,
  namespace: def.namespace,
});

// ── looking things up in the blueprint ────────────────────────────────────────────────────────

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);

export const clusterOfK8s = (index: BlueprintIndex, id: string): Entity | undefined => {
  const to = index.outgoing(id, "member_of")[0]?.to;
  return to ? index.find(to) : undefined;
};

const membersOf = (index: BlueprintIndex, clusterId: string, kind: Entity["kind"]): Entity[] =>
  index
    .incoming(clusterId, "member_of")
    .map((l) => index.find(l.from))
    .filter((e): e is Entity => e?.kind === kind)
    .sort(byId);

export const nodesOfCluster = (index: BlueprintIndex, clusterId: string): Entity[] =>
  membersOf(index, clusterId, "k8s_node");
export const workloadsOfCluster = (index: BlueprintIndex, clusterId: string): Entity[] =>
  membersOf(index, clusterId, "k8s_workload");
export const controlPlaneOf = (index: BlueprintIndex, clusterId: string): Entity[] =>
  nodesOfCluster(index, clusterId).filter((n) => k8sNodeDef(n).role === "control-plane");
export const workersOf = (index: BlueprintIndex, clusterId: string): Entity[] =>
  nodesOfCluster(index, clusterId).filter((n) => k8sNodeDef(n).role === "worker");

/** The VM or server a node is. */
export const nodeHost = (index: BlueprintIndex, nodeId: string): string | undefined =>
  index.outgoing(nodeId, "hosted_on")[0]?.to;

/** The workloads a service leans on. */
export const workloadsOfService = (index: BlueprintIndex, serviceId: string): Entity[] =>
  index
    .outgoing(serviceId, "depends_on")
    .map((l) => index.find(l.to))
    .filter((e): e is Entity => e?.kind === "k8s_workload")
    .sort(byId);

/** The services that lean on a workload. */
export const servicesOfWorkload = (index: BlueprintIndex, workloadId: string): Entity[] =>
  index
    .incoming(workloadId, "depends_on")
    .map((l) => index.find(l.from))
    .filter((e): e is Entity => e?.kind === "service")
    .sort(byId);

/** A short suffix for pod names, the same for the same workload, generation and number. */
export function podSuffix(seed: string): string {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h.toString(36).padStart(5, "0").slice(-5);
}
