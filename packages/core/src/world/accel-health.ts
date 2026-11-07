/**
 * How the accelerator layer looks to the service in it (REQ-107, ADR-0130). As everywhere in service health nothing is
 * simulated here: the verdict is read off the state physics keeps (physics/accel.ts), so putting the state right (a reset GPU,
 * a resumed job, a restarted scheduler) brings the service back by itself.
 *
 * The rules, for a service that leans (`depends_on`) on a pool, a job, a scheduler or a fabric:
 *   - an inference pool with no replica that answers                       stopped
 *   - a pool that lost replicas, answers slowly or still sends to a dead one slow
 *   - a training job that failed or is stuck waiting for a checkpoint       slow (the work is late, not lost)
 *   - a failed job while the scheduler is down (nothing restarts it)         stopped
 *   - the fabric with every link down                                       stopped, with some links down slow
 */
import type { Entity } from "./blueprint";
import type { ServiceStatus } from "./service";
import type { WorldReader } from "./world";

export interface AccelVerdict {
  readonly status: ServiceStatus;
  readonly reasons: readonly string[];
}

const HEALTHY: AccelVerdict = { status: "healthy", reasons: [] };
const RANK: Readonly<Record<ServiceStatus, number>> = { healthy: 0, degraded: 1, down: 2 };

/** The verdict of a part that has an `ok` / `degraded` / `down` status of its own. */
function byStatus(dep: Entity, s: { status: string; why?: string }, plain: string): AccelVerdict {
  if (s.status === "ok") return HEALTHY;
  return {
    status: s.status === "down" ? "down" : "degraded",
    reasons: [`${dep.name}: ${s.why ?? plain}`],
  };
}

function jobVerdict(world: WorldReader, dep: Entity): AccelVerdict {
  const s = world.stateAs(dep.id, "training_job");
  if (s.phase === "running" || s.phase === "resumed")
    return s.why ? { status: "degraded", reasons: [`${dep.name}: ${s.why}`] } : HEALTHY;
  const sched = world.index.ofKind("job_scheduler")[0];
  const schedDown = sched && world.stateAs(sched.id, "job_scheduler").status === "down";
  return {
    status: s.phase === "failed" && schedDown ? "down" : "degraded",
    reasons: [`${dep.name}: ${s.why ?? "학습이 멈춰 있어요"}`],
  };
}

function verdictOf(world: WorldReader, dep: Entity): AccelVerdict {
  switch (dep.kind) {
    case "inference_pool":
      return byStatus(
        dep,
        world.stateAs(dep.id, "inference_pool"),
        "추론 풀이 제대로 답하지 못해요",
      );
    case "training_job":
      return jobVerdict(world, dep);
    case "ib_fabric":
      return byStatus(dep, world.stateAs(dep.id, "ib_fabric"), "패브릭 링크가 끊겼어요");
    default:
      return HEALTHY;
  }
}

/** What the accelerator layer makes of a service: the worst of every rule above. */
export function accelHealth(world: WorldReader, service: Entity): AccelVerdict {
  if (world.index.ofKind("gpu").length === 0) return HEALTHY;
  let status: ServiceStatus = "healthy";
  const reasons: string[] = [];
  for (const link of world.index.outgoing(service.id, "depends_on")) {
    const dep = world.index.find(link.to);
    if (!dep) continue;
    const v = verdictOf(world, dep);
    if (RANK[v.status] > RANK[status]) status = v.status;
    reasons.push(...v.reasons);
  }
  return { status, reasons };
}
