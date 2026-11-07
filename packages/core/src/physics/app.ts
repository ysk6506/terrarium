/**
 * The application layer moves with time and with the faults on it (REQ-100, ADR-0121): a load balancer takes a backend out
 * after 3 failed health checks and puts it back after 2 good ones, a circuit breaker opens after a few failures and tries
 * again after its reset time, a global load balancer takes a region out once it has seen it gone for the detection time.
 * Each of these is a world event with the cause `cluster`, so scoring can tell a recovery the system made from one the
 * agent made.
 *
 * Each step: stores, the mesh, sidecars and regions first (what is up), then replicas (what each one answers), then load
 * balancers (who is in the rotation and how the service behind looks), then breakers (they read the services as they are).
 */
import {
  appInstancesOf,
  type Entity,
  hostOfApp,
  hostVerdict,
  LB_FAIL_CHECKS,
  LB_RECOVER_CHECKS,
  loadBalancerDef,
  REGION_RECOVER_S,
  RELOGIN_S,
  regionOf,
  regionsOf,
  STALE_LAG_S,
  serviceDef,
  servicesBehind,
  sidecarOf,
  type World,
  type WorldEvent,
} from "@terrarium/core/world";
import {
  hostGone,
  updateBreakers,
  updateMesh,
  updateRegion,
  updateSidecar,
  updateStore,
} from "./app-calls";
import { CLUSTER_CAUSE } from "./db";

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

// ── replicas ───────────────────────────────────────────────────────────────────────────────

/** Whether a flapping replica answers its health check now. */
function flapUp(world: World, id: string): boolean | undefined {
  const f = world.faultsOn(id).find((x) => x.type === "lb_backend_flapping");
  if (!f) return undefined;
  const period = f.params.periodS ?? 120;
  return (world.time() - f.since) % period < period / 2;
}

function serviceOfInstance(world: World, instance: Entity): Entity | undefined {
  const id = world.index
    .outgoing(instance.id, "member_of")
    .find((l) => world.index.find(l.to)?.kind === "service")?.to;
  return id ? world.index.find(id) : undefined;
}

/** Why a replica is down, when it is (the first cause that applies), else undefined. */
function downWhy(world: World, instance: Entity, flap: boolean | undefined): string | undefined {
  const service = serviceOfInstance(world, instance);
  const host = hostOfApp(world.index, instance.id);
  const region = regionOf(world.index, instance.id);
  const sidecar = sidecarOf(world.index, instance.id);
  const verdict = host && service ? hostVerdict(world, host, serviceDef(service)) : undefined;
  if (region && world.stateAs(region.id, "region").status === "down") return "리전이 멈췄어요";
  if (verdict?.state === "dead" || hostGone(world, host))
    return verdict?.why ?? "올라간 호스트가 멈췄어요";
  if (sidecar && world.stateAs(sidecar.id, "mesh_sidecar").status === "down")
    return "사이드카가 죽어 트래픽이 막혀요";
  if (flap === false) return "헬스 체크가 실패하는 때예요(오르락내리락해요)";
  return undefined;
}

function updateInstance(world: World, instance: Entity): void {
  const s = world.stateAs(instance.id, "app_instance");
  const service = serviceOfInstance(world, instance);
  const host = hostOfApp(world.index, instance.id);
  const verdict = host && service ? hostVerdict(world, host, serviceDef(service)) : undefined;
  const flap = flapUp(world, instance.id);
  s.flapping = flap !== undefined;
  delete s.why;
  const why = downWhy(world, instance, flap);
  if (why) {
    s.status = "down";
    s.why = why;
  } else if (flap === true || verdict?.state === "slow") {
    s.status = "degraded";
    s.why = flap === true ? "헬스 체크가 오르락내리락해요" : verdict?.why;
  } else s.status = "ok";
}

