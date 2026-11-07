/**
 * How the site and DR layer looks to the service in it (REQ-106, ADR-0129). As everywhere in service health nothing is
 * simulated here: the verdict is read off the state physics keeps (physics/site.ts, physics/dbx.ts), so putting the state
 * right (a failover done, a node restarted, a volume promoted) brings the service back by itself.
 *
 * The rules, for a service:
 *   - the consensus ring lost its majority                         stopped
 *   - the ring has no leader (an election is running), or a node   slow
 *     trails
 *   - the managed database stalls writes (a zone switch, full      stopped for a stateful service, slow for the others
 *     storage), or has no zone left                                 (no zone left: stopped)
 *   - a synchronous copy waits for a link that does not answer     stopped for a stateful service, slow for the others
 *     (until it falls back to asynchronous), or the link is slow
 *   - both sites took writes while cut off (split brain)           stopped for a stateful service, slow for the others
 *   - its volume is promoted at the other site while it still      slow (the link is cut: stopped)
 *     runs here, or the copy is broken
 * A database or pool that a plan copies is covered once the plan serves from the other site (`drCovers`).
 */
import type { Entity } from "./blueprint";
import type { ServiceStatus } from "./service";
import { serviceDef } from "./service";
import {
  majority,
  managedOf,
  planOfTarget,
  ringOf,
  SYNC_FALLBACK_S,
  SYNC_SLOW_MS,
  siteOf,
  streamDef,
  streams,
  volumes,
} from "./site-dr";
import { linkState } from "./site-model";
import type { WorldReader } from "./world";

export interface SiteVerdict {
  readonly status: ServiceStatus;
  readonly reasons: readonly string[];
}

const HEALTHY: SiteVerdict = { status: "healthy", reasons: [] };
const RANK: Readonly<Record<ServiceStatus, number>> = { healthy: 0, degraded: 1, down: 2 };

const stalls = (stateful: boolean, why: string): SiteVerdict => ({
  status: stateful ? "down" : "degraded",
  reasons: [why],
});
const slow = (why: string): SiteVerdict => ({ status: "degraded", reasons: [why] });
const dead = (why: string): SiteVerdict => ({ status: "down", reasons: [why] });

function ringVerdict(world: WorldReader, ring: readonly Entity[]): SiteVerdict {
  const states = ring.map((n) => [n, world.stateAs(n.id, "db_node")] as const);
  const alive = states.filter(([, s]) => s.status !== "down");
  if (alive.length < majority(ring.length))
    return dead(
      `합의 DB 노드 ${ring.length}개 중 ${alive.length}개만 남아 과반이 없어요 — 쓰기가 멈췄고 읽기는 옛 값이에요`,
    );
  if (!alive.some(([, s]) => s.role === "leader"))
    return slow("합의 DB가 새 리더를 뽑는 중이에요 — 쓰기가 잠깐 멈칫해요");
  const lagging = alive.find(([, s]) => s.status === "lagging");
  if (lagging)
    return slow(
      `${lagging[0].name}가 ${Math.round(lagging[1].lagS)}초 밀려 그 노드에서 읽으면 옛 값이에요`,
    );
  return HEALTHY;
}

function managedVerdict(world: WorldReader, db: Entity, stateful: boolean): SiteVerdict {
  const s = world.stateAs(db.id, "db_managed");
  if (s.status === "ok") return HEALTHY;
  const why = `${db.name}: ${s.why ?? "관리형 DB가 쓰기를 받지 못해요"}`;
  return s.status === "down" ? dead(why) : stalls(stateful, why);
}

function volumeVerdict(world: WorldReader, service: Entity, vol: Entity): SiteVerdict {
  const s = world.stateAs(vol.id, "volume");
  if (s.status === "down") return dead(`${vol.name}: ${s.why ?? "볼륨을 쓸 수 없어요"}`);
  const home = siteOf(world.index, vol.id);
  if (s.primary === home || s.primary === "") return HEALTHY;
  const runsAt = world.stateAs(service.id, "service").runsOn[0];
  if (runsAt && siteOf(world.index, runsAt) === s.primary) return HEALTHY;
  if (linkState(world)?.status === "down")
    return dead(`${vol.name}의 주인이 다른 사이트인데 회선이 끊겨 있어요`);
  return slow(`${vol.name}의 주인이 다른 사이트라 쓰기가 회선을 건너요 — 서비스도 그쪽으로 옮겨요`);
}

