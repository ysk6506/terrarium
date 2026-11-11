/**
 * Faults of the SDN overlay and the cloud-native network, seen as a service that stops or slows (REQ-097, ADR-0107 item 6):
 * six sheets, each a service in trouble because of one thing in the overlay or on the pod network. They are scored recovery
 * first (REQ-088): the points go to the services being well again soon, to acting before finding out everything, to doing no
 * harm on the way, and to saying what broke. Where the system heals itself (a standby controller that takes over), an agent
 * that watches and reports earns the report and nothing else; where only the network team can fix it, the agent hands it over
 * and keeps the service going meanwhile.
 *
 *   sdn-controller-down    컨트롤러가 멈췄어요          → 스탠바이가 있으면 지켜보고 보고해요, 하나뿐이면 네트워크 팀에 넘겨요
 *   sdn-sync-failed        스위치 한 대에 옛 설정이 남았어요 → 그 스위치를 다시 동기화해요
 *   sdn-tunnel-down        VXLAN 터널이 끊겼어요         → underlay 경로를 따라 막힌 스위치 포트를 찾고 네트워크 팀에 넘겨요
 *   netpolicy-wrong-deploy 네트워크 정책을 잘못 배포했어요 → 정책을 되돌려요
 *   ingress-down           인그레스가 닫혔어요           → 인그레스를 다시 시작해요
 *   cni-plugin-failure     노드의 CNI 플러그인이 죽었어요 → 그 노드에서 플러그인을 다시 시작해요
 */
import type { BlueprintIndex, Domain, Entity, FaultType, MistakeType } from "@terrarium/core/world";
import {
  sdnControllers,
  segmentsOfVtep,
  servicesLeaningOn,
  vtepsOfSegment,
} from "@terrarium/core/world";
import { agent, allOf, doc, Flow, type ScenarioTemplate, SUBMIT } from "./library-kit";
import type { ActionKind, Condition, Expectation } from "./model";

/** What a sheet is about: the thing the fault is put on, the services that feel it, and the answer the diagnosis names. */
interface Case {
  readonly target: Entity;
  /** Other things a diagnosis may name as the cause (the switch under a VTEP). */
  readonly roots: readonly string[];
  readonly services: readonly Entity[];
  /** The world has a standby controller (so the system heals itself). */
  readonly ha: boolean;
  readonly where: string;
  /** A VTEP that goes stale along with it (the controller died in the middle of a push). */
  readonly side?: Entity;
}

interface Plan {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly difficulty: "쉬움" | "보통" | "어려움";
  /** The fault, or the mistake made with a configuration block. */
  readonly fault?: FaultType;
  readonly mistake?: MistakeType;
  /** A second fault that comes with it (put in before the main one). */
  readonly also?: (c: Case) => { readonly fault: FaultType; readonly target: string } | undefined;
  readonly ownDomains: readonly Domain[];
  readonly causeDomain: Domain;
  readonly find: (index: BlueprintIndex) => Case | string;
  readonly report: (service: Entity) => string;
  readonly waitS: (c: Case) => number;
  readonly forbid: (c: Case) => ReadonlyArray<{ action: ActionKind; penalty: number }>;
  readonly timeLimitS: (c: Case) => number;
  readonly budget: number;
  /** Seconds the sheet expects a recovery to take when only the team it is handed to can bring it (ADR-0133). */
  readonly expectedS?: number;
}

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
const KIND_ORDER = ["stateful", "batch", "request"];
const kindRank = (e: Entity) => KIND_ORDER.indexOf(String(e.props.serviceKind));

/** A VTEP that carries the segment the service stands on. */
function vtepOfService(index: BlueprintIndex, service: Entity): Entity | undefined {
  const segment = index
    .outgoing(service.id, "depends_on")
    .map((l) => index.find(l.to))
    .find((e) => e?.kind === "overlay_segment");
  return segment ? vtepsOfSegment(index, segment.id)[0] : undefined;
}

const sorted = (list: readonly Entity[]) =>
  [...list].sort((a, b) => kindRank(a) - kindRank(b) || byId(a, b));