/** The balancer's checks on one replica: out after 3 failures, back after 2 passes; a drained one stays out. */
function rotate(world: World, instance: Entity, intervalS: number, events: WorldEvent[]): void {
  const s = world.stateAs(instance.id, "app_instance");
  const t = world.time();
  if (s.drained) {
    s.inRotation = false;
    return;
  }
  if (s.status === "down") {
    delete s.goodSince;
    s.badSince ??= t;
    if (s.inRotation && t - s.badSince >= LB_FAIL_CHECKS * intervalS) {
      s.inRotation = false;
      note(
        world,
        events,
        `${instance.name}: 헬스 체크가 ${LB_FAIL_CHECKS}번 실패해 로드 밸런서가 로테이션에서 뺐어요`,
      );
    }
    return;
  }
  delete s.badSince;
  s.goodSince ??= t;
  if (!s.inRotation && t - s.goodSince >= LB_RECOVER_CHECKS * intervalS) {
    s.inRotation = true;
    back(
      world,
      events,
      `${instance.name}: 헬스 체크가 ${LB_RECOVER_CHECKS}번 통과해 로드 밸런서가 로테이션에 다시 넣었어요`,
    );
  }
}

// ── load balancers ─────────────────────────────────────────────────────────────────────────

function backendsOf(world: World, lb: Entity): Entity[] {
  return servicesBehind(world.index, lb.id).flatMap((s) => appInstancesOf(world.index, s.id));
}

/** The balancer's verdict on the replicas that get traffic. */
function plainStatus(world: World, backends: readonly Entity[]): { down: boolean; why?: string } {
  const states = backends.map((b) => [b, world.stateAs(b.id, "app_instance")] as const);
  const inRotation = states.filter(([, s]) => s.inRotation);
  if (states.length > 0 && inRotation.length === 0)
    return { down: true, why: "로테이션에 백엔드가 하나도 없어요" };
  const failing = inRotation.filter(([, s]) => s.status === "down");
  if (failing.length > 0)
    return {
      down: false,
      why: `죽은 백엔드 ${failing.length}대(${failing[0]?.[0].name})가 아직 로테이션에 있어 요청 일부가 실패해요`,
    };
  // a flapping backend keeps coming and going until someone drains it, whichever half of its cycle it is in
  const flapping = states.find(([, s]) => s.flapping && !s.drained);
  if (flapping)
    return { down: false, why: `${flapping[0].name}의 헬스 체크가 오르락내리락해 요청이 끊겨요` };
  return { down: false };
}

function setStatus(
  world: World,
  lb: Entity,
  verdict: { down: boolean; why?: string; ok?: boolean },
): void {
  const s = world.stateAs(lb.id, "load_balancer");
  const dead = hostGone(world, hostOfApp(world.index, lb.id));
  delete s.why;
  if (dead) {
    s.status = "down";
    s.why = "로드 밸런서가 올라간 호스트가 멈췄어요";
  } else if (verdict.down) {
    s.status = "down";
    if (verdict.why) s.why = verdict.why;
  } else if (verdict.why) {
    s.status = "degraded";
    s.why = verdict.why;
  } else s.status = "ok";
}

function regionBad(world: World, region: Entity, backends: readonly Entity[]): boolean {
  if (world.stateAs(region.id, "region").status === "down") return true;
  const mine = backends.filter((b) => regionOf(world.index, b.id)?.id === region.id);
  return (
    mine.length > 0 && mine.every((b) => world.stateAs(b.id, "app_instance").status === "down")
  );
}

function moveRegions(
  world: World,
  lb: Entity,
  backends: readonly Entity[],
  events: WorldEvent[],
): void {
  const s = world.stateAs(lb.id, "load_balancer");
  const def = loadBalancerDef(lb);
  const t = world.time();
  const regions = regionsOf(world.index, lb.id);
  if (s.pinned) {
    s.rotation = [s.pinned];
    return;
  }
  for (const r of regions) {
    const inside = s.rotation.includes(r.id);
    if (regionBad(world, r, backends)) {
      delete s.regionGoodSince[r.id];
      s.regionBadSince[r.id] ??= t;
      if (inside && t - (s.regionBadSince[r.id] as number) >= def.detectS) {
        s.rotation = s.rotation.filter((x) => x !== r.id);
        s.reloginUntil = t + RELOGIN_S;
        note(
          world,
          events,
          `${lb.name}: ${r.name}이 ${def.detectS}초 넘게 응답이 없어 글로벌 로드 밸런서가 로테이션에서 뺐어요`,
        );
      }
    } else {
      delete s.regionBadSince[r.id];
      s.regionGoodSince[r.id] ??= t;
      if (!inside && t - (s.regionGoodSince[r.id] as number) >= REGION_RECOVER_S) {
        s.rotation = [...s.rotation, r.id].sort();
        back(
          world,
          events,
          `${lb.name}: ${r.name}이 돌아와 글로벌 로드 밸런서가 로테이션에 다시 넣었어요`,
        );
      }
    }
  }
}

