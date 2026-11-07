/**
 * Faults of the application layer, seen as a service that stops or slows (REQ-100, ADR-0121): seven sheets, each a service in
 * trouble because of one thing in front of it, beside it or between it and the services it calls. They are scored recovery
 * first (REQ-088): the points go to the services being well again soon, to acting before finding out everything, to doing no
 * harm on the way, and to saying what broke. Where the layer heals itself (a balancer that takes a dead backend out after three
 * failed checks, a global balancer that fails a region over after five minutes), an agent that is quick still beats one that
 * waits.
 *
 *   lb-backend-flapping    백엔드 한 대가 됐다 안 됐다 해요     → 그 백엔드를 로테이션에서 빼요 (lb_drain)
 *   session-store-down     세션 저장소가 멈췄어요              → 그 호스트에서 redis를 다시 시작해요
 *   breaker-stuck-open     서킷 브레이커가 열린 채 굳었어요      → 브레이커를 리셋해요 (breaker_reset)
 *   retry-storm            재시도 폭주가 호출을 불려요          → 메시 설정을 되돌려요 (mesh_rollback)
 *   sidecar-crash          사이드카가 죽었어요                 → 그 호스트에서 envoy를 다시 시작해요
 *   mesh-control-stuck     컨트롤 플레인이 멈춘 채 설정이 잘못 퍼졌어요 → istiod를 살린 뒤 설정을 되돌려요
 *   region-down            리전이 통째로 멈췄어요              → 멀쩡한 리전으로 트래픽을 옮겨요 (region_failover)
 */
import type { BlueprintIndex, Domain, Entity, FaultType } from "@terrarium/core/world";
import {
  appInstancesOf,
  breakerEnds,
  breakers,
  callsIn,
  instanceOfSidecar,
  lbOf,
  meshControls,
  regionOf,
  sessionStoreOf,
} from "@terrarium/core/world";
import { agent, allOf, doc, Flow, type ScenarioTemplate, SUBMIT } from "./library-kit";
import type { ActionKind, Condition, Expectation } from "./model";

/** What a sheet is about: the thing the fault is put on, the services that feel it, and the answers a diagnosis may name. */
interface Case {
  readonly target: Entity;
  /** Everything the fault is put on, when it is more than the one thing (a bad rollout kills every sidecar of a service). */
  readonly targets?: readonly Entity[];
  readonly roots: readonly string[];
  readonly services: readonly Entity[];
  readonly where: string;
}

interface Plan {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly difficulty: "쉬움" | "보통" | "어려움";
  readonly fault: FaultType;
  /** A second fault that comes with it (put in before the main one). */
  readonly also?: FaultType;
  readonly find: (index: BlueprintIndex) => Case | string;
  readonly report: (service: Entity) => string;
  readonly waitS: number;
  readonly forbid: readonly { action: ActionKind; penalty: number }[];
  readonly timeLimitS: number;
  readonly budget: number;
}

const OWN: readonly Domain[] = ["service_os", "virtualization"];
const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
const KIND_ORDER = ["request", "stateful", "batch"];
const rank = (e: Entity) => KIND_ORDER.indexOf(String(e.props.serviceKind));
const sorted = (list: readonly Entity[]) =>
  [...list].sort((a, b) => rank(a) - rank(b) || byId(a, b));
const servicesOf = (index: BlueprintIndex, ids: readonly string[]) =>
  sorted(ids.map((id) => index.find(id)).filter((e): e is Entity => e?.kind === "service"));

