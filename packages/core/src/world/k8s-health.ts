/**
 * How a workload looks to the service that leans on it (REQ-096). Nothing is simulated here: the verdict is read off
 * the pods physics keeps (physics/k8s.ts). A pod serves when it is Running on a node that works and whose network
 * plugin works. Replicas serving out of replicas wanted decide: none is stopped, some is slow. A control plane that is
 * down only stops what needs the API (new deployments, scheduling, moving pods); pods that already run keep serving, so
 * it adds no verdict of its own. A service that leans on workloads of several clusters stops only when every cluster's
 * workload is stopped, and is slow while any one of them is not whole.
 */
import type { Entity } from "./blueprint";
import type { DepVerdict } from "./db-health";
import { clusterOfK8s, workloadsOfService } from "./k8s";
import type { PodState } from "./state-k8s";
import type { WorldReader } from "./world";

const OK: DepVerdict = { state: "ok" };

/** Whether this pod answers requests now. */
export function isServing(world: WorldReader, pod: PodState): boolean {
  if (pod.phase !== "Running" || pod.node === null) return false;
  const n = world.stateAs(pod.node, "k8s_node");
  return n.reachable && !n.cniBroken;
}

export function servingCount(world: WorldReader, workload: Entity): number {
  const s = world.stateAs(workload.id, "k8s_workload");
  return Math.min(s.desired, s.pods.filter((p) => isServing(world, p)).length);
}

function whyNot(world: WorldReader, workload: Entity): string {
  const s = world.stateAs(workload.id, "k8s_workload");
  const count = new Map<string, number>();
  for (const p of s.pods) {
    if (p.phase === "Evicted" || isServing(world, p)) continue;
    const node = p.node ? world.stateAs(p.node, "k8s_node") : undefined;
    const label =
      p.phase === "Running" && node && !node.reachable
        ? "노드가 멈춘 곳의 파드"
        : p.phase === "Running"
          ? "통신이 끊긴 파드"
          : p.phase;
    count.set(label, (count.get(label) ?? 0) + 1);
  }
  const parts = [...count].map(([k, n]) => `${k} ${n}개`);
  return parts.length > 0 ? parts.join(", ") : "파드가 모자라요";
}

/** One workload as the service that leans on it sees it. */
export function workloadVerdict(world: WorldReader, workload: Entity): DepVerdict {
  const s = world.stateAs(workload.id, "k8s_workload");
  const name = workload.name;
  if (s.desired === 0) return { state: "dead", why: `${name}: 레플리카가 0개예요` };
  const serving = servingCount(world, workload);
  if (serving === 0)
    return { state: "dead", why: `${name}: 돌고 있는 파드가 없어요 — ${whyNot(world, workload)}` };
  if (serving < s.desired)
    return {
      state: "slow",
      why: `${name}: 레플리카 ${serving}/${s.desired}개만 돌아요 — ${whyNot(world, workload)}`,
    };
  return OK;
}

/** The workloads a service leans on, taken together (several clusters back each other up). */
export function workloadsVerdict(world: WorldReader, workloads: readonly Entity[]): DepVerdict {
  const verdicts = workloads.map((w) => workloadVerdict(world, w));
  const bad = verdicts.filter((v) => v.state !== "ok");
  if (bad.length === 0) return OK;
  const why = bad[0]?.why;
  const clusters = new Set(workloads.map((w) => clusterOfK8s(world.index, w.id)?.id));
  const spread = clusters.size > 1;
  const allDead = verdicts.every((v) => v.state === "dead");
  if (allDead) return { state: "dead", ...(why ? { why } : {}) };
  if (spread && bad.every((v) => v.state === "dead" || v.state === "slow"))
    return {
      state: "slow",
      ...(why ? { why: `${why} (다른 클러스터가 대신 받아요)` } : {}),
    };
  return bad.some((v) => v.state === "dead")
    ? { state: "dead", ...(why ? { why } : {}) }
    : { state: "slow", ...(why ? { why } : {}) };
}

/** Whether a machine is the one under a node of a cluster. */
export const isNodeHost = (world: WorldReader, id: string): boolean =>
  world.index.incoming(id, "hosted_on").some((l) => world.index.find(l.from)?.kind === "k8s_node");

/**
 * Whether a service stands on a cluster: it leans on a workload and runs on machines that are nodes (or on no machine at all). The machines
 * under the nodes are then not read as places of the service (the pods are), but any other place it has (a storage
 * array, a server of its own) still is.
 */
export function standsOnCluster(world: WorldReader, serviceId: string): boolean {
  if (workloadsOfService(world.index, serviceId).length === 0) return false;
  const places = world.stateAs(serviceId, "service").runsOn;
  return places.length === 0 || places.some((id) => isNodeHost(world, id));
}