/** The global balancer's verdict: the regions in rotation, their replicas, the sessions and the copies. */
function globalStatus(
  world: World,
  lb: Entity,
  backends: readonly Entity[],
): { down: boolean; why?: string } {
  const s = world.stateAs(lb.id, "load_balancer");
  const regions = regionsOf(world.index, lb.id).filter((r) => s.rotation.includes(r.id));
  if (regions.length === 0) return { down: true, why: "트래픽을 받을 리전이 하나도 없어요" };
  const bad = regions.filter((r) => regionBad(world, r, backends));
  if (bad.length === regions.length)
    return { down: true, why: `트래픽이 멈춘 ${bad[0]?.name}로만 가고 있어요` };
  if (bad.length > 0)
    return {
      down: false,
      why: `${bad[0]?.name}이 멈췄는데 아직 로테이션에 있어 요청 일부가 실패해요`,
    };
  const inside = backends.filter((b) =>
    regions.some((r) => r.id === regionOf(world.index, b.id)?.id),
  );
  const plain = plainStatus(world, inside);
  if (plain.why) return plain;
  if (s.reloginUntil !== undefined && world.time() < s.reloginUntil)
    return { down: false, why: "멈춘 리전의 세션이 사라져 사용자가 다시 로그인하는 중이에요" };
  const stale = regions.find((r) => world.stateAs(r.id, "region").lagS > STALE_LAG_S);
  if (stale)
    return {
      down: false,
      why: `${stale.name}의 복제가 ${Math.round(world.stateAs(stale.id, "region").lagS)}초 밀려 읽기가 옛 값이에요`,
    };
  return { down: false };
}

function updateBalancer(world: World, lb: Entity, events: WorldEvent[]): void {
  const def = loadBalancerDef(lb);
  const backends = backendsOf(world, lb);
  for (const b of backends) rotate(world, b, def.intervalS, events);
  if (def.global) {
    moveRegions(world, lb, backends, events);
    setStatus(world, lb, globalStatus(world, lb, backends));
  } else setStatus(world, lb, plainStatus(world, backends));
  const s = world.stateAs(lb.id, "load_balancer");
  if (s.reloginUntil !== undefined && world.time() >= s.reloginUntil) delete s.reloginUntil;
}

/** Step every store, sidecar, replica, balancer, region and breaker of the world. */
export function updateApp(world: World): WorldEvent[] {
  const events: WorldEvent[] = [];
  const idx = world.index;
  if (
    idx.ofKind("app_instance").length === 0 &&
    idx.ofKind("load_balancer").length === 0 &&
    idx.ofKind("circuit_breaker").length === 0 &&
    idx.ofKind("session_store").length === 0 &&
    idx.ofKind("mesh_control").length === 0
  )
    return events;
  const byId = (a: Entity, b: Entity): number => a.id.localeCompare(b.id);
  for (const e of [...idx.ofKind("session_store")].sort(byId)) updateStore(world, e.id);
  for (const e of [...idx.ofKind("mesh_control")].sort(byId)) updateMesh(world, e.id);
  for (const e of [...idx.ofKind("mesh_sidecar")].sort(byId)) updateSidecar(world, e.id);
  for (const e of [...idx.ofKind("region")].sort(byId)) updateRegion(world, e);
  for (const e of [...idx.ofKind("app_instance")].sort(byId)) updateInstance(world, e);
  for (const e of [...idx.ofKind("load_balancer")].sort(byId)) updateBalancer(world, e, events);
  updateBreakers(world, events);
  return events;
}