const NEED = {
  lb: "두 대 이상이 로드 밸런서 뒤에 선 서비스가 이 세계에 없어요 (애플리케이션 칩 '무상태 + LB'가 필요해요)",
  store: "세션 저장소가 이 세계에 없어요 (애플리케이션 칩 '무상태 + LB'가 필요해요)",
  breaker: "서킷 브레이커가 이 세계에 없어요 (애플리케이션 칩 '마이크로서비스'가 필요해요)",
  mesh: "서비스 메시가 이 세계에 없어요 (애플리케이션 칩 '서비스 메시'가 필요해요)",
  retry:
    "서비스 메시와 서비스끼리의 호출이 이 세계에 있어야 해요 (애플리케이션 칩 '서비스 메시'가 필요해요)",
  sidecar: "사이드카가 이 세계에 없어요 (애플리케이션 칩 '서비스 메시'가 필요해요)",
  region: "리전이 이 세계에 없어요 (애플리케이션 칩 '멀티 리전'이 필요해요)",
};

function flapCase(index: BlueprintIndex): Case | string {
  for (const service of sorted(index.ofKind("service"))) {
    const lb = lbOf(index, service.id);
    const backends = appInstancesOf(index, service.id);
    const target = backends[backends.length - 1];
    if (lb && target && backends.length >= 2)
      return {
        target,
        roots: [target.id, lb.id],
        services: [service],
        where: `${service.name}의 ${target.name}`,
      };
  }
  return NEED.lb;
}

function storeCase(index: BlueprintIndex): Case | string {
  for (const service of sorted(index.ofKind("service"))) {
    const store = sessionStoreOf(index, service.id);
    if (store)
      return {
        target: store,
        roots: [store.id],
        services: servicesOf(
          index,
          index.incoming(store.id, "depends_on").map((l) => l.from),
        ),
        where: store.name,
      };
  }
  return NEED.store;
}

function breakerCase(index: BlueprintIndex): Case | string {
  for (const target of breakers(index)) {
    const ends = breakerEnds(index, target);
    const callers = ends ? servicesOf(index, [ends.from]) : [];
    if (ends && callers.length > 0)
      return { target, roots: [target.id], services: callers, where: target.name };
  }
  return NEED.breaker;
}

function meshCase(need: string, withCalls: boolean) {
  return (index: BlueprintIndex): Case | string => {
    const target = meshControls(index)[0];
    if (!target) return NEED.mesh;
    const callees = servicesOf(
      index,
      index
        .ofKind("service")
        .filter((s) => callsIn(index, s.id).length > 0)
        .map((s) => s.id),
    );
    if (withCalls && callees.length === 0) return need;
    return { target, roots: [target.id], services: callees, where: target.name };
  };
}

function sidecarCase(index: BlueprintIndex): Case | string {
  for (const service of sorted(index.ofKind("service"))) {
    const backends = appInstancesOf(index, service.id);
    const sidecars = backends
      .map((i) => index.incoming(i.id, "hosted_on").map((l) => index.find(l.from)))
      .map((list) => list.find((e) => e?.kind === "mesh_sidecar"))
      .filter((e): e is Entity => e !== undefined);
    const first = sidecars[0];
    if (first && sidecars.length === backends.length && instanceOfSidecar(index, first.id))
      return {
        target: first,
        targets: sidecars,
        roots: [...sidecars.map((e) => e.id), ...backends.map((e) => e.id)],
        services: [service],
        where: `${service.name}의 사이드카 ${sidecars.length}개`,
      };
  }
  return NEED.sidecar;
}

function regionCase(index: BlueprintIndex): Case | string {
  for (const service of sorted(index.ofKind("service"))) {
    const regions = appInstancesOf(index, service.id)
      .map((i) => regionOf(index, i.id))
      .filter((r): r is Entity => r !== undefined);
    const target = [...new Set(regions)].sort(byId)[0];
    if (target && new Set(regions.map((r) => r.id)).size >= 2)
      return { target, roots: [target.id], services: [service], where: target.name };
  }
  return NEED.region;
}

const is = (entity: string, field: string, value: string | number): Condition => ({
  kind: "state",
  entity,
  field,
  op: "==",
  value,
});

