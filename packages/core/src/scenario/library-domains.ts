/**
 * Faults whose cause is outside the domains the agent looks after (REQ-093, ADR-0098 item 6, ADR-0100): a service
 * stops, and the reason is a part in a machine or a port on a switch. Two sheets, both scored recovery first:
 *
 *   domain-memory-vendor   서버 메모리 불량     → 서비스가 멈춰요 → 서버 팀에 넘겨요 → 벤더가 교체해요(보통 1일)
 *                          → 그동안 VM을 다른 서버로 옮겨 서비스를 살리고, 끝나면 되돌려요
 *   domain-port-network    스위치 포트 불량     → 서비스가 멈춰요 → 네트워크 팀에 넘겨요 (보통 3시간)
 *                          → 그동안 서비스를 대기 쪽으로 옮겨 살려요
 *
 * The recommended domains of the experiment are service/OS and virtualization; the cause is in another one. The score
 * is the same recovery-first score: waiting for the team without a temporary measure leaves the services stopped for
 * the whole wait and earns nothing for time. What the agent did with the wait is read from the run's events.
 */
import { withJosa } from "@terrarium/core/kernel";
import type { BlueprintIndex, Domain, Entity, FaultType, Link } from "@terrarium/core/world";
import { agent, doc, Flow, type ScenarioTemplate } from "./library-kit";
import type { Expectation } from "./model";

/** 4 days: a part from the vendor can take 3. */
const TIME_S = 4 * 86_400;
const BUDGET = 150;
const OWN: readonly Domain[] = ["service_os", "virtualization"];

interface Case {
  readonly service: Entity;
  /** The server the service runs on (itself, or the one under its VM). */
  readonly server: Entity;
  readonly vm?: Entity;
  /** Whether the service has a standby to be moved to. */
  readonly standby: boolean;
  /** The cable from that server to a switch, for the port case. */
  readonly cable?: Link;
}

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);

const activeHost = (index: BlueprintIndex, service: Entity): Entity | undefined => {
  const link = index.outgoing(service.id, "service_on").find((l) => l.props.role === "active");
  return link ? index.find(link.to) : undefined;
};

const hasStandby = (index: BlueprintIndex, service: Entity): boolean =>
  index.outgoing(service.id, "service_on").some((l) => l.props.role === "standby");

/** The server under a host (the host itself, or the machine a VM runs on). */
function serverUnder(index: BlueprintIndex, host: Entity): Entity | undefined {
  const id = host.kind === "vm" ? index.outgoing(host.id, "runs_on")[0]?.to : host.id;
  const server = id ? index.find(id) : undefined;
  return server?.kind === "server" ? server : undefined;
}

/** The services of the world with the machine they stand on, by id. */
function cases(index: BlueprintIndex, needVm: boolean, needStandby: boolean): Case[] {
  return [...index.ofKind("service")].sort(byId).flatMap((service): Case[] => {
    const host = activeHost(index, service);
    const vm = host?.kind === "vm" ? host : undefined;
    const server = host ? serverUnder(index, host) : undefined;
    if (!server || (needStandby && !hasStandby(index, service)) || (needVm && !vm)) return [];
    const cable = index
      .outgoing(server.id, "network")
      .find((l) => index.find(l.to)?.kind === "switch");
    return [
      {
        service,
        server,
        standby: hasStandby(index, service),
        ...(vm ? { vm } : {}),
        ...(cable ? { cable } : {}),
      },
    ];
  });
}

const otherServer = (index: BlueprintIndex, server: Entity): boolean =>
  index.ofKind("server").some((s) => s.id !== server.id);

/** For the memory sheet: a service on a VM first (the VM can move), else one with a standby (the service can). */
function memoryCase(index: BlueprintIndex): Case | undefined {
  const all = cases(index, false, false).filter((c) => c.vm || c.standby);
  return all.find((c) => c.vm) ?? all[0];
}

function sheet(c: Case, fault: FaultType, roots: readonly string[], what: string): Expectation[] {
  return [
    {
      id: "diagnosis",
      kind: "diagnosis",
      label: `${withJosa(what, "을")} 원인으로 짚어요`,
      rootCause: [...roots],
      faultType: [fault],
      weight: 30,
    },
    {
      id: "recovered",
      kind: "final_state",
      label: `${c.service.name}가 끝났을 때 정상이에요`,
      condition: {
        kind: "state",
        entity: c.service.id,
        field: "status",
        op: "==",
        value: "healthy",
      },
      weight: 25,
    },
  ];
}

