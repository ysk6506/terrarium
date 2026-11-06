/**
 * The container layer of a "서비스부터" world (REQ-096, ADR-0107 item 6): when the compute choice is containers, a
 * service runs on a Kubernetes cluster that is built on its virtual machines: a control plane of one or three nodes
 * (three stand on different hosts, so on different racks), workers, a workload for each part of the service, and a
 * batch workload that is nobody's service but takes room. Two clusters (multi-cluster) stand on hosts of their own.
 * Requests are sized so the cluster is about half full: it keeps up when a node is lost and runs out of room when it
 * loses more.
 */
import { k8sClusterProps, k8sNodeProps, k8sWorkloadProps } from "@terrarium/core/world";
import { type Laying, link, slugOf } from "./shaped-db";
import type { ServiceDraft, ServicePart } from "./shaped-plan";

/** VM size of a node, and what a pod may ask of it (the kubelet and the system keep a little). */
const NODE_CPU_MILLI = 7800;
const NODE_MEM_MIB = 30_000;
const TARGET_FILL = 0.5;
const MAX_POD_MILLI = 1500;
const BATCH_MILLI = 1000;

export interface K8sSplit {
  readonly controlPlane: number;
  readonly workers: number;
}

/** Control-plane and worker nodes among a service's nodes: what its parts say, else three control-plane nodes from six nodes up. */
export function k8sSplit(draft: Pick<ServiceDraft, "nodes" | "parts">): K8sSplit {
  const said = draft.parts.find((p) => p.role === "node" && p.label.includes("컨트롤 플레인"));
  const controlPlane = said ? (said.count ?? 1) : draft.nodes >= 6 ? 3 : 1;
  return { controlPlane, workers: Math.max(1, draft.nodes - controlPlane) };
}

/** The workloads of a service: its tier-0 parts, or one workload named after it. */
function partsOf(draft: ServiceDraft): ReadonlyArray<{ name: string; replicas: number }> {
  const tops = draft.parts.filter((p: ServicePart) => p.tier === 0 && p.role === undefined);
  if (tops.length === 0)
    return [{ name: slugOf(draft.key) || "app", replicas: Math.min(3, k8sSplit(draft).workers) }];
  return tops.map((p, i) => ({
    name: p.workload ?? (slugOf(p.label) || `app-${i + 1}`),
    replicas: Math.max(1, p.count ?? 2),
  }));
}

function layCluster(
  into: Laying,
  id: string,
  title: string,
  draft: ServiceDraft,
  vms: readonly string[],
): string[] {
  const { controlPlane, workers } = k8sSplit(draft);
  into.entities.push({ id, kind: "k8s_cluster", name: title, props: k8sClusterProps() });
  // the first VMs are the control plane: they stand on different hosts, so on different racks
  vms.forEach((vm, i) => {
    const cp = i < controlPlane;
    const tag = cp ? "cp" : "w";
    const n = cp ? i + 1 : i - controlPlane + 1;
    const node = `${id}-${tag}${n}`;
    into.entities.push({
      id: node,
      kind: "k8s_node",
      name: `${slugOf(draft.key)}-${cp ? "cp" : "worker"}-${n}${id.endsWith("-b") ? "b" : ""}`,
      props: k8sNodeProps({
        role: cp ? "control-plane" : "worker",
        cpuMilli: NODE_CPU_MILLI,
        memMiB: NODE_MEM_MIB,
      }),
    });
    link(into, "hosted_on", node, vm);
    link(into, "member_of", node, id);
  });
  const parts = partsOf(draft);
  const batch = Math.max(1, Math.floor(workers / 2));
  const total = workers * NODE_CPU_MILLI * TARGET_FILL - batch * BATCH_MILLI;
  const pods = parts.reduce((n, p) => n + p.replicas, 0);
  const each = Math.max(100, Math.min(MAX_POD_MILLI, Math.round(total / pods / 100) * 100));
  const ids: string[] = [];
  const add = (name: string, replicas: number, milli: number, service: boolean): void => {
    const wid = `${id}-${slugOf(name)}`;
    into.entities.push({
      id: wid,
      kind: "k8s_workload",
      name,
      props: k8sWorkloadProps({
        replicas,
        cpuMilli: milli,
        memMiB: milli * 2,
        namespace: "default",
      }),
    });
    link(into, "member_of", wid, id);
    if (service) ids.push(wid);
  };
  for (const p of parts) add(p.name, p.replicas, each, true);
  add("batch", batch, BATCH_MILLI, false);
  return ids;
}

/**
 * Build the clusters of one service on its VMs (`draft.nodes` for each cluster, in order) and return the workloads
 * the service leans on.
 */
export function layK8s(
  into: Laying,
  draft: ServiceDraft,
  vms: readonly string[],
  clusters: number,
): string[] {
  const ids: string[] = [];
  for (let k = 0; k < clusters; k++) {
    const id = `k8s-${slugOf(draft.key)}${k === 0 ? "" : "-b"}`;
    const title = k === 0 ? `${draft.name} 쿠버네티스` : `${draft.name} 쿠버네티스 (두 번째)`;
    ids.push(
      ...layCluster(into, id, title, draft, vms.slice(k * draft.nodes, (k + 1) * draft.nodes)),
    );
  }
  return ids;
}

export const dependsOn = (into: Laying, service: string, workloads: readonly string[]): void => {
  for (const w of workloads) link(into, "depends_on", service, w);
};
