/**
 * The alarm monitoring raises when a configuration change has cut a server off the network (REQ-064,
 * ADR-0061): `host_unreachable` on the server, saying where the ping stopped. Servers
 * cut off by a cable or by a switch without power are not named here; the link and power alarms are theirs.
 * A BGP session that somebody shut raises `bgp_session_down` on the switch that shut it (REQ-065, ADR-0062);
 * a session that is down because of a cable or a power loss is told by those alarms. A GPU server that has
 * lost a rail (REQ-067, ADR-0064) raises `gpu_rail_degraded` whatever the cause, since the link and power
 * alarms say what failed, not that a training job now runs slower.
 */
import {
  type CutOff,
  cutOffHosts,
  netModelOf,
  railLosses,
  type World,
} from "@terrarium/core/world";
import type { Draft } from "./alarm-scan";

function where(world: World, id: string): string {
  return world.index.find(id)?.name ?? id;
}

/** Why the ping failed, in words a network engineer would use. */
function reason(world: World, c: CutOff): string {
  const at = where(world, c.problem.at);
  const back = c.problem.stage === "reply";
  switch (c.problem.failure) {
    case "no-gateway":
      return "서버가 있는 VLAN에서 게이트웨이(VLAN 인터페이스)가 응답하지 않아요";
    case "no-route":
      return back ? `${at}에 돌아오는 경로가 없어요` : `${at}에 서버 쪽으로 가는 경로가 없어요`;
    case "host-unreachable":
      return `${at}에서 서버가 보이지 않아요 (포트의 VLAN, 트렁크 확인)`;
    default:
      return `${at} 부근에서 경로가 맴돌아요`;
  }
}

/** One alarm per switch that has BGP sessions a person shut, naming each neighbor. */
function bgpAlarms(world: World, out: Draft[]): void {
  const model = netModelOf(world);
  for (const [sw, bgp] of model.plan.bgp) {
    if (!model.isAlive(sw)) continue;
    const shut = bgp.neighbors.filter((n) => model.sessionState(sw, n.ip) === "shutdown");
    if (shut.length === 0) continue;
    const list = shut.map((n) => `${where(world, n.peer)}(${n.ip}, AS ${n.remoteAs})`).join(", ");
    out.push({
      entityId: sw,
      code: "bgp_session_down",
      severity: "warning",
      message: `${where(world, sw)}: BGP 세션 ${shut.length}개가 shutdown 상태예요 — ${list}`,
    });
  }
}

/**
 * One alarm per GPU server that has lost a rail: it still talks through the others, but a collective
 * operation runs at the pace of its slowest NIC, so the whole job slows down. All rails gone is critical.
 * An alarm keeps the message it was raised with, so the lost rails are part of the code
 * (`gpu_rail_degraded.2-7`): when a third rail goes, the alarm is replaced by one that names all three.
 */
function railAlarms(world: World, out: Draft[]): void {
  for (const l of railLosses(world)) {
    const none = l.down.length === l.total;
    out.push({
      entityId: l.id,
      code: `gpu_rail_degraded.${l.down.join("-")}`,
      severity: none ? "critical" : "warning",
      message: `${l.name}: GPU 레일 ${l.down.join(", ")}번이 끊겼어요 (${l.total}개 중 ${l.down.length}개) — ${
        none ? "이 서버는 클러스터와 통신할 수 없어요" : "분산 학습이 느려져요"
      }`,
    });
  }
}

/** One alarm per server that the configuration has cut off; nothing while nobody changed a switch. */
export function netAlarms(world: World, out: Draft[]): void {
  bgpAlarms(world, out);
  railAlarms(world, out);
  for (const c of cutOffHosts(world)) {
    out.push({
      entityId: c.host.id,
      code: "host_unreachable",
      severity: "critical",
      message: `${c.host.name} 통신 불가: ${reason(world, c)}`,
    });
  }
}