/** The services that lean on a segment of the VTEP, stateful ones first. */
function servicesBehind(index: BlueprintIndex, vtep: Entity): Entity[] {
  const set = new Map<string, Entity>();
  for (const seg of segmentsOfVtep(index, vtep.id))
    for (const s of servicesLeaningOn(index, seg.id)) set.set(s.id, s);
  return sorted([...set.values()]);
}

function vtepCase(index: BlueprintIndex, lacks: string): Case | string {
  for (const service of sorted(index.ofKind("service"))) {
    const vtep = vtepOfService(index, service);
    const behind = vtep ? servicesBehind(index, vtep) : [];
    if (!vtep || behind.length === 0) continue;
    const sw = index.outgoing(vtep.id, "hosted_on")[0]?.to as string;
    return {
      target: vtep,
      roots: [vtep.id, sw],
      services: behind,
      ha: sdnControllers(index).length > 1,
      where: `${index.entity(sw).name}의 VTEP`,
    };
  }
  return lacks;
}

const controllerCase = (index: BlueprintIndex): Case | string => {
  const list = sdnControllers(index);
  const active = list.find((c) => c.props.role !== "standby");
  const vtep = vtepCase(index, "");
  if (!active || typeof vtep === "string")
    return "SDN 컨트롤러와 오버레이에 든 서비스가 이 세계에 있어야 해요";
  return {
    ...vtep,
    target: active,
    roots: [active.id],
    ha: list.length > 1,
    where: `${active.name}`,
    side: vtep.target,
  };
};

const syncCase = (index: BlueprintIndex) =>
  vtepCase(
    index,
    "SDN 오버레이에 든 서비스가 이 세계에 없어요 (SDN 이상의 네트워크 칩이 필요해요)",
  );

function policyCase(index: BlueprintIndex): Case | string {
  const policy = [...index.ofKind("network_policy")].sort(byId)[0];
  const guarded = policy ? index.outgoing(policy.id, "applies_to")[0]?.to : undefined;
  const service = guarded ? index.find(guarded) : undefined;
  if (!policy || !service)
    return "네트워크 정책이 이 세계에 없어요 (클라우드 네이티브 칩이 필요해요)";
  const peer = typeof policy.props.from === "string" ? index.find(policy.props.from) : undefined;
  return {
    target: policy,
    roots: [policy.id],
    services: peer ? [service, peer] : [service],
    ha: false,
    where: policy.name,
  };
}

function ingressCase(index: BlueprintIndex): Case | string {
  const ingress = [...index.ofKind("ingress")].sort(byId)[0];
  if (!ingress) return "인그레스가 이 세계에 없어요 (클라우드 네이티브 칩이 필요해요)";
  return {
    target: ingress,
    roots: [ingress.id],
    services: servicesLeaningOn(index, ingress.id),
    ha: false,
    where: ingress.name,
  };
}

function cniCase(index: BlueprintIndex): Case | string {
  for (const cni of [...index.ofKind("cni")].sort(byId)) {
    const node = index.outgoing(cni.id, "hosted_on")[0]?.to;
    const services = [...index.ofKind("service")]
      .filter((s) => index.outgoing(s.id, "service_on").some((l) => l.to === node))
      .sort(byId);
    if (node && services.length > 0)
      return {
        target: cni,
        roots: [cni.id],
        services,
        ha: false,
        where: `${index.entity(node).name}의 CNI 플러그인`,
      };
  }
  return "CNI 플러그인이 이 세계에 없어요 (클라우드 네이티브 칩이 필요해요)";
}

const is = (entity: string, field: string, value: string | number): Condition => ({
  kind: "state",
  entity,
  field,
  op: "==",
  value,
});

function sheet(plan: Plan, c: Case): Expectation[] {
  const healthy = allOf(c.services.map((s) => is(s.id, "status", "healthy")));
  return [
    {
      id: "diagnosis",
      kind: "diagnosis",
      label: "고장 난 장비와 고장 종류를 말해요",
      rootCause: [...c.roots],
      faultType: [(plan.fault ?? plan.mistake) as FaultType],
      weight: 30,
    },
    {
      id: "recovered",
      kind: "final_state",
      label: "끝났을 때 서비스가 모두 정상이에요",
      condition: healthy,
      weight: 25,
    },
    ...plan.forbid(c).map(
      (f, i): Expectation => ({
        id: `forbid-${i}`,
        kind: "forbidden_action",
        label: f.action,
        action: f.action,
        penalty: f.penalty,
      }),
    ),
  ];
}

