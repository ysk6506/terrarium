/**
 * Faults of the site and DR layer, of geo-replicated volumes and of the two databases that are not a `db_cluster` (REQ-106,
 * ADR-0129), seen as services that stop or slow. Scored recovery first (REQ-088): the points go to the services being well
 * again soon, to acting before finding out everything, to doing no harm on the way, and to saying what broke. Where the layer
 * moves by itself (a hot pair that fails over after thirty seconds, a ring that elects a leader) an agent that is quick still
 * beats one that waits, and an agent that does the wrong big thing (a failover for a cut line) is charged for it.
 *
 *   site-power-loss        사이트 전체의 전기가 끊겼어요           → 서비스를 복구 사이트로 전환해요 (dr_failover)
 *   dr-failover-stuck      전환이 중간에서 멈췄어요               → 전환을 다시 눌러 마저 끝내요 (dr_failover)
 *   wan-link-cut           사이트 사이 회선이 끊겼어요             → 전환하지 말고 회선 문제로 넘겨요 (진단)
 *   replication-broken     복제가 멈췄어요                       → 복제 프로세스를 다시 시작해요 (replicad)
 *   split-brain            두 사이트가 모두 주인이 됐어요          → 남길 사이트로 전환해요 (dr_failover)
 *   db-quorum-lost         합의 DB가 과반을 잃었어요              → 멈춘 노드를 다시 시작해요 (db_node_restart)
 *   db-managed-flapping    관리형 DB가 영역을 오락가락해요         → 안정된 영역을 골라 고정해요 (db_managed_failover)
 *   db-managed-storage-full 관리형 DB 저장소가 가득 찼어요          → 저장소를 늘려요 (db_managed_scale_storage)
 *   geo-replica-broken     지역 복제본이 깨졌어요                  → 서비스는 멀쩡해요, 스토리지 팀에 넘겨요 (진단)
 */
import type { BlueprintIndex, Domain, Entity, FaultType } from "@terrarium/core/world";
import {
  drPlanDef,
  drPlans,
  managedOf,
  ownerOf,
  ringOf,
  siteLinks,
  streamDef,
  streams,
  streamsOfPlan,
  volumes,
} from "@terrarium/core/world";
import { agent, allOf, doc, Flow, type ScenarioTemplate, SUBMIT } from "./library-kit";
import type { ActionKind, Condition, Expectation } from "./model";

interface Case {
  readonly target: Entity;
  /** A second fault that comes first, and what it is put on. */
  readonly also?: {
    readonly type: FaultType;
    readonly target: Entity;
    readonly params?: Record<string, number>;
  };
  readonly roots: readonly string[];
  readonly services: readonly Entity[];
  /** More that must hold at the end, beside the services being well. */
  readonly ends?: readonly Condition[];
  readonly where: string;
}

