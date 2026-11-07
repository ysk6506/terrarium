/**
 * Faults of the database and storage-HA layers (REQ-095, ADR-0107 item 6): six sheets, each a service that stops or
 * slows because of one thing in the database or under it. They are scored recovery first (REQ-088): the points go to the
 * services being well again soon, to acting before finding out everything, to doing no harm on the way (a restore that
 * throws away six hours of writes where a promotion would have lost a second takes points back), and to saying what broke.
 * Where the cluster or the storage heals by itself, an agent that watches and reports earns the report and nothing else:
 * the recovery is the cluster's (cause `cluster`), and the score keeps the two apart.
 *
 *   db-primary-down           프라이머리가 죽었어요          → 수동 클러스터는 사람이 승격해요, 자동 클러스터는 지켜보고 보고해요
 *   db-replication-broken     복제가 끊겼어요                → 세컨더리를 다시 시작해요 (승격하면 지연만큼 잃어요)
 *   db-split-brain            스플릿 브레인                  → 남길 쪽을 골라 승격하면 다른 쪽은 격리돼요
 *   db-shared-path-cut        공유 디스크 경로가 끊겼어요    → 멀티패스가 아니면 다른 컨트롤러 경로로 직접 바꿔요
 *   storage-node-lost         분산 스토리지 노드를 잃었어요  → 재복제가 끝날 때까지 느려요, DB를 건드리지 않고 지켜봐요
 *   db-restore-corrupt-backup 단일 DB가 죽고 최신 백업이 깨졌어요 → 복원이 실패하니 더 오래된 백업으로 복원해요
 */
import type { BlueprintIndex, Domain, Entity, FaultType } from "@terrarium/core/world";
import {
  controllersOf,
  dbClusterDef,
  instancesOf,
  nodesOfPool,
  poolDef,
  poolOfInstance,
  RESTORE_S,
} from "@terrarium/core/world";
import { agent, allOf, doc, Flow, type ScenarioTemplate, SUBMIT } from "./library-kit";
import type { ActionKind, Condition, Expectation } from "./model";

/** The cluster a sheet is about, with the services that lean on it and the equipment the fault lands on. */
interface Case {
  readonly cluster: Entity;
  readonly services: readonly Entity[];
  readonly instances: readonly Entity[];
  /** The thing the fault is put on, and the answer the diagnosis names. */
  readonly target: Entity;
  readonly auto: boolean;
}

interface Plan {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly difficulty: "쉬움" | "보통" | "어려움";
  readonly fault: FaultType;
  readonly faultParams?: Readonly<Record<string, number>>;
  /** Faults that come along (a damaged backup), put in before the main one. */
  readonly also?: ReadonlyArray<{ readonly fault: FaultType; readonly onCluster: boolean }>;
  readonly ownDomains: readonly Domain[];
  readonly causeDomain: Domain;
  /** The case the world offers, or the reason it offers none. */
  readonly find: (index: BlueprintIndex) => Case | string;
  /** What was reported, without saying what is wrong. */
  readonly report: (service: Entity) => string;
  /** Seconds the fault runs before the agent is told. */
  readonly waitS: number | ((c: Case) => number);
  /** What the sheet takes points back for: actions that make it worse. */
  readonly forbid: (
    c: Case,
  ) => ReadonlyArray<{ readonly action: ActionKind; readonly penalty: number }>;
  readonly timeLimitS?: number;
  /** Seconds the shape of the world takes to recover from this, when more than the five minutes (REQ-108, ADR-0131). */
  readonly expectedS?: number;
}

const BUDGET = 30;
const TIME_S = 3600;
const KIND_ORDER = ["stateful", "batch", "request"];

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);

const servicesOf = (index: BlueprintIndex, clusterId: string): Entity[] =>
  index
    .incoming(clusterId, "depends_on")
    .map((l) => index.find(l.from))
    .filter((e): e is Entity => e?.kind === "service")
    .sort(
      (a, b) =>
        KIND_ORDER.indexOf(String(a.props.serviceKind)) -
          KIND_ORDER.indexOf(String(b.props.serviceKind)) || byId(a, b),
    );

/** The clusters of the world that lean-ed on by a service, by id, with a way to build a case for each. */
function clusters(index: BlueprintIndex): Entity[] {
  return [...index.ofKind("db_cluster")]
    .filter((c) => servicesOf(index, c.id).length > 0)
    .sort(byId);
}

function caseOf(
  index: BlueprintIndex,
  cluster: Entity,
  pick: (members: readonly Entity[], cluster: Entity) => Entity | undefined,
): Case | undefined {
  const instances = instancesOf(index, cluster.id);
  const target = pick(instances, cluster);
  if (!target) return undefined;
  return {
    cluster,
    services: servicesOf(index, cluster.id),
    instances,
    target,
    auto: dbClusterDef(cluster).failover === "auto",
  };
}

