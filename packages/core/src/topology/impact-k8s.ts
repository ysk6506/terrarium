/**
 * How a loss spreads through the container layer (REQ-096): a host or VM that is gone takes the node on it, the node
 * takes the pods that stood on it, a workload whose pods are all gone is gone, and the service that leans on it feels
 * it. Pods are not entities, so the step from a node to a workload reads the workload's state.
 */
import type { BlueprintIndex } from "@terrarium/core/world";
import type { TopologySource } from "./types";

interface Reach {
  readonly down: Set<string>;
  readonly affected: Set<string>;
}

/** The nodes that stand on this host or VM. */
const nodesOn = (index: BlueprintIndex, host: string): string[] =>
  index
    .incoming(host, "hosted_on")
    .map((l) => l.from)
    .filter((id) => index.find(id)?.kind === "k8s_node");

/** Workloads of the node's cluster that have a pod on it. */
function workloadsOn(source: TopologySource, node: string): string[] {
  const { index } = source;
  const cluster = index.outgoing(node, "member_of")[0]?.to;
  if (!cluster) return [];
  return index
    .incoming(cluster, "member_of")
    .map((l) => l.from)
    .filter((id) => index.find(id)?.kind === "k8s_workload")
    .filter((id) => {
      const s = source.stateOf(id);
      return s.kind === "k8s_workload" && s.pods.some((p) => p.node === node);
    });
}

/** What `lost` takes with it in the container layer; the ids that went down are added to `queue`. */
export function k8sRollUp(
  source: TopologySource,
  lost: string,
  reach: Reach,
  queue: string[],
): void {
  const { index } = source;
  for (const node of nodesOn(index, lost)) {
    reach.affected.add(node);
    if (!reach.down.has(node)) {
      reach.down.add(node);
      queue.push(node);
    }
  }
  if (index.find(lost)?.kind !== "k8s_node") return;
  for (const w of workloadsOn(source, lost)) {
    reach.affected.add(w);
    const s = source.stateOf(w);
    if (s.kind !== "k8s_workload" || reach.down.has(w)) continue;
    const live = s.pods.filter((p) => p.phase !== "Evicted");
    if (live.length > 0 && live.every((p) => p.node !== null && reach.down.has(p.node))) {
      reach.down.add(w);
      queue.push(w);
    }
  }
}