interface Plan {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly difficulty: "쉬움" | "보통" | "어려움";
  readonly fault: FaultType;
  readonly params?: Record<string, number>;
  readonly own: readonly Domain[];
  readonly cause: Domain;
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
const services = (index: BlueprintIndex, ids: readonly string[]): Entity[] =>
  ids
    .map((id) => index.find(id))
    .filter((e): e is Entity => e?.kind === "service")
    .sort((a, b) => rank(a) - rank(b) || byId(a, b));

const NEED = {
  plan: "복구 사이트가 이 세계에 없어요 (사이트 칩 'DR 콜드' 이상이 필요해요)",
  manual: "사람이 전환하는 복구 사이트(콜드·웜)가 이 세계에 없어요 (사이트 칩 'DR 웜'이 필요해요)",
  active:
    "액티브-액티브 사이트가 이 세계에 없어요 (사이트 칩 '멀티 사이트 액티브-액티브'가 필요해요)",
  link: "사이트 사이 회선이 이 세계에 없어요 (사이트 칩 'DR 콜드' 이상이 필요해요)",
  stream: "복제가 이 세계에 없어요 (사이트 칩 'DR 콜드' 이상이 필요해요)",
  ring: "합의 DB가 이 세계에 없어요 (데이터베이스 칩 '분산 SQL·합의'가 필요해요)",
  managed: "관리형 DB가 이 세계에 없어요 (데이터베이스 칩 '클라우드 관리형 멀티 AZ'가 필요해요)",
  volume: "지역 복제 볼륨이 이 세계에 없어요 (스토리지 칩 '지역 복제'가 필요해요)",
};

const is = (entity: string, field: string, value: string | number | boolean): Condition => ({
  kind: "state",
  entity,
  field,
  op: "==",
  value,
});

/** The services a plan copies, most important first. */
function copied(index: BlueprintIndex, planId: string): Entity[] {
  const ids = streamsOfPlan(index, planId).map((s) => streamDef(s).target);
  return services(index, ids);
}

function planCase(manualOnly: boolean, modes?: readonly string[]) {
  return (index: BlueprintIndex): Case | string => {
    const plans = drPlans(index).filter((p) => !modes || modes.includes(drPlanDef(p).mode));
    const plan = plans.find((p) => !manualOnly || !drPlanDef(p).auto);
    if (!plan) return manualOnly ? NEED.manual : NEED.plan;
    const def = drPlanDef(plan);
    const list = copied(index, plan.id);
    if (list.length === 0) return NEED.stream;
    return {
      target: index.entity(def.primary),
      roots: [def.primary, plan.id],
      services: list,
      ends: [is(plan.id, "serving", def.dr)],
      where: `${index.entity(def.primary).name} 전체`,
    };
  };
}

function stuckCase(index: BlueprintIndex): Case | string {
  const base = planCase(true)(index);
  if (typeof base === "string") return base;
  const plan = drPlans(index).find((p) => !drPlanDef(p).auto) as Entity;
  return {
    ...base,
    target: plan,
    also: { type: "site_power_loss", target: index.entity(drPlanDef(plan).primary) },
    roots: [plan.id, drPlanDef(plan).primary],
    where: `${index.entity(drPlanDef(plan).primary).name} 정전 뒤 ${plan.name}`,
  };
}

function linkCase(index: BlueprintIndex): Case | string {
  const link = siteLinks(index)[0];
  const plan = drPlans(index)[0];
  if (!link || !plan) return NEED.link;
  const list = copied(index, plan.id);
  if (list.length === 0) return NEED.stream;
  return { target: link, roots: [link.id], services: list, where: link.name };
}

function streamCase(index: BlueprintIndex): Case | string {
  const plan = drPlans(index)[0];
  const stream = plan ? streamsOfPlan(index, plan.id)[0] : undefined;
  if (!plan || !stream) return NEED.stream;
  return {
    target: stream,
    roots: [stream.id],
    services: copied(index, plan.id),
    ends: [is(stream.id, "status", "ok")],
    where: stream.name,
  };
}

function splitCase(index: BlueprintIndex): Case | string {
  const plan = drPlans(index).find((p) => drPlanDef(p).mode === "active");
  if (!plan) return NEED.active;
  const def = drPlanDef(plan);
  return {
    target: plan,
    roots: [plan.id, def.primary, def.dr],
    services: copied(index, plan.id),
    ends: [is(plan.id, "split", false)],
    where: plan.name,
  };
}

function quorumCase(index: BlueprintIndex): Case | string {
  for (const svc of services(
    index,
    index.ofKind("service").map((s) => s.id),
  )) {
    const ring = ringOf(index, svc.id).filter((n) => n.props.witness !== true);
    const first = ring[0];
    if (first)
      return {
        target: first,
        roots: ring.map((n) => n.id),
        services: [svc],
        where: `${svc.name}의 합의 DB`,
      };
  }
  return NEED.ring;
}

function managedCase(index: BlueprintIndex): Case | string {
  for (const svc of services(
    index,
    index.ofKind("service").map((s) => s.id),
  )) {
    const db = managedOf(index, svc.id);
    if (db) return { target: db, roots: [db.id], services: [svc], where: db.name };
  }
  return NEED.managed;
}

function volumeCase(index: BlueprintIndex): Case | string {
  const vol = volumes(index)[0];
  if (!vol) return NEED.volume;
  const owner = ownerOf(index, vol.id) ?? String(vol.props.service ?? "");
  // the alarm sits on the copy of the volume (its stream), so naming either is naming the cause
  const copy = streams(index).filter((x) => streamDef(x).target === vol.id);
  return {
    target: vol,
    roots: [vol.id, ...copy.map((x) => x.id)],
    services: services(index, [owner]),
    where: vol.name,
  };
}

function sheet(plan: Plan, c: Case): Expectation[] {
  return [
    {
      id: "diagnosis",
      kind: "diagnosis",
      label: "고장 난 곳과 고장 종류를 말해요",
      rootCause: [...c.roots],
      faultType: [plan.fault],
      weight: 30,
    },
    {
      id: "recovered",
      kind: "final_state",
      label: "끝났을 때 서비스가 모두 정상이에요",
      condition: allOf([
        ...c.services.map((s) => is(s.id, "status", "healthy")),
        ...(c.ends ?? []),
      ]),
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
    faultTypes: [plan.fault],
    ownDomains: plan.own,
    causeDomain: plan.cause,
    scoring: "recovery",
    unavailable: (index) => {
      const c = plan.find(index);
      return typeof c === "string" ? c : undefined;
    },
    build(index, worldId) {
      const c = plan.find(index) as Case;
      const flow = new Flow();
      let last = flow.add("start", "start", {});
      if (c.also)
        last = flow.add(
          "also",
          "inject_fault",
          {
            faultType: c.also.type,
            target: c.also.target.id,
            faultParams: c.also.params ?? {},
            durationSeconds: 0,
          },
          last,
        );
      last = flow.add(
        "fault",
        "inject_fault",
        {
          faultType: plan.fault,
          target: c.target.id,
          faultParams: plan.params ?? {},
          durationSeconds: 0,
        },
        last,
      );
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
const NO_FAILOVER = [{ action: "dr_failover", penalty: 25 }] as const;

const powerLoss = template({
  id: "site-power-loss",
  name: "사이트 전체의 전기가 끊겼어요",
  summary:
    "본 사이트의 전기가 통째로 끊겨 그 사이트의 서버실이 모두 꺼졌어요. 서비스가 멈췄고 서버 하나하나는 켤 수 없어요. 복구 사이트로 서비스를 전환하면(dr_failover) 이어가요. 웜은 15분, 콜드는 4시간쯤 걸리고 비동기 복제가 밀린 만큼의 쓰기는 잃어요. 핫은 스스로 넘기지만 30초는 기다려야 해요.",
  difficulty: "어려움",
  fault: "site_power_loss",
  own: OWN,
  cause: "facility",
  find: planCase(false),
  report: (s) => `${s.name}가 응답하지 않는다는 알림이 몰려온다. 본 사이트 전체가 조용하다.`,
  waitS: 30,
  forbid: REBOOT,
  timeLimitS: 8 * HOUR,
  budget: 40,
});

const stuck = template({
  id: "dr-failover-stuck",
  name: "전환이 중간에서 멈췄어요",
  summary:
    "본 사이트가 정전됐고 전환을 시작했는데 자동화가 중간에서 멈췄어요. 서비스는 어느 쪽에서도 돌지 않아요. 전환을 사람이 다시 눌러(dr_failover) 마저 끝내요. 처음 한 번에 끝난다고 믿고 기다리면 한참 걸려요.",
  difficulty: "어려움",
  fault: "dr_failover_stuck",
  own: OWN,
  cause: "facility",
  find: stuckCase,
  report: (s) => `${s.name}가 멈춘 채다. 전환을 눌렀다는데 복구 사이트에서도 돌지 않는다.`,
  waitS: 30,
  forbid: REBOOT,
  timeLimitS: 8 * HOUR,
  budget: 50,
});

const wanCut = template({
  id: "wan-link-cut",
  name: "사이트 사이 회선이 끊겼어요",
  summary:
    "두 사이트를 잇는 회선이 끊겼어요. 본 사이트는 멀쩡해서 서비스는 돌지만 복제가 멈춰 복구 사이트의 데이터가 낡아가요. 동기 복제는 확인을 못 받아 1분쯤 쓰기가 멈칫한 뒤 비동기로 내려가요. 여기서 전환하면 멀쩡한 본 사이트를 두고 낡은 복사본으로 옮기는 셈이에요. 회선은 네트워크팀 몫이니 원인을 말하고 넘겨요.",
  difficulty: "보통",
  fault: "wan_link_down",
  own: OWN,
  cause: "network",
  find: linkCase,
  report: (s) => `${s.name}는 도는데 복구 사이트 복제 지연 알림이 계속 온다.`,
  waitS: 90,
  forbid: NO_FAILOVER,
  timeLimitS: 2 * HOUR,
  budget: 40,
});

const replicationBroken = template({
  id: "replication-broken",
  name: "복제가 멈췄어요",
  summary:
    "서비스 하나의 사이트 간 복제가 멈췄어요(오류). 회선은 멀쩡하고 서비스도 돌아서 아무도 눈치채지 못해요. 시간이 갈수록 복구 사이트의 데이터가 낡아 그때 전환하면 많이 잃어요. 복제를 맡은 호스트에서 replicad를 다시 시작하면 따라잡아요.",
  difficulty: "보통",
  fault: "replication_broken",
  own: OWN,
  cause: "service_os",
  find: streamCase,
  report: (s) => `${s.name}의 복구 사이트 복제가 멈췄다는 점검 알림이 들어왔다.`,
  waitS: 60,
  forbid: [...REBOOT, ...NO_FAILOVER],
  timeLimitS: 2 * HOUR,
  budget: 40,
});

const splitBrain = template({
  id: "split-brain",
  name: "두 사이트가 모두 주인이 됐어요",
  summary:
    "회선이 끊긴 사이에 두 사이트가 모두 자기가 주인이라 믿고 쓰기를 받았어요. 데이터가 갈라져 쓰는 서비스가 멈춰요. 합의 DB가 없는 액티브-액티브에서만 일어나요. 남길 사이트를 정해 전환하면(dr_failover) 다른 쪽의 쓰기는 버려져요.",
  difficulty: "어려움",
  fault: "split_brain",
  own: OWN,
  cause: "service_os",
  find: splitCase,
  report: (s) => `${s.name}의 같은 주문이 사이트마다 다르게 보인다는 신고가 들어왔다.`,
  waitS: 30,
  forbid: REBOOT,
  timeLimitS: 4 * HOUR,
  budget: 50,
});

const quorum = template({
  id: "db-quorum-lost",
  name: "합의 DB가 과반을 잃었어요",
  summary:
    "합의 DB 노드가 과반 멈춰 새 리더를 뽑을 수 없어요. 쓰기가 모두 멈추고 읽기는 옛 값이에요. 멈춘 노드를 다시 시작해(db_node_restart) 과반을 되찾으면 선거가 열려요. 서비스 서버를 재시작해도 소용없어요.",
  difficulty: "보통",
  fault: "db_quorum_lost",
  params: { down: 2 },
  own: OWN,
  cause: "service_os",
  find: quorumCase,
  report: (s) => `${s.name}의 쓰기가 모두 실패한다는 알림이 왔다. DB 노드 일부가 보이지 않는다.`,
  waitS: 30,
  forbid: [{ action: "service_failover", penalty: 15 }],
  timeLimitS: HOUR,
  budget: 40,
});

const flapping = template({
  id: "db-managed-flapping",
  name: "관리형 DB가 영역을 오락가락해요",
  summary:
    "관리형 DB가 가용 영역 사이를 5분마다 넘나들어 그때마다 쓰기가 잠깐 멈춰요. 영역을 살리는 건 공급자라 손댈 수 없고, 안정된 영역을 직접 골라 고정하면(db_managed_failover) 멈춰요.",
  difficulty: "보통",
  fault: "db_failover_flapping",
  own: OWN,
  cause: "service_os",
  find: managedCase,
  report: (s) => `${s.name}의 쓰기가 몇 분마다 한 번씩 끊긴다는 알림이 왔다.`,
  waitS: 320,
  forbid: REBOOT,
  timeLimitS: HOUR,
  budget: 40,
});

const full = template({
  id: "db-managed-storage-full",
  name: "관리형 DB 저장소가 가득 찼어요",
  summary:
    "관리형 DB의 저장소가 가득 차 쓰기가 실패해요. 자동 확장이 10분쯤 뒤에 일어나지만 그동안 서비스가 멈춰요. 저장소를 직접 늘리면(db_managed_scale_storage) 바로 풀려요.",
  difficulty: "쉬움",
  fault: "db_storage_full",
  own: OWN,
  cause: "service_os",
  find: managedCase,
  report: (s) => `${s.name}의 쓰기가 '저장 공간 없음' 오류로 실패한다는 알림이 왔다.`,
  waitS: 30,
  forbid: REBOOT,
  timeLimitS: HOUR,
  budget: 30,
});

const geoBroken = template({
  id: "geo-replica-broken",
  name: "지역 복제본이 깨졌어요",
  summary:
    "다른 사이트에 둔 볼륨 복사본이 깨져 복제가 멈췄어요. 서비스는 멀쩡해서 알아채기 어렵고, 그 상태에서 사이트를 잃으면 볼륨을 올릴 수 없어요. 복사본을 다시 만드는 건 스토리지팀이에요. 원인을 말하고 넘겨요.",
  difficulty: "보통",
  fault: "geo_replica_broken",
  own: OWN,
  cause: "storage",
  find: volumeCase,
  report: (s) => `${s.name}의 볼륨 복제 점검에서 복구 사이트 복사본 오류가 떴다.`,
  waitS: 60,
  forbid: NO_FAILOVER,
  timeLimitS: 2 * HOUR,
  budget: 30,
});

export const SITE_TEMPLATES: readonly ScenarioTemplate[] = [
  powerLoss,
  stuck,
  wanCut,
  replicationBroken,
  splitBrain,
  quorum,
  flapping,
  full,
  geoBroken,
];