const roleOf = (e: Entity): string => String(e.props.role ?? "primary");

/** The first cluster that fits `want`, or the sentence that says what the world lacks. */
function first(
  index: BlueprintIndex,
  lacks: string,
  want: (cluster: Entity, instances: readonly Entity[]) => Entity | undefined,
): Case | string {
  for (const cluster of clusters(index)) {
    const found = caseOf(index, cluster, (members, c) => want(c, members));
    if (found) return found;
  }
  return lacks;
}

const SHAPES_WITH_REPLICA = ["replicated", "auto_failover", "active_passive"];

const primaryDown = (index: BlueprintIndex) =>
  first(index, "승격할 인스턴스가 있는 데이터베이스가 이 세계에 없어요", (cluster, members) =>
    SHAPES_WITH_REPLICA.includes(dbClusterDef(cluster).shape) && members.length >= 2
      ? members.find((m) => roleOf(m) === "primary")
      : undefined,
  );

const replicationBroken = (index: BlueprintIndex) =>
  first(index, "복제본이 있는 데이터베이스가 이 세계에 없어요", (cluster, members) =>
    ["replicated", "auto_failover"].includes(dbClusterDef(cluster).shape)
      ? members.find((m) => roleOf(m) === "secondary")
      : undefined,
  );

const splitBrain = (index: BlueprintIndex) =>
  first(index, "자동 페일오버 클러스터가 이 세계에 없어요", (cluster, members) =>
    dbClusterDef(cluster).shape === "auto_failover" && members.length >= 2 ? cluster : undefined,
  );

/** A cluster whose data is on a pool with two paths that nobody switches by themselves. */
const pathCut = (index: BlueprintIndex) =>
  first(
    index,
    "경로를 사람이 바꾸는 공유 스토리지(컨트롤러 둘)가 이 세계에 없어요",
    (_c, members) => {
      const pool = members[0] ? poolOfInstance(index, members[0].id) : undefined;
      const def = pool ? poolDef(index.entity(pool)) : undefined;
      return pool && def?.mode === "dual" && !def.multipath
        ? controllersOf(index, pool)[0]
        : undefined;
    },
  );

const nodeLost = (index: BlueprintIndex) =>
  first(index, "분산 스토리지 위의 데이터베이스가 이 세계에 없어요", (_c, members) => {
    const pool = members[0] ? poolOfInstance(index, members[0].id) : undefined;
    return pool && poolDef(index.entity(pool)).mode === "distributed"
      ? nodesOfPool(index, pool)[0]
      : undefined;
  });

const singleDown = (index: BlueprintIndex) =>
  first(index, "단일 인스턴스 데이터베이스가 이 세계에 없어요", (cluster, members) =>
    dbClusterDef(cluster).shape === "single" ? members[0] : undefined,
  );

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
      rootCause: [c.target.id],
      faultType: [plan.fault],
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
        label: ACTION_WORDS[f.action] ?? f.action,
        action: f.action,
        penalty: f.penalty,
      }),
    ),
  ];
}

const ACTION_WORDS: Readonly<Partial<Record<ActionKind, string>>> = {
  db_restore: "백업에서 복원 (백업 이후의 쓰기를 모두 잃어요)",
  db_promote: "복제본 승격 (복제 지연만큼 잃어요)",
  db_failover: "클러스터 페일오버 (복제 지연만큼 잃어요)",
};

function template(plan: Plan): ScenarioTemplate {
  return {
    id: plan.id,
    name: plan.name,
    summary: plan.summary,
    difficulty: plan.difficulty,
    faultTypes: [plan.fault],
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
      for (const [i, extra] of (plan.also ?? []).entries())
        last = flow.add(
          `also-${i}`,
          "inject_fault",
          {
            faultType: extra.fault,
            target: extra.onCluster ? c.cluster.id : c.target.id,
            faultParams: {},
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
          faultParams: { ...(plan.faultParams ?? {}) },
          durationSeconds: 0,
        },
        last,
      );
      const waitS = typeof plan.waitS === "function" ? plan.waitS(c) : plan.waitS;
      last = flow.add("wait", "wait", { seconds: waitS }, last);
      const service = c.services[0] as Entity;
      flow.add(
        "agent",
        "agent_task",
        agent(`${plan.report(service)} ${SUBMIT}`, BUDGET, plan.timeLimitS ?? TIME_S),
        last,
      );
      return doc(
        this,
        worldId,
        `${c.cluster.name}에서 일어나요${c.auto ? " (스스로 페일오버하는 클러스터)" : ""}. 서비스 ${c.services.length}개가 기대요.`,
        flow,
        sheet(plan, c),
        plan.expectedS,
      );
    },
  };
}

const NO_RESTORE = { action: "db_restore", penalty: 15 } as const;
const NO_PROMOTE = [
  { action: "db_promote", penalty: 20 },
  { action: "db_failover", penalty: 20 },
] as const;

