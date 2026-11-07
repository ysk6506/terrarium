/**
 * The consensus database and the managed multi-AZ database move with time and with the faults on them (REQ-106, ADR-0129).
 * A ring of voting nodes elects a leader ten seconds after the old one is gone, as long as a majority is up; without a
 * majority nothing is elected. A managed database switches availability zones about thirty seconds after it sees the
 * primary's zone gone and stalls writes for a minute, grows its full storage by itself after ten minutes, and a flapping
 * failover switches again and again until an operator pins a zone. Where the system moves by itself the event has the
 * cause `cluster`, so scoring can tell it from the agent's work.
 */
import {
  AZ_DETECT_S,
  AZ_STALL_S,
  azNames,
  ELECTION_S,
  type Entity,
  EXTEND_DELAY_S,
  FLAP_PERIOD_S,
  majority,
  ringDown,
  ringOf,
  type World,
  type WorldEvent,
} from "@terrarium/core/world";
import { hostGone } from "./app-calls";
import { CLUSTER_CAUSE } from "./db";

const note = (world: World, events: WorldEvent[], text: string, cause = CLUSTER_CAUSE): void => {
  events.push(world.apply({ type: "note", text }, cause));
};

const fault = (world: World, id: string, type: string) =>
  world.faultsOn(id).find((f) => f.type === type);

// ── the ring ───────────────────────────────────────────────────────────────────────────────

/** Why a node is down, when it is: its host is gone, its process died, or a partition holds it. */
function downWhy(world: World, node: Entity, quorumHeld: ReadonlySet<string>): string | undefined {
  const host = world.index.outgoing(node.id, "hosted_on")[0]?.to;
  if (host && hostGone(world, host)) return "올라간 호스트가 멈췄어요";
  if (fault(world, node.id, "db_leader_lost")) return "리더 프로세스가 멈췄어요";
  if (quorumHeld.has(node.id) && !world.stateAs(node.id, "db_node").revived)
    return "네트워크 분할로 다른 노드에 닿지 않아요";
  return undefined;
}

function updateNode(world: World, node: Entity, quorumHeld: ReadonlySet<string>): void {
  const s = world.stateAs(node.id, "db_node");
  if (!quorumHeld.has(node.id)) s.revived = false;
  const why = downWhy(world, node, quorumHeld);
  const lag = fault(world, node.id, "db_node_lagging");
  delete s.why;
  if (why) {
    s.status = "down";
    s.why = why;
    s.role = "follower";
    s.lagS = 0;
  } else if (lag) {
    s.status = "lagging";
    s.lagS = lag.params.lagS ?? 120;
    s.why = `로그를 ${Math.round(s.lagS)}초 따라가지 못해요`;
  } else {
    s.status = "ok";
    s.lagS = 0;
  }
}

function elect(world: World, ring: readonly Entity[], events: WorldEvent[]): void {
  const alive = ring.filter((n) => world.stateAs(n.id, "db_node").status !== "down");
  const first = ring[0];
  if (!first) return;
  const lead = alive.some((n) => world.stateAs(n.id, "db_node").role === "leader");
  const mark = world.stateAs(first.id, "db_node");
  if (lead || alive.length < majority(ring.length)) {
    if (lead) delete mark.leaderlessSince;
    else mark.noMajority = true;
    return;
  }
  mark.leaderlessSince ??= world.time();
  if (world.time() - mark.leaderlessSince < ELECTION_S) return;
  const fresh = alive.filter((n) => world.stateAs(n.id, "db_node").status === "ok");
  const winner = (fresh.length > 0 ? fresh : alive)[0] as Entity;
  const term = Math.max(...ring.map((n) => world.stateAs(n.id, "db_node").term)) + 1;
  for (const n of alive) {
    const st = world.stateAs(n.id, "db_node");
    st.role = n.id === winner.id ? "leader" : "follower";
    st.term = term;
  }
  delete mark.leaderlessSince;
  // an election that only a restart made possible (the majority had been lost) is the agent's doing, not the cluster's
  const cause = mark.noMajority ? "physics" : CLUSTER_CAUSE;
  delete mark.noMajority;
  note(world, events, `${winner.name}가 새 리더로 뽑혔어요(임기 ${term})`, cause);
}