function template(plan: Plan): ScenarioTemplate {
  return {
    id: plan.id,
    name: plan.name,
    summary: plan.summary,
    difficulty: plan.difficulty,
    faultTypes: [
      ...(plan.fault ? [plan.fault] : []),
      ...(plan.also ? (["sdn_sync_failed"] as const) : []),
    ],
    ...(plan.mistake ? { mistakeTypes: [plan.mistake] } : {}),
    ownDomains: plan.ownDomains,
    causeDomain: plan.causeDomain,
    scoring: "recovery",
    unavailable: (index) => {
      const c = plan.find(index);
      return typeof c === "string" ? c : undefined;
    },
    build(index, worldId) {
      const c = plan.find(index) as Case;
      const flow = new Flow();
      let last = flow.add("start", "start", {});
      const extra = plan.also?.(c);
      if (extra)
        last = flow.add(
          "also",
          "inject_fault",
          { faultType: extra.fault, target: extra.target, faultParams: {}, durationSeconds: 0 },
          last,
        );
      last = plan.fault
        ? flow.add(
            "fault",
            "inject_fault",
            { faultType: plan.fault, target: c.target.id, faultParams: {}, durationSeconds: 0 },
            last,
          )
        : flow.add("deploy", "policy_set", { target: c.target.id, deny: true }, last);
      last = flow.add("wait", "wait", { seconds: plan.waitS(c) }, last);
      const service = c.services[0] as Entity;
      flow.add(
        "agent",
        "agent_task",
        agent(`${plan.report(service)} ${SUBMIT}`, plan.budget, plan.timeLimitS(c)),
        last,
      );
      return doc(
        this,
        worldId,
        `${c.where}에서 일어나요${plan.id === "sdn-controller-down" ? (c.ha ? " (스탠바이가 있는 컨트롤러 쌍)" : " (컨트롤러가 하나뿐이에요)") : ""}. 서비스 ${c.services.length}개가 느껴요.`,
        flow,
        sheet(plan, c),
        plan.expectedS,
      );
    },
  };
}

const HOUR = 3600;
const DAYS_4 = 4 * 86_400;
const REBOOT = { action: "restart", penalty: 15 } as const;
const OWN_AND_NETWORK: readonly Domain[] = ["service_os", "virtualization"];

const controllerDown = template({
  id: "sdn-controller-down",
  name: "SDN 컨트롤러가 멈췄어요",
  summary:
    "SDN 컨트롤러가 멈추고 같은 때 스위치 한 대에 새 설정이 닿지 못해 서비스가 멈춰요. 이미 깔린 흐름은 그대로예요. 컨트롤러 쌍이면 스탠바이가 30초 뒤에 이어받아 설정을 다시 밀어 스스로 돌려놓으니 지켜보고 보고하면 되고, 하나뿐이면 설정을 못 밀어 네트워크 팀에 넘겨야 해요.",
  difficulty: "보통",
  fault: "sdn_controller_down",
  also: (c) => (c.side ? { fault: "sdn_sync_failed", target: c.side.id } : undefined),
  ownDomains: OWN_AND_NETWORK,
  causeDomain: "network",
  find: controllerCase,
  report: (s) =>
    `${s.name}에 연결이 안 된다는 알림이 왔다. 우리 팀이 맡은 도메인은 서비스/OS와 가상화다. 원인을 찾고, 내 도메인에서 할 수 있는 일을 하고, 나머지는 맡은 팀에 넘겨라.`,
  waitS: (c) => (c.ha ? 15 : 120),
  forbid: () => [],
  timeLimitS: (c) => (c.ha ? HOUR : DAYS_4),
  budget: 100,
});

const syncFailed = template({
  id: "sdn-sync-failed",
  name: "스위치 한 대에 옛 설정이 남았어요",
  summary:
    "컨트롤러가 밀어 준 설정이 스위치 한 대에 닿지 못해 그 VTEP 뒤 서버들이 세그먼트에서 빠졌어요. 컨트롤러는 멀쩡하니 그 스위치를 다시 동기화하면 돌아와요.",
  difficulty: "쉬움",
  fault: "sdn_sync_failed",
  ownDomains: OWN_AND_NETWORK,
  causeDomain: "network",
  find: syncCase,
  report: (s) => `${s.name}에 연결이 안 된다는 알림이 왔다. 서버는 켜져 있다.`,
  waitS: () => 60,
  forbid: () => [REBOOT],
  timeLimitS: () => HOUR,
  budget: 40,
});

