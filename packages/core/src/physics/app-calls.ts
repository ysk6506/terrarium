/**
 * The parts of the application layer that watch calls and carry config (REQ-100, ADR-0121): circuit breakers that open
 * after failures and try again, the sidecars next to the replicas, the mesh control plane, the session stores and the
 * regions' own condition. Each is a world fact that physics keeps; the services read it (world/app-health.ts,
 * world/calls-health.ts). Where the system moves by itself the event has the cause `cluster`, so scoring can tell a
 * recovery the system made from one the agent made.
 */
import {
  type BreakerState,
  breakerDef,
  breakerEnds,
  breakers,
  type Entity,
  hostOfApp,
  hostVerdict,
  MESH_REVISION,
  serviceDef,
  serviceHealth,
  type World,
  type WorldEvent,
} from "@terrarium/core/world";
import { CLUSTER_CAUSE } from "./db";

/** A probe service with the default conditions, to ask whether a host is gone without a service in mind. */
const PROBE = serviceDef({ id: "probe", kind: "service", name: "probe", props: {} });

/** A host that cannot carry anything: no power, off, rebooting, cut off, or its system is down. */
export function hostGone(world: World, id: string | undefined): boolean {
  if (id === undefined) return false;
  const v = hostVerdict(world, id, PROBE);
  return v.state === "dead";
}

export const hasFault = (world: World, id: string, type: string): boolean =>
  world.faultsOn(id).some((f) => f.type === type);

function note(world: World, events: WorldEvent[], text: string): void {
  events.push(world.apply({ type: "note", text }, CLUSTER_CAUSE));
}

/**
 * Something coming back after what was wrong is gone. It is not the system's recovery (the oracle credits the cluster only
 * for what it did by itself to end the trouble), so it does not carry the cluster's cause.
 */
function back(world: World, events: WorldEvent[], text: string): void {
  events.push(world.apply({ type: "note", text }, "physics"));
}

// ── session stores, sidecars, mesh ─────────────────────────────────────────────────────────

export function updateStore(world: World, id: string): void {
  const s = world.stateAs(id, "session_store");
  const down =
    hasFault(world, id, "session_store_down") || hostGone(world, hostOfApp(world.index, id));
  s.status = down ? "down" : "ok";
  if (down) s.why = "세션 저장소(redis)가 멈춰 로그인이 풀려요";
  else delete s.why;
}

export function updateMesh(world: World, id: string): void {
  const s = world.stateAs(id, "mesh_control");
  const down =
    hasFault(world, id, "mesh_control_down") || hostGone(world, hostOfApp(world.index, id));
  s.status = down ? "down" : "ok";
  if (down) s.why = "컨트롤 플레인(istiod)이 멈춰 새 설정을 못 밀어요(트래픽은 그대로 흘러요)";
  else delete s.why;
  const storm = hasFault(world, id, "retry_storm");
  s.retries = storm ? "aggressive" : "sane";
  s.previous = MESH_REVISION;
  s.revision = storm ? MESH_REVISION + 1 : MESH_REVISION;
}

export function updateSidecar(world: World, id: string): void {
  const s = world.stateAs(id, "mesh_sidecar");
  const instance = world.index.outgoing(id, "hosted_on")[0]?.to;
  const down = hasFault(world, id, "sidecar_crash") || hostGone(world, hostOfApp(world.index, id));
  s.status = down ? "down" : "ok";
  if (down) s.why = "사이드카(envoy)가 죽어 이 인스턴스로 가는 트래픽이 막혀요";
  else delete s.why;
  const control = world.index
    .outgoing(id, "member_of")
    .map((l) => l.to)
    .find((to) => world.index.find(to)?.kind === "mesh_control");
  if (control && !down && world.stateAs(control, "mesh_control").status === "ok")
    s.revision = world.stateAs(control, "mesh_control").revision;
  void instance;
}

// ── regions ────────────────────────────────────────────────────────────────────────────────

export function updateRegion(world: World, region: Entity): void {
  const s = world.stateAs(region.id, "region");
  const down = hasFault(world, region.id, "region_down");
  s.status = down ? "down" : "ok";
  if (down) s.why = "리전이 통째로 멈췄어요";
  else delete s.why;
  const lag = world.faultsOn(region.id).find((f) => f.type === "replication_lag_high");
  s.lagS = lag ? (lag.params.lagS ?? 180) : 0.5;
}

// ── breakers ───────────────────────────────────────────────────────────────────────────────

/** Whether the service a breaker's call goes to is stopped. */
function calleeFailing(world: World, breaker: Entity): boolean {
  const ends = breakerEnds(world.index, breaker);
  if (!ends || world.index.find(ends.to)?.kind !== "service") return false;
  return serviceHealth(world, ends.to).status === "down";
}

function closedStep(
  world: World,
  breaker: Entity,
  s: BreakerState,
  failing: boolean,
  events: WorldEvent[],
): void {
  const def = breakerDef(breaker);
  const t = world.time();
  if (!failing) {
    delete s.failingSince;
    return;
  }
  s.failingSince ??= t;
  if (t - s.failingSince < def.failures) return;
  s.mode = "open";
  s.openedAt = t;
  s.trips += 1;
  delete s.failingSince;
  note(world, events, `${breaker.name}: 실패가 ${def.failures}번 이어져 열렸어요`);
}

function halfOpenStep(
  world: World,
  breaker: Entity,
  s: BreakerState,
  failing: boolean,
  events: WorldEvent[],
): void {
  if (failing) {
    s.mode = "open";
    s.openedAt = world.time();
    return;
  }
  s.mode = "closed";
  delete s.openedAt;
  back(world, events, `${breaker.name}: 상대가 돌아와 닫혔어요`);
}

export function updateBreaker(world: World, breaker: Entity, events: WorldEvent[]): void {
  const s = world.stateAs(breaker.id, "circuit_breaker");
  const def = breakerDef(breaker);
  const t = world.time();
  const stuck = hasFault(world, breaker.id, "circuit_breaker_stuck_open");
  s.stuck = stuck;
  const failing = calleeFailing(world, breaker);
  if (stuck && s.mode !== "open") {
    s.mode = "open";
    s.openedAt = t;
    s.trips += 1;
  }
  if (s.mode === "closed") closedStep(world, breaker, s, failing, events);
  else if (s.mode === "open") {
    if (!stuck && t - (s.openedAt ?? t) >= def.resetS) {
      s.mode = "half-open";
      note(world, events, `${breaker.name}: ${def.resetS}초가 지나 반열림으로 한 번 시험해요`);
    }
  } else if (!stuck) halfOpenStep(world, breaker, s, failing, events);
  if (s.mode === "closed") delete s.why;
  else s.why = stuck ? "열린 채 굳었어요" : failing ? "상대가 멈춰 있어요" : "시험 호출 전이에요";
}

export function updateBreakers(world: World, events: WorldEvent[]): void {
  for (const b of breakers(world.index)) updateBreaker(world, b, events);
}