const primaryDownSheet = template({
  id: "db-primary-down",
  name: "프라이머리 데이터베이스가 죽었어요",
  summary:
    "프라이머리 인스턴스가 죽어 서비스가 멈추거나 읽기만 돼요. 수동 클러스터는 세컨더리를 승격해야 하고, 스스로 페일오버하는 클러스터는 지켜보고 보고하면 돼요.",
  difficulty: "보통",
  fault: "db_primary_down",
  ownDomains: ["service_os"],
  causeDomain: "service_os",
  find: primaryDown,
  report: (s) => `${s.name}가 멈췄거나 쓰기가 안 된다는 알림이 왔다.`,
  // a cluster that fails over by itself has done it before the agent is told: what is left is to find out what broke
  waitS: (c) => (c.auto ? 300 : 15),
  forbid: () => [NO_RESTORE],
});

const replicationBrokenSheet = template({
  id: "db-replication-broken",
  name: "복제가 끊겼어요",
  summary:
    "세컨더리가 프라이머리를 따라오지 못해 복제 지연이 늘고 서비스가 느려져요. 세컨더리를 다시 시작하면 이어지고, 섣불리 승격하면 지연만큼 잃어요.",
  difficulty: "보통",
  fault: "db_replication_broken",
  faultParams: { lagPerMin: 60 },
  ownDomains: ["service_os"],
  causeDomain: "service_os",
  find: replicationBroken,
  report: (s) => `${s.name}가 느려졌고 읽은 데이터가 오래된 것 같다는 알림이 왔다.`,
  waitS: 600,
  forbid: () => [...NO_PROMOTE, NO_RESTORE],
});

const splitBrainSheet = template({
  id: "db-split-brain",
  name: "스플릿 브레인",
  summary:
    "자동 페일오버가 프라이머리를 잘못 감지해 인스턴스 둘이 모두 프라이머리라고 해요. 남길 쪽을 골라 승격하면 다른 쪽은 격리돼요.",
  difficulty: "어려움",
  fault: "db_split_brain",
  ownDomains: ["service_os"],
  causeDomain: "service_os",
  find: splitBrain,
  report: (s) => `${s.name}에서 방금 쓴 데이터가 안 보이거나 서로 다르다는 신고가 들어왔다.`,
  waitS: 60,
  forbid: () => [NO_RESTORE],
});

const pathCutSheet = template({
  id: "db-shared-path-cut",
  name: "공유 디스크 경로가 끊겼어요",
  summary:
    "데이터베이스가 쓰는 공유 디스크로 가는 경로가 끊겨 서비스가 멈춰요. 호스트가 경로를 알아서 바꾸지 못하니 다른 컨트롤러 경로로 직접 바꿔야 해요.",
  difficulty: "보통",
  fault: "storage_path_cut",
  ownDomains: ["service_os", "storage"],
  causeDomain: "storage",
  find: pathCut,
  report: (s) => `${s.name}가 멈췄고 데이터베이스가 응답하지 않는다는 알림이 왔다.`,
  waitS: 30,
  forbid: () => [NO_RESTORE],
});

const nodeLostSheet = template({
  id: "storage-node-lost",
  name: "분산 스토리지 노드를 잃었어요",
  summary:
    "분산 스토리지의 노드 하나를 잃어 복제본을 다시 만드는 동안 서비스가 느려요. 다 만들어지면 돌아오니, 데이터베이스를 건드리지 말고 지켜보며 원인을 보고해야 해요.",
  difficulty: "쉬움",
  fault: "storage_node_lost",
  ownDomains: ["service_os", "storage"],
  causeDomain: "storage",
  find: nodeLost,
  report: (s) => `${s.name}가 느려졌다는 알림이 왔다.`,
  waitS: 30,
  forbid: () => [...NO_PROMOTE, NO_RESTORE],
});

const restoreSheet = template({
  id: "db-restore-corrupt-backup",
  name: "단일 데이터베이스가 죽었고 최신 백업이 깨졌어요",
  summary:
    "하나뿐인 데이터베이스가 죽어 백업에서 되살려야 하는데, 가장 최근 백업이 깨져 복원이 중간에 실패해요. 더 오래된 백업으로 다시 복원해야 해요.",
  difficulty: "어려움",
  fault: "db_primary_down",
  also: [{ fault: "db_backup_corrupt", onCluster: true }],
  ownDomains: ["service_os"],
  causeDomain: "service_os",
  find: singleDown,
  report: (s) => `${s.name}가 멈췄다는 알림이 왔다.`,
  waitS: 30,
  forbid: () => [],
  timeLimitS: 5400,
  // a restore takes twenty minutes whatever the agent does
  expectedS: RESTORE_S,
});

export const DB_TEMPLATES: readonly ScenarioTemplate[] = [
  primaryDownSheet,
  replicationBrokenSheet,
  splitBrainSheet,
  pathCutSheet,
  nodeLostSheet,
  restoreSheet,
];