function streamVerdict(world: WorldReader, service: Entity, stateful: boolean): SiteVerdict {
  const s = streams(world.index).find((x) => streamDef(x).target === service.id);
  if (!s) return HEALTHY;
  const st = world.stateAs(s.id, "replication_stream");
  if (st.mode !== "sync") return HEALTHY;
  if (st.stalledSince !== undefined && world.time() - st.stalledSince < SYNC_FALLBACK_S)
    return stalls(stateful, "동기 복제가 다른 사이트의 확인을 기다리느라 쓰기가 멈칫해요");
  const ms = linkState(world)?.latencyMs ?? 0;
  if (ms > SYNC_SLOW_MS)
    return slow(`동기 복제라 쓰기마다 회선 ${Math.round(ms)}ms를 기다려 느려요`);
  return HEALTHY;
}

function planVerdict(world: WorldReader, service: Entity, stateful: boolean): SiteVerdict {
  const plan = planOfTarget(world.index, service.id);
  if (!plan) return HEALTHY;
  const s = world.stateAs(plan.id, "dr_plan");
  if (s.split)
    return stalls(stateful, "두 사이트가 모두 자기가 주인이라 쓰기가 갈라졌어요(스플릿 브레인)");
  return HEALTHY;
}

function worst(parts: readonly SiteVerdict[]): SiteVerdict {
  let status: ServiceStatus = "healthy";
  const reasons: string[] = [];
  for (const v of parts) {
    if (RANK[v.status] > RANK[status]) status = v.status;
    reasons.push(...v.reasons);
  }
  return { status, reasons };
}

/** What the site and DR layer and the new databases make of a service: the worst of every rule above. */
export function siteHealth(world: WorldReader, service: Entity): SiteVerdict {
  const idx = world.index;
  if (
    idx.ofKind("dr_plan").length +
      idx.ofKind("db_node").length +
      idx.ofKind("db_managed").length +
      idx.ofKind("volume").length ===
    0
  )
    return HEALTHY;
  const stateful = serviceDef(service).kind === "stateful";
  const ring = ringOf(idx, service.id);
  const managed = managedOf(idx, service.id);
  const vols = volumes(idx).filter((v) => v.props.service === service.id);
  return worst([
    ...(ring.length > 0 ? [ringVerdict(world, ring)] : []),
    ...(managed ? [managedVerdict(world, managed, stateful)] : []),
    ...vols.map((v) => volumeVerdict(world, service, v)),
    streamVerdict(world, service, stateful),
    planVerdict(world, service, stateful),
  ]);
}

/** Whether a database a plan copies is served from the other site now, so its dead home does not stop the service. */
export function drCovers(world: WorldReader, serviceId: string, dep: Entity): boolean {
  if (dep.kind !== "db_cluster") return false;
  const plan = planOfTarget(world.index, serviceId);
  if (!plan) return false;
  const s = world.stateAs(plan.id, "dr_plan");
  const copied = streams(world.index).some((x) => streamDef(x).target === dep.id);
  const home = siteOf(world.index, dep.id);
  if (!copied || home === undefined) return false;
  return s.drained.includes(home) || (s.phase === "idle" && s.serving !== home);
}

/** Whether the cluster a service stands on is served from the other site now: the plan's copy of it (standby nodes) takes the pods. */
export function drCoversWorkloads(world: WorldReader, serviceId: string): boolean {
  const plan = planOfTarget(world.index, serviceId);
  if (!plan) return false;
  const s = world.stateAs(plan.id, "dr_plan");
  if (s.drained.includes(String(plan.props.primary))) return true;
  return s.phase === "idle" && s.serving !== plan.props.primary;
}

/** The sites a global balancer has drained of an active-active pair: their places do not count against a service. */
export function drainedSites(world: WorldReader): readonly string[] {
  return world.index.ofKind("dr_plan").flatMap((p) => world.stateAs(p.id, "dr_plan").drained);
}