function sheet(plan: Plan, c: Case): Expectation[] {
  return [
    {
      id: "diagnosis",
      kind: "diagnosis",
      label: "고장 난 장비와 고장 종류를 말해요",
      rootCause: [...c.roots],
      faultType: [plan.fault],
      weight: 30,
    },
    {
      id: "recovered",
      kind: "final_state",
      label: "끝났을 때 서비스가 모두 정상이에요",
      condition: allOf(c.services.map((s) => is(s.id, "status", "healthy"))),
      weight: 25,
    },
    ...plan.forbid.map(
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
    faultTypes: plan.also ? [plan.fault, plan.also] : [plan.fault],
    ownDomains: OWN,
    causeDomain: "service_os",
    scoring: "recovery",
    unavailable: (index) => {
      const c = plan.find(index);
      return typeof c === "string" ? c : undefined;
    },
    build(index, worldId) {
      const c = plan.find(index) as Case;
      const flow = new Flow();
      let last = flow.add("start", "start", {});
      const inject = (id: string, faultType: FaultType, target: Entity) =>
        flow.add(
          id,
          "inject_fault",
          { faultType, target: target.id, faultParams: {}, durationSeconds: 0 },
          last,
        );
      if (plan.also) last = inject("also", plan.also, c.target);
      (c.targets ?? [c.target]).forEach((target, i) => {
        last = inject(i === 0 ? "fault" : `fault-${i + 1}`, plan.fault, target);
      });
      last = flow.add("wait", "wait", { seconds: plan.waitS }, last);
      flow.add(
        "agent",
        "agent_task",
        agent(`${plan.report(c.services[0] as Entity)} ${SUBMIT}`, plan.budget, plan.timeLimitS),
        last,
      );
      return doc(
        this,
        worldId,
        `${c.where}에서 일어나요. 서비스 ${c.services.length}개가 느껴요.`,
        flow,
        sheet(plan, c),
      );
    },
  };
}

const HOUR = 3600;
const REBOOT = [{ action: "restart", penalty: 15 }] as const;

const flapping = template({
  id: "lb-backend-flapping",
  name: "백엔드 한 대가 됐다 안 됐다 해요",
  summary:
    "로드 밸런서 뒤 백엔드 한 대의 헬스 체크가 됐다 안 됐다 해 요청 일부가 끊겨요. 서버도 서비스 프로세스도 멀쩡해 보여요. 그 백엔드를 로테이션에서 빼면(drain) 멈춰요. 밸런서는 연속 3번 실패해야 빼서 흔들리는 백엔드는 스스로 빠지지 않아요.",
  difficulty: "보통",
  fault: "lb_backend_flapping",
  find: flapCase,
  report: (s) => `${s.name}의 요청 일부가 가끔 끊긴다는 신고가 들어왔다. 서버는 멀쩡해 보인다.`,
  waitS: 30,
  forbid: REBOOT,
  timeLimitS: HOUR,
  budget: 40,
});

const storeDown = template({
  id: "session-store-down",
  name: "세션 저장소가 멈췄어요",
  summary:
    "세션을 따로 두는 저장소(redis)가 멈춰 로그인이 풀리고 서비스가 느려져요. 서비스 서버는 멀쩡해요. 저장소가 선 호스트에서 redis를 다시 시작하면 돌아와요.",
  difficulty: "쉬움",
  fault: "session_store_down",
  find: storeCase,
  report: (s) => `${s.name}에서 로그인이 계속 풀린다는 신고가 들어왔다.`,
  waitS: 30,
  forbid: REBOOT,
  timeLimitS: HOUR,
  budget: 40,
});

const breakerOpen = template({
  id: "breaker-stuck-open",
  name: "서킷 브레이커가 열린 채 굳었어요",
  summary:
    "부르는 쪽 서킷 브레이커 하나가 열린 채 닫히지 않아 상대가 멀쩡한데도 대체 응답만 받아요. 상대 서비스를 살펴봐도 이상이 없어요. 브레이커를 리셋하면 돌아와요.",
  difficulty: "보통",
  fault: "circuit_breaker_stuck_open",
  find: breakerCase,
  report: (s) =>
    `${s.name}가 부르는 서비스는 멀쩡한데 응답이 대체 값으로만 온다는 신고가 들어왔다.`,
  waitS: 30,
  forbid: REBOOT,
  timeLimitS: HOUR,
  budget: 40,
});

const retryStorm = template({
  id: "retry-storm",
  name: "재시도 폭주가 호출을 불려요",
  summary:
    "잘못된 메시 설정(재시도 5번, 간격 없음)이 퍼져 호출이 몇 배로 불어요. 불린 서비스가 느려지고 부르는 서비스도 따라 느려져요. 서버 자원은 멀쩡해요. 메시 설정을 되돌리면 멈춰요.",
  difficulty: "어려움",
  fault: "retry_storm",
  find: meshCase(NEED.retry, true),
  report: (s) =>
    `${s.name}가 갑자기 느려졌다는 알림이 왔다. 호출 수가 평소의 몇 배다. 서버는 멀쩡해 보인다.`,
  waitS: 30,
  forbid: REBOOT,
  timeLimitS: HOUR,
  budget: 60,
});

const sidecarCrash = template({
  id: "sidecar-crash",
  name: "사이드카가 모두 죽었어요",
  summary:
    "잘못된 사이드카 이미지를 롤아웃해 서비스의 사이드카(envoy)가 모두 죽었어요. 인스턴스로 가는 트래픽이 모두 막히지만 애플리케이션 프로세스는 살아 있어요. 로드 밸런서는 뺄 백엔드가 남지 않아 스스로 돌아오지 못하고, 각 호스트에서 envoy를 다시 시작해야 해요.",
  difficulty: "보통",
  fault: "sidecar_crash",
  find: sidecarCase,
  report: (s) => `${s.name}가 응답하지 않는다는 알림이 왔다. 앱 프로세스는 떠 있다.`,
  waitS: 30,
  forbid: REBOOT,
  timeLimitS: HOUR,
  budget: 40,
});

const meshStuck = template({
  id: "mesh-control-stuck",
  name: "컨트롤 플레인이 멈춘 채 설정이 잘못 퍼졌어요",
  summary:
    "잘못된 메시 설정이 퍼져 호출이 불어난 데다 컨트롤 플레인(istiod)까지 멈췄어요. 설정을 되돌리려 해도 컨트롤 플레인이 멈춰 있으면 거부돼요. istiod를 먼저 살린 뒤 설정을 되돌려야 해요.",
  difficulty: "어려움",
  fault: "mesh_control_down",
  also: "retry_storm",
  find: meshCase(NEED.retry, true),
  report: (s) =>
    `${s.name}가 갑자기 느려졌고 메시 설정을 바꿔도 먹지 않는다는 알림이 왔다. 서버는 멀쩡해 보인다.`,
  waitS: 30,
  forbid: REBOOT,
  timeLimitS: HOUR,
  budget: 80,
});

const regionDown = template({
  id: "region-down",
  name: "리전이 통째로 멈췄어요",
  summary:
    "리전 하나가 통째로 멈췄어요. 글로벌 로드 밸런서가 보고 빼기까지 5분쯤 걸리고 그동안 요청 일부가 실패해요. 지금 바로 멀쩡한 리전으로 트래픽을 옮기면 기다리지 않아도 돼요. 멈춘 리전은 클라우드 팀이 살려요.",
  difficulty: "어려움",
  fault: "region_down",
  find: regionCase,
  report: (s) => `${s.name}의 요청이 한 곳에서 계속 실패한다는 알림이 왔다.`,
  waitS: 30,
  forbid: REBOOT,
  timeLimitS: 4 * HOUR,
  budget: 60,
});

export const APP_TEMPLATES: readonly ScenarioTemplate[] = [
  flapping,
  storeDown,
  breakerOpen,
  retryStorm,
  sidecarCrash,
  meshStuck,
  regionDown,
];