function updateRing(world: World, ring: readonly Entity[], events: WorldEvent[]): void {
  const held = new Set(
    world
      .faults()
      .filter((f) => f.type === "db_quorum_lost")
      .flatMap((f) => ringDown(world, f)),
  );
  for (const n of ring) updateNode(world, n, held);
  elect(world, ring, events);
}

// ── the managed database ───────────────────────────────────────────────────────────────────

function switchZone(world: World, db: Entity, to: number, events: WorldEvent[], why: string): void {
  const s = world.stateAs(db.id, "db_managed");
  s.activeAz = to;
  s.stallUntil = world.time() + AZ_STALL_S;
  s.failovers += 1;
  s.lastSwitchAt = world.time();
  delete s.azDownSince;
  note(
    world,
    events,
    `${db.name}: ${why} — ${azNames(db)[to]}로 넘어가요(쓰기가 ${AZ_STALL_S}초쯤 멈춰요)`,
  );
}

function stepZones(world: World, db: Entity, events: WorldEvent[]): void {
  const s = world.stateAs(db.id, "db_managed");
  const names = azNames(db);
  const t = world.time();
  const down = fault(world, db.id, "db_az_failure");
  const downAz = down ? (down.params.az ?? 1) - 1 : -1;
  const next = names.map((_, i) => i).find((i) => i !== s.activeAz && i !== downAz);
  if (downAz === s.activeAz) {
    s.azDownSince ??= t;
    if (t - s.azDownSince >= AZ_DETECT_S && next !== undefined)
      switchZone(world, db, next, events, `${names[downAz]}이 멈춰서`);
  } else delete s.azDownSince;
  const flap = fault(world, db.id, "db_failover_flapping");
  if (
    flap &&
    !s.pinned &&
    next !== undefined &&
    t - (s.lastSwitchAt ?? flap.since) >= FLAP_PERIOD_S
  )
    switchZone(world, db, next, events, "헬스 체크가 오락가락해서");
}

function stepStorage(world: World, db: Entity, events: WorldEvent[]): void {
  const s = world.stateAs(db.id, "db_managed");
  const full = fault(world, db.id, "db_storage_full");
  if (!full) {
    delete s.fullSince;
    return;
  }
  s.storageUsedPct = 100;
  s.fullSince ??= world.time();
  if (world.time() - s.fullSince >= EXTEND_DELAY_S) {
    events.push(world.apply({ type: "fault.remove", faultId: full.id }, CLUSTER_CAUSE));
    s.storageUsedPct = 55;
    delete s.fullSince;
    note(world, events, `${db.name}: 저장소가 가득 차서 자동으로 늘렸어요`);
  }
}

function updateManaged(world: World, db: Entity, events: WorldEvent[]): void {
  const s = world.stateAs(db.id, "db_managed");
  stepZones(world, db, events);
  stepStorage(world, db, events);
  const names = azNames(db);
  const down = fault(world, db.id, "db_az_failure");
  const alive = names.length - (down ? 1 : 0);
  const t = world.time();
  delete s.why;
  if (s.stallUntil !== undefined && t >= s.stallUntil) delete s.stallUntil;
  if (alive === 0) {
    s.status = "down";
    s.why = "쓸 수 있는 가용 영역이 없어요";
  } else if (s.stallUntil !== undefined) {
    s.status = "degraded";
    s.why = `영역을 바꾸는 중이라 쓰기가 ${Math.round(s.stallUntil - t)}초 더 멈춰요`;
  } else if (s.fullSince !== undefined) {
    s.status = "degraded";
    s.why = "저장소가 가득 차 쓰기가 실패해요(자동 확장을 기다리는 중)";
  } else s.status = "ok";
}

/** Step every ring and every managed database of the world. */
export function updateDbx(world: World): WorldEvent[] {
  const events: WorldEvent[] = [];
  const idx = world.index;
  if (idx.ofKind("db_node").length === 0 && idx.ofKind("db_managed").length === 0) return events;
  for (const svc of [...idx.ofKind("service")].sort((a, b) => a.id.localeCompare(b.id))) {
    const ring = ringOf(idx, svc.id);
    if (ring.length > 0) updateRing(world, ring, events);
  }
  for (const db of [...idx.ofKind("db_managed")].sort((a, b) => a.id.localeCompare(b.id)))
    updateManaged(world, db, events);
  return events;
}