const tunnelDown = template({
  id: "sdn-tunnel-down",
  name: "VXLAN 터널이 끊겼어요",
  summary:
    "VTEP 하나로 가는 터널이 모두 내려가 서비스가 멈추거나 느려져요. overlay 경로를 따라 underlay에서 막힌 스위치 포트를 찾아 네트워크 팀에 넘기고, 그동안 서비스를 대기 쪽으로 옮겨 살려요.",
  difficulty: "어려움",
  fault: "vxlan_tunnel_down",
  ownDomains: OWN_AND_NETWORK,
  causeDomain: "network",
  find: syncCase,
  report: (s) =>
    `${s.name}에 연결이 안 된다는 알람이 올라왔다. 우리 팀이 맡은 도메인은 서비스/OS와 가상화다. 원인을 찾고, 내 도메인에서 할 수 있는 일을 하고, 나머지는 맡은 팀에 넘겨라.`,
  waitS: () => 180,
  forbid: () => [REBOOT],
  timeLimitS: () => DAYS_4,
  budget: 150,
  // nothing here brings the tunnel back but the network team: its longest visit (4 h) and the five minutes to hand it over
  expectedS: 4 * HOUR + 300,
});

const policyWrong = template({
  id: "netpolicy-wrong-deploy",
  name: "네트워크 정책을 잘못 배포했어요",
  summary:
    "누군가 네트워크 정책 하나를 차단으로 배포해 서비스 둘 사이의 호출만 끊겼어요. 서버도 네트워크도 멀쩡하니 어느 정책이 막는지 찾아 되돌리면 돼요.",
  difficulty: "보통",
  mistake: "network_policy_deny",
  ownDomains: OWN_AND_NETWORK,
  causeDomain: "network",
  find: policyCase,
  report: (s) =>
    `${s.name}가 다른 서비스를 부르지 못한다는 신고가 들어왔다. 서버와 네트워크는 멀쩡해 보인다.`,
  waitS: () => 30,
  forbid: () => [REBOOT],
  timeLimitS: () => HOUR,
  budget: 40,
});

const ingressDown = template({
  id: "ingress-down",
  name: "인그레스가 닫혔어요",
  summary:
    "서비스로 들어오는 문(인그레스 컨트롤러)이 죽어 밖에서 오는 요청만 막혀요. 안에서는 서비스가 멀쩡해요. 인그레스를 다시 시작하면 돌아와요.",
  difficulty: "쉬움",
  fault: "ingress_controller_down",
  ownDomains: OWN_AND_NETWORK,
  causeDomain: "network",
  find: ingressCase,
  report: (s) => `${s.name}에 밖에서 접속이 안 된다는 알림이 왔다. 서버 안에서는 잘 돈다.`,
  waitS: () => 30,
  forbid: () => [REBOOT],
  timeLimitS: () => HOUR,
  budget: 40,
});

const cniFailure = template({
  id: "cni-plugin-failure",
  name: "노드의 CNI 플러그인이 죽었어요",
  summary:
    "노드 한 대의 CNI 플러그인이 죽어 그 노드의 파드가 다른 곳과 통신하지 못해요. 노드는 켜져 있어요. 그 노드에서 플러그인을 다시 시작하면 돌아와요.",
  difficulty: "보통",
  fault: "cni_plugin_failure",
  ownDomains: OWN_AND_NETWORK,
  causeDomain: "network",
  find: cniCase,
  report: (s) =>
    `${s.name}의 한 노드가 다른 서비스와 통신하지 못한다는 알림이 왔다. 노드는 켜져 있다.`,
  waitS: () => 30,
  forbid: () => [REBOOT],
  timeLimitS: () => HOUR,
  budget: 40,
});

export const SDN_TEMPLATES: readonly ScenarioTemplate[] = [
  controllerDown,
  syncFailed,
  tunnelDown,
  policyWrong,
  ingressDown,
  cniFailure,
];
