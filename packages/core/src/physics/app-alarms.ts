/**
 * The alarms of the application layer (REQ-100): a balancer that is down or sends traffic to a dead or flapping backend, a
 * breaker that is open, a session store, a sidecar or the mesh control plane that is down, a region that is gone or whose
 * copy of the data trails. They sit on the entity they are about, so a diagnosis can name it and the topology can colour it.
 */
import type { World } from "@terrarium/core/world";
import type { Draft } from "./alarm-scan";

function balancerAlarms(world: World, out: Draft[]): void {
  for (const e of world.index.ofKind("load_balancer")) {
    const s = world.stateAs(e.id, "load_balancer");
    if (s.status !== "ok")
      out.push({
        entityId: e.id,
        code: s.status === "down" ? "lb_down" : "lb_degraded",
        severity: s.status === "down" ? "critical" : "warning",
        message: `${e.name}${s.why ? ` — ${s.why}` : " 상태가 좋지 않아요"}`,
      });
  }
}

function callAlarms(world: World, out: Draft[]): void {
  for (const e of world.index.ofKind("circuit_breaker")) {
    const s = world.stateAs(e.id, "circuit_breaker");
    if (s.mode !== "closed")
      out.push({
        entityId: e.id,
        code: "breaker_open",
        severity: "warning",
        message: `${e.name} 서킷 브레이커가 ${s.mode === "open" ? "열려" : "반열려"} 있어요${s.why ? ` — ${s.why}` : ""}`,
      });
  }
  for (const e of world.index.ofKind("mesh_control")) {
    const s = world.stateAs(e.id, "mesh_control");
    if (s.status === "down")
      out.push({
        entityId: e.id,
        code: "mesh_control_down",
        severity: "warning",
        message: `${e.name}가 멈췄어요 — 새 설정을 못 밀어요(트래픽은 그대로예요)`,
      });
    if (s.retries === "aggressive")
      out.push({
        entityId: e.id,
        code: "mesh_retry_storm",
        severity: "critical",
        message: `${e.name}의 재시도 설정이 잘못돼 호출이 몇 배로 불어났어요`,
      });
  }
}

function edgeAlarms(world: World, out: Draft[]): void {
  for (const e of world.index.ofKind("session_store")) {
    if (world.stateAs(e.id, "session_store").status === "down")
      out.push({
        entityId: e.id,
        code: "session_store_down",
        severity: "critical",
        message: `${e.name}가 멈춰 로그인이 풀려요`,
      });
  }
  for (const e of world.index.ofKind("mesh_sidecar")) {
    if (world.stateAs(e.id, "mesh_sidecar").status === "down")
      out.push({
        entityId: e.id,
        code: "sidecar_down",
        severity: "critical",
        message: `${e.name}가 죽어 그 인스턴스로 가는 트래픽이 막혀요`,
      });
  }
  for (const e of world.index.ofKind("region")) {
    const s = world.stateAs(e.id, "region");
    if (s.status === "down")
      out.push({
        entityId: e.id,
        code: "region_down",
        severity: "critical",
        message: `${e.name}이 멈췄어요`,
      });
    else if (s.lagS > 30)
      out.push({
        entityId: e.id,
        code: "replication_lag",
        severity: "warning",
        message: `${e.name}의 복제가 ${Math.round(s.lagS)}초 밀렸어요`,
      });
  }
}

/** The alarms of every balancer, breaker, store, sidecar, mesh control plane and region. */
export function appAlarms(world: World, out: Draft[]): void {
  balancerAlarms(world, out);
  callAlarms(world, out);
  edgeAlarms(world, out);
}
