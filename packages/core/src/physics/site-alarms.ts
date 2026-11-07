/**
 * The alarms of the site and DR layer, the geo volumes and the two new databases (REQ-106): a site without power, a WAN
 * link that is out or slow, a copy that is broken or trails, a plan that is stuck or split, a node of the ring that is down
 * or lagging and a ring without a majority, a managed database that stalls or has lost a zone. They sit on the entity they
 * are about, so a diagnosis can name it and the topology can colour it.
 */
import {
  type DrPlanState,
  drPlans,
  drSites,
  type Entity,
  majority,
  ringOf,
  siteLinks,
  streams,
  volumes,
  type World,
} from "@terrarium/core/world";
import type { Draft } from "./alarm-scan";

interface Graded {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly why: string | undefined;
  /** The alarm code when the thing is down (or broken), and when it is only worse than it should be. */
  readonly codes: readonly [string, string];
  readonly fallback: string;
}

/** One alarm for a thing that is not well: critical when it is down or broken, a warning otherwise. */
function graded(out: Draft[], g: Graded): void {
  if (g.status === "ok") return;
  const bad = g.status === "down" || g.status === "broken";
  out.push({
    entityId: g.id,
    code: bad ? g.codes[0] : g.codes[1],
    severity: bad ? "critical" : "warning",
    message: `${g.name}: ${g.why ?? g.fallback}`,
  });
}

function siteAlarms(world: World, out: Draft[]): void {
  for (const e of drSites(world.index)) {
    const s = world.stateAs(e.id, "dr_site");
    graded(out, {
      id: e.id,
      name: e.name,
      status: s.status,
      why: s.why,
      codes: ["site_down", "site_degraded"],
      fallback: "상태가 좋지 않아요",
    });
  }
  for (const e of siteLinks(world.index)) {
    const s = world.stateAs(e.id, "site_link");
    graded(out, {
      id: e.id,
      name: e.name,
      status: s.status,
      why: s.why,
      codes: ["wan_down", "wan_degraded"],
      fallback: "회선 상태가 좋지 않아요",
    });
  }
  for (const e of streams(world.index)) {
    const s = world.stateAs(e.id, "replication_stream");
    graded(out, {
      id: e.id,
      name: e.name,
      status: s.status,
      why: s.why,
      codes: ["replication_broken", "replication_lag"],
      fallback: "복제가 밀렸어요",
    });
  }
}

function planAlarm(out: Draft[], e: Entity, s: DrPlanState): void {
  const base = { entityId: e.id, severity: "critical" as const, message: `${e.name}: ${s.why}` };
  if (s.split) out.push({ ...base, code: "site_split_brain" });
  else if (s.phase === "stuck") out.push({ ...base, code: "dr_failover_stuck" });
  else if (s.phase !== "idle")
    out.push({
      entityId: e.id,
      code: "dr_moving",
      severity: "warning",
      message: `${e.name}: 서비스를 ${s.toSite ?? "다른 사이트"}로 옮기는 중이에요`,
    });
}

function planAlarms(world: World, out: Draft[]): void {
  for (const e of drPlans(world.index)) planAlarm(out, e, world.stateAs(e.id, "dr_plan"));
  for (const e of volumes(world.index)) {
    const s = world.stateAs(e.id, "volume");
    graded(out, {
      id: e.id,
      name: e.name,
      status: s.status,
      why: s.why,
      codes: ["volume_unavailable", "volume_unavailable"],
      fallback: "볼륨 상태가 좋지 않아요",
    });
  }
}

function ringAlarms(world: World, out: Draft[], svc: Entity): void {
  const ring = ringOf(world.index, svc.id);
  const head = ring[0];
  if (!head) return;
  const up = ring.filter((n) => world.stateAs(n.id, "db_node").status !== "down");
  if (up.length < majority(ring.length))
    out.push({
      entityId: head.id,
      code: "db_quorum_lost",
      severity: "critical",
      message: `${svc.name} 합의 DB: 노드 ${ring.length}개 중 ${up.length}개만 남아 과반이 없어요`,
    });
  for (const n of ring) {
    const s = world.stateAs(n.id, "db_node");
    graded(out, {
      id: n.id,
      name: n.name,
      status: s.status,
      why: s.why,
      codes: ["db_node_down", "db_node_lagging"],
      fallback: "노드 상태가 좋지 않아요",
    });
  }
}

function managedAlarms(world: World, out: Draft[], e: Entity): void {
  const s = world.stateAs(e.id, "db_managed");
  graded(out, {
    id: e.id,
    name: e.name,
    status: s.status,
    why: s.why,
    codes: ["db_managed_down", "db_managed_degraded"],
    fallback: "상태가 좋지 않아요",
  });
  const has = (type: string) => world.faultsOn(e.id).some((f) => f.type === type);
  if (has("db_az_failure"))
    out.push({
      entityId: e.id,
      code: "db_az_down",
      severity: "warning",
      message: `${e.name}: 가용 영역 하나가 멈춰 이중화가 줄었어요`,
    });
  if (!s.pinned && has("db_failover_flapping"))
    out.push({
      entityId: e.id,
      code: "db_failover_flapping",
      severity: "warning",
      message: `${e.name}: 가용 영역 사이를 오락가락 넘어다녀요 (헬스 체크가 흔들려요)`,
    });
}

function dbAlarms(world: World, out: Draft[]): void {
  for (const svc of world.index.ofKind("service")) ringAlarms(world, out, svc);
  for (const e of world.index.ofKind("db_managed")) managedAlarms(world, out, e);
}

/** The alarms of every site, link, stream, plan, volume, ring node and managed database. */
export function siteDrAlarms(world: World, out: Draft[]): void {
  siteAlarms(world, out);
  planAlarms(world, out);
  dbAlarms(world, out);
}
