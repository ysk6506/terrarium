/**
 * How the application layer looks to the service in it (REQ-100, ADR-0121). As everywhere in service health nothing is
 * simulated here: the verdict is read off the state physics keeps (physics/app.ts), so putting the state right (a drained
 * backend, a restarted store, a rolled-back mesh) brings the service back by itself.
 *
 * The rules, for a service:
 *   - its load balancer is down (no backend gets traffic, or its host is gone)   stopped
 *   - the balancer is degraded (a dead backend not yet taken out, a flapping one,   slow
 *     a region that is leaving, stale reads from a lagging region, users logging in again)
 *   - its session store is down                                                    slow (logins drop)
 *   - the mesh sends retries of a bad configuration and the service is called       slow
 * A mesh control plane that is down changes nothing here: the sidecars keep what they have (headless), only new
 * configuration cannot be pushed. A sidecar that is dead makes its instance dead, which the balancer then takes out.
 */

import { callsIn, lbOf, meshControls, sessionStoreOf } from "./app";
import type { Entity } from "./blueprint";
import type { ServiceStatus } from "./service";
import type { WorldReader } from "./world";

export interface AppVerdict {
  readonly status: ServiceStatus;
  readonly reasons: readonly string[];
}

const HEALTHY: AppVerdict = { status: "healthy", reasons: [] };

const RANK: Readonly<Record<ServiceStatus, number>> = { healthy: 0, degraded: 1, down: 2 };

function lbVerdict(world: WorldReader, lb: Entity): AppVerdict {
  const s = world.stateAs(lb.id, "load_balancer");
  if (s.status === "ok") return HEALTHY;
  const why = `${lb.name}: ${s.why ?? "로드 밸런서가 요청을 제대로 나누지 못해요"}`;
  return { status: s.status === "down" ? "down" : "degraded", reasons: [why] };
}

function storeVerdict(world: WorldReader, store: Entity): AppVerdict {
  const s = world.stateAs(store.id, "session_store");
  if (s.status === "ok") return HEALTHY;
  return {
    status: "degraded",
    reasons: [`${store.name}: ${s.why ?? "세션 저장소가 멈춰 로그인이 풀려요"}`],
  };
}

/** A bad mesh configuration multiplies the calls: whoever is called feels it. */
function stormVerdict(world: WorldReader, service: Entity): AppVerdict {
  if (callsIn(world.index, service.id).length === 0) return HEALTHY;
  const bad = meshControls(world.index).find(
    (m) => world.stateAs(m.id, "mesh_control").retries === "aggressive",
  );
  if (!bad) return HEALTHY;
  return {
    status: "degraded",
    reasons: [`${bad.name}: 재시도 설정이 잘못돼 호출이 몇 배로 불어났어요`],
  };
}

/** What the application layer makes of a service: the worst of every rule above. */
export function appHealth(world: WorldReader, service: Entity): AppVerdict {
  const idx = world.index;
  if (
    idx.ofKind("load_balancer").length === 0 &&
    idx.ofKind("session_store").length === 0 &&
    idx.ofKind("mesh_control").length === 0
  )
    return HEALTHY;
  const lb = lbOf(idx, service.id);
  const store = sessionStoreOf(idx, service.id);
  const parts = [
    ...(lb ? [lbVerdict(world, lb)] : []),
    ...(store ? [storeVerdict(world, store)] : []),
    stormVerdict(world, service),
  ];
  let status: ServiceStatus = "healthy";
  const reasons: string[] = [];
  for (const v of parts) {
    if (RANK[v.status] > RANK[status]) status = v.status;
    reasons.push(...v.reasons);
  }
  return { status, reasons };
}
