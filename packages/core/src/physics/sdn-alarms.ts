/**
 * The alarms of the overlay and the cloud-native network (REQ-097): a controller that is down, a VTEP with a session that is
 * down or a configuration that is behind, a segment that is cut, an ingress that is shut, a plug-in that died, a function that
 * is overloaded, a policy that denies. They sit on the entity they are about, so a diagnosis can name it and the topology
 * can colour it.
 */
import type { World } from "@terrarium/core/world";
import type { Draft } from "./alarm-scan";

function controllerAlarms(world: World, out: Draft[]): void {
  for (const e of world.index.ofKind("sdn_controller")) {
    const s = world.stateAs(e.id, "sdn_controller");
    if (s.status === "down")
      out.push({
        entityId: e.id,
        code: "sdn_controller_down",
        severity: s.role === "active" ? "critical" : "warning",
        message: `${e.name} SDN 컨트롤러가 멈췄어요${s.why ? ` — ${s.why}` : ""}`,
      });
  }
}

function vtepAlarms(world: World, out: Draft[]): void {
  for (const e of world.index.ofKind("vtep")) {
    const s = world.stateAs(e.id, "vtep");
    if (s.evpn === "down")
      out.push({
        entityId: e.id,
        code: "evpn_session_down",
        severity: "warning",
        message: `${e.name}의 EVPN 세션이 내려가 있어요${s.flaps > 0 ? ` (플랩 ${s.flaps}번)` : ""}`,
      });
    if (s.cut && s.evpn !== "down")
      out.push({
        entityId: e.id,
        code: "vtep_cut_off",
        severity: "warning",
        message: `${e.name}: ${s.why ?? "세그먼트에서 끊겼어요"}`,
      });
  }
}

function segmentAlarms(world: World, out: Draft[]): void {
  for (const e of world.index.ofKind("overlay_segment")) {
    const s = world.stateAs(e.id, "overlay_segment");
    if (s.status !== "ok")
      out.push({
        entityId: e.id,
        code: s.status === "down" ? "overlay_segment_down" : "overlay_segment_degraded",
        severity: s.status === "down" ? "critical" : "warning",
        message: `${e.name} ${s.status === "down" ? "끊겼어요" : "일부가 끊겼어요"}${s.why ? ` — ${s.why}` : ""}`,
      });
  }
}

function edgeAlarms(world: World, out: Draft[]): void {
  for (const e of world.index.ofKind("ingress")) {
    const s = world.stateAs(e.id, "ingress");
    if (s.status === "down")
      out.push({
        entityId: e.id,
        code: "ingress_down",
        severity: "critical",
        message: `${e.name} 인그레스가 닫혔어요`,
      });
  }
  for (const e of world.index.ofKind("cni")) {
    if (world.stateAs(e.id, "cni").status === "down")
      out.push({
        entityId: e.id,
        code: "cni_down",
        severity: "critical",
        message: `${e.name} CNI 플러그인이 죽었어요`,
      });
  }
  for (const e of world.index.ofKind("nfv_function")) {
    const s = world.stateAs(e.id, "nfv_function");
    if (s.status !== "ok")
      out.push({
        entityId: e.id,
        code: "nfv_overloaded",
        severity: "warning",
        message: `${e.name}${s.why ? ` — ${s.why}` : " 과부하"}`,
      });
  }
  for (const e of world.index.ofKind("network_policy")) {
    if (world.stateAs(e.id, "network_policy").rule === "deny")
      out.push({
        entityId: e.id,
        code: "network_policy_blocking",
        severity: "warning",
        message: `${e.name} 정책이 서비스 사이의 호출을 막고 있어요`,
      });
  }
}

/** The alarms of every controller, VTEP, segment, door, plug-in, function and policy. */
export function sdnAlarms(world: World, out: Draft[]): void {
  controllerAlarms(world, out);
  vtepAlarms(world, out);
  segmentAlarms(world, out);
  edgeAlarms(world, out);
}