const memory: ScenarioTemplate = {
  id: "domain-memory-vendor",
  name: "서버 메모리 불량 — 서버 팀과 벤더에 넘겨요",
  summary:
    "서비스가 멈췄는데 원인은 서버의 메모리 불량이에요. 내 도메인 밖이라 서버 팀에 넘기면 벤더가 바꾸러 오는데 보통 하루가 걸려요. 그동안 VM을 다른 서버로 옮겨 서비스를 살리고, 교체가 끝나면 되돌려요.",
  difficulty: "어려움",
  faultTypes: ["memory_failure"],
  scoring: "recovery",
  ownDomains: OWN,
  causeDomain: "server",
  unavailable(index) {
    const c = memoryCase(index);
    return c && otherServer(index, c.server)
      ? undefined
      : "서버 두 대 이상과, 그 위 VM에서 돌거나 대기 쪽이 있는 서비스가 이 세계에 있어야 해요";
  },
  build(index, worldId) {
    const c = memoryCase(index) as Case;
    const flow = new Flow();
    const start = flow.add("start", "start", {});
    const fault = flow.add(
      "fault",
      "inject_fault",
      { faultType: "memory_failure", target: c.server.id, faultParams: {}, durationSeconds: 0 },
      start,
    );
    const wait = flow.add("wait", "wait", { seconds: 180 }, fault);
    flow.add(
      "agent",
      "agent_task",
      agent(
        `${c.service.name}가 멈췄다는 알람이 올라왔다. 우리 팀이 맡은 도메인은 서비스/OS와 가상화다. 원인을 찾고, 내 도메인에서 할 수 있는 일을 하고, 나머지는 맡은 팀에 넘겨라. 근본 원인을 찾아 submit_diagnosis로 진단을 제출하라.`,
        BUDGET,
        TIME_S,
      ),
      wait,
    );
    return doc(
      this,
      worldId,
      `${c.server.name}의 메모리가 불량이에요. ${c.service.name}가 ${c.vm ? `도는 ${c.vm.name}이 그 서버 위에 있어요` : "그 서버에서 돌아요"}.`,
      flow,
      sheet(c, "memory_failure", [c.server.id], "메모리가 불량한 서버"),
    );
  },
};

const port: ScenarioTemplate = {
  id: "domain-port-network",
  name: "스위치 포트 불량 — 네트워크 팀에 넘겨요",
  summary:
    "서비스가 멈췄는데 원인은 서버와 스위치를 잇는 포트 불량이에요. 네트워크 팀에 넘기면 보통 3시간이 걸려요. 그동안 서비스를 대기 쪽으로 옮겨 살려요.",
  difficulty: "보통",
  faultTypes: ["link_down"],
  scoring: "recovery",
  ownDomains: OWN,
  causeDomain: "network",
  unavailable(index) {
    return cases(index, false, true).some((c) => c.cable)
      ? undefined
      : "스위치에 이어진 서버에서 도는, 대기 쪽이 있는 서비스가 이 세계에 있어야 해요";
  },
  build(index, worldId) {
    const c = cases(index, false, true).find((x) => x.cable) as Case;
    const cable = c.cable as Link;
    const sw = cable.to;
    const flow = new Flow();
    const start = flow.add("start", "start", {});
    const fault = flow.add(
      "fault",
      "inject_fault",
      { faultType: "link_down", target: cable.id, faultParams: {}, durationSeconds: 0 },
      start,
    );
    const wait = flow.add("wait", "wait", { seconds: 180 }, fault);
    flow.add(
      "agent",
      "agent_task",
      agent(
        `${c.service.name}에 연결이 안 된다는 알람이 올라왔다. 우리 팀이 맡은 도메인은 서비스/OS와 가상화다. 원인을 찾고, 내 도메인에서 할 수 있는 일을 하고, 나머지는 맡은 팀에 넘겨라. 근본 원인을 찾아 submit_diagnosis로 진단을 제출하라.`,
        BUDGET,
        TIME_S,
      ),
      wait,
    );
    return doc(
      this,
      worldId,
      `${index.entity(sw).name}의 ${c.server.name}으로 가는 포트가 불량이에요. ${c.service.name}가 그 서버에서 돌아요.`,
      flow,
      sheet(c, "link_down", [sw, cable.id, c.server.id], "불량한 포트의 스위치"),
    );
  },
};

export const DOMAIN_TEMPLATES: readonly ScenarioTemplate[] = [memory, port];
