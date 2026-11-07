/**
 * How trouble spreads through the application layer (REQ-100): a service that is stopped or slow puts every service that
 * calls it in the range, and the callers of those in turn, because a `calls` link carries the slowness upstream. What
 * stands next to a service (a replica, a balancer, a store, a sidecar, a region) reaches it by its own `depends_on` and
 * `member_of` links, and the service shows it in its state, so only the calls need a walk of their own.
 */
import type { TopologySource } from "./types";

/** Whether a service or workload is in trouble now: a service by its status, a workload by pods that are not running. */
function troubled(source: TopologySource, id: string): boolean {
  const s = source.stateOf(id);
  if (s.kind === "service") return s.status !== "healthy";
  if (s.kind === "k8s_workload")
    return s.pods.filter((p) => p.phase === "Running").length < s.desired;
  return false;
}

/** Add every caller, however far up, of a service or workload that is in trouble to `affected`. */
export function callsRollUp(source: TopologySource, affected: Set<string>): void {
  const { index } = source;
  const queue = [...index.ofKind("service"), ...index.ofKind("k8s_workload")]
    .map((e) => e.id)
    .filter((id) => troubled(source, id));
  const seen = new Set(queue);
  while (queue.length > 0) {
    const callee = queue.pop() as string;
    for (const l of index.incoming(callee, "calls")) {
      affected.add(l.from);
      if (seen.has(l.from)) continue;
      seen.add(l.from);
      queue.push(l.from);
    }
  }
}
