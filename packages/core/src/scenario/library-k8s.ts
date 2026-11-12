/**
 * Faults of the container layer (REQ-096, ADR-0107 item 6): five sheets, each a service that stops or slows because
 * of one thing in the cluster under it. They are scored recovery first (REQ-088): the points go to the services being
 * well again soon, to acting before finding out everything, to doing no harm on the way, and to saying what broke.
 * Where the cluster heals itself (it moves the pods of a dead node after five minutes, it moves the pods of a node
 * short of disk at once) an agent that watches and reports earns the report and nothing else: the recovery is the
 * cluster's (cause `cluster`) and the score keeps the two apart.
 *
 *   k8s-worker-down      워커 노드가 멈췄어요           → kubelet을 다시 시작하거나, 5분 지켜보며 재스케줄을 확인해요
 *   k8s-crashloop        파드가 CrashLoopBackOff예요   → 로그를 읽고 롤아웃 재시작
 *   k8s-etcd-quorum      etcd 쿼럼을 잃었어요          → API가 멈췄으니 컨트롤 플레인 팀에 넘겨요
 *   k8s-pending          자원이 모자라 파드가 Pending이에요 → 덜 중요한 워크로드를 줄이거나 노드 추가를 요청해요
 *   k8s-disk-pressure    노드 디스크가 가득 찼어요      → 디스크를 비우고 uncordon
 */
import type { BlueprintIndex, Domain, Entity, FaultType } from "@terrarium/core/world";
import {
  k8sNodeDef,
  k8sWorkloadDef,
  nodeHost,
  servicesOfWorkload,
  workersOf,
  workloadsOfCluster,
} from "@terrarium/core/world";
import { agent, allOf, doc, Flow, type ScenarioTemplate, SUBMIT } from "./library-kit";
import type { ActionKind, Condition, Expectation } from "./model";

interface Case {
  readonly cluster: Entity;
  readonly services: readonly Entity[];
  readonly workers: readonly Entity[];
  readonly workloads: readonly Entity[];
}

interface Injection {
  readonly fault: FaultType;
  readonly target: (c: Case) => Entity;
  readonly params?: (c: Case, index: BlueprintIndex) => Readonly<Record<string, number>>;
}

interface Plan {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly difficulty: "쉬움" | "보통" | "어려움";
  /** Put in order; the first is the one the sheet is about, the others come along. */
  readonly inject: readonly Injection[];
  /** What the diagnosis names besides the target of the first fault. */
  readonly alsoRoot?: (c: Case, index: BlueprintIndex) => readonly string[];
  readonly minWorkers: number;
  /** What a cluster must also have for the sheet to be mendable, as the sentence that says what it lacks (undefined: nothing). */
  readonly lacks?: (c: Case, index: BlueprintIndex) => string | undefined;
  readonly report: (service: Entity) => string;
  readonly waitS: number;
  readonly forbid: ReadonlyArray<{ readonly action: ActionKind; readonly penalty: number }>;
  /** Conditions that must hold at the end besides the services being well. */
  readonly ending?: (c: Case) => ReadonlyArray<{ id: string; label: string; condition: Condition }>;
  readonly timeLimitS?: number;
  /** Seconds the sheet expects a recovery to take when only the team it is handed to can bring it (ADR-0133). */
  readonly expectedS?: number;
}

const BUDGET = 30;
const TIME_S = 3600;
const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);

function cases(index: BlueprintIndex): Case[] {
  return [...index.ofKind("k8s_cluster")].sort(byId).flatMap((cluster) => {
    // the workloads a service waits on; a batch workload nobody waits on is not the sheet's subject
    const workloads = workloadsOfCluster(index, cluster.id).filter(
      (w) => servicesOfWorkload(index, w.id).length > 0,
    );
    const services = [
      ...new Map(
        workloads.flatMap((w) => servicesOfWorkload(index, w.id)).map((s) => [s.id, s]),
      ).values(),
    ].sort(byId);
    return services.length > 0
      ? [{ cluster, services, workers: workersOf(index, cluster.id), workloads }]
      : [];
  });
}

function find(index: BlueprintIndex, minWorkers: number, lacks?: Plan["lacks"]): Case | string {
  const all = cases(index);
  if (all.length === 0) return "쿠버네티스 위에서 도는 서비스가 이 세계에 없어요";
  const big = all.filter((c) => c.workers.length >= minWorkers);
  if (big.length === 0)
    return `워커 노드가 ${minWorkers}개 이상인 쿠버네티스 클러스터가 이 세계에 없어요`;
  const reasons: string[] = [];
  for (const c of big) {
    const reason = lacks?.(c, index);
    if (reason === undefined) return c;
    reasons.push(reason);
  }
  return reasons[0] as string;
}

/** The workloads of the cluster that no service waits on (batch work): the ones that can give up their room. */
const idleWorkloads = (c: Case, index: BlueprintIndex): Entity[] =>
  workloadsOfCluster(index, c.cluster.id).filter(
    (w) => servicesOfWorkload(index, w.id).length === 0,
  );

/**
 * Whether the cluster can place every pod when all its workers stand and it has lost `lostPct` of what they offer. Each
 * pod goes to the worker with the most room left, the way the cluster itself does it (the scheduler in the world).
 */
function everyPodFits(c: Case, index: BlueprintIndex, lostPct: number): boolean {
  const keep = (100 - lostPct) / 100;
  const nodes = c.workers.map((w) => {
    const def = k8sNodeDef(w);
    return {
      cpu: Math.round(def.cpuMilli * keep),
      mem: Math.round(def.memMiB * keep),
      usedCpu: 0,
      usedMem: 0,
    };
  });
  for (const w of workloadsOfCluster(index, c.cluster.id)) {
    const def = k8sWorkloadDef(w);
    for (let i = 0; i < def.replicas; i++) {
      let best: (typeof nodes)[number] | undefined;
      let bestRoom = -1;
      for (const n of nodes) {
        const cpuFree = n.cpu - n.usedCpu - def.cpuMilli;
        const memFree = n.mem - n.usedMem - def.memMiB;
        if (cpuFree < 0 || memFree < 0) continue;
        const room = cpuFree / Math.max(1, n.cpu) + memFree / Math.max(1, n.mem);
        if (!best || room > bestRoom + 1e-9) {
          best = n;
          bestRoom = room;
        }
      }
      if (!best) return false;
      best.usedCpu += def.cpuMilli;
      best.usedMem += def.memMiB;
    }
  }
  return true;
}

const is = (entity: string, field: string, value: string | number | boolean): Condition => ({
  kind: "state",
  entity,
  field,
  op: "==",
  value,
});

const worker = (c: Case): Entity => c.workers[0] as Entity;

/**
 * How much of the allocatable resources the cluster must lose so that what is left is `keep` of what its pods ask for.
 * With one worker gone (`lostOne`) the pods of that worker cannot all be placed; with `keep` above 1 and all workers
 * standing they fit, and only the worker that sheds its pods (a disk-pressure node) makes them homeless. Read off the settings of the
 * blueprint (what the workloads ask for, what the nodes offer), so it is the same for the same world.
 */
function squeezePct(c: Case, index: BlueprintIndex, keep: number, lostOne: boolean): number {
  const asked = workloadsOfCluster(index, c.cluster.id).reduce((n, w) => {
    const def = k8sWorkloadDef(w);
    return n + def.replicas * def.cpuMilli;
  }, 0);
  const offered = c.workers.reduce((n, w) => n + k8sNodeDef(w).cpuMilli, 0);
  const left = lostOne ? offered - k8sNodeDef(worker(c)).cpuMilli : offered;
  const pct = Math.round((1 - (keep * asked) / Math.max(1, left)) * 100);
  return Math.max(10, Math.min(90, pct));
}
/** The first workload a service waits on. */
const mainWorkload = (c: Case): Entity => c.workloads[0] as Entity;

function sheet(plan: Plan, c: Case, index: BlueprintIndex): Expectation[] {
  const first = plan.inject[0] as Injection;
  const target = first.target(c);
  const host = target.kind === "k8s_node" ? nodeHost(index, target.id) : undefined;
  const healthy = allOf(c.services.map((s) => is(s.id, "status", "healthy")));
  return [
    {
      id: "diagnosis",
      kind: "diagnosis",
      label: "고장 난 곳과 고장 종류를 말해요",
      rootCause: [target.id, ...(host ? [host] : []), ...(plan.alsoRoot?.(c, index) ?? [])],
      faultType: [first.fault],
      weight: 30,
    },
    {
      id: "recovered",
      kind: "final_state",
      label: "끝났을 때 서비스가 모두 정상이에요",
      condition: healthy,
      weight: 25,
    },
    ...(plan.ending?.(c) ?? []).map(
      (e): Expectation => ({
        id: e.id,
        kind: "final_state",
        label: e.label,
        condition: e.condition,
        weight: 25,
      }),
    ),
    ...plan.forbid.map(
      (f, i): Expectation => ({
        id: `forbid-${i}`,
        kind: "forbidden_action",
        label: FORBID_WORDS[f.action] ?? f.action,
        action: f.action,
        penalty: f.penalty,
      }),
    ),
  ];
}

const FORBID_WORDS: Readonly<Partial<Record<ActionKind, string>>> = {
  k8s_drain: "노드 drain (원인이 노드가 아닌데 파드를 내보내요)",
  k8s_scale: "레플리카 수 바꾸기 (원인이 모자란 레플리카가 아니에요)",
  k8s_rollout_restart: "롤아웃 재시작 (파드가 아니라 노드·컨트롤 플레인이 원인이에요)",
};

function template(plan: Plan, domains: readonly Domain[] = ["service_os"]): ScenarioTemplate {
  return {
    id: plan.id,
    name: plan.name,
    summary: plan.summary,
    difficulty: plan.difficulty,
    faultTypes: [...new Set(plan.inject.map((i) => i.fault))],
    ownDomains: domains,
    causeDomain: "service_os",
    scoring: "recovery",
    unavailable: (index) => {
      const c = find(index, plan.minWorkers, plan.lacks);
      return typeof c === "string" ? c : undefined;
    },
    build(index, worldId) {
      const c = find(index, plan.minWorkers, plan.lacks) as Case;
      const flow = new Flow();
      let last = flow.add("start", "start", {});
      for (const [i, inj] of plan.inject.entries())
        last = flow.add(
          i === 0 ? "fault" : `also-${i}`,
          "inject_fault",
          {
            faultType: inj.fault,
            target: inj.target(c).id,
            faultParams: { ...(inj.params?.(c, index) ?? {}) },
            durationSeconds: 0,
          },
          last,
        );
      last = flow.add("wait", "wait", { seconds: plan.waitS }, last);
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
        `${c.cluster.name}에서 일어나요. 서비스 ${c.services.length}개가 이 클러스터의 워크로드에 기대요.`,
        flow,
        sheet(plan, c, index),
        plan.expectedS,
      );
    },
  };
}

const workerDown = template({
  id: "k8s-worker-down",
  name: "워커 노드가 멈췄어요",
  summary:
    "워커 노드 하나가 NotReady가 돼 그 위의 파드가 일을 못 해요. 클러스터는 5분 뒤 파드를 다른 노드로 옮겨요. 지켜보며 옮겨지는 걸 확인하고 호스트 쪽 원인을 찾거나, kubelet을 다시 시작해 바로 되돌릴 수 있어요.",
  difficulty: "쉬움",
  inject: [{ fault: "k8s_node_notready", target: worker }],
  minWorkers: 2,
  report: (s) => `${s.name}가 느려졌고 일부 요청이 실패한다는 알림이 왔다.`,
  waitS: 90,
  forbid: [],
  ending: (c) => [
    {
      id: "node-ready",
      label: "끝났을 때 노드가 다시 Ready예요",
      condition: is(worker(c).id, "status", "Ready"),
    },
  ],
});

const crashLoop = template({
  id: "k8s-crashloop",
  name: "파드가 CrashLoopBackOff예요",
  summary:
    "워크로드의 파드가 뜨자마자 죽기를 반복해요. 로그를 읽으면 원인(잘못된 설정이나 이미지)이 보이고, 고친 설정으로 롤아웃 재시작을 하면 돌아와요. 파드 하나를 지워도 새 파드가 똑같이 죽어요.",
  difficulty: "보통",
  inject: [{ fault: "k8s_pod_crashloop", target: mainWorkload }],
  minWorkers: 1,
  report: (s) => `${s.name}가 응답하지 않는다는 알림이 왔다.`,
  waitS: 150,
  forbid: [
    { action: "k8s_drain", penalty: 10 },
    { action: "k8s_scale", penalty: 5 },
  ],
});

const etcdQuorum = template({
  id: "k8s-etcd-quorum",
  name: "etcd 쿼럼을 잃었어요",
  summary:
    "etcd 멤버가 과반 넘게 멈춰 API가 답하지 않아요. 새 배포도 재스케줄도 안 되고, 마침 멈춘 노드의 파드는 옮겨지지 못해요. kubectl이 거부되는 걸로 컨트롤 플레인 문제를 알아채고, 컨트롤 플레인 팀에 넘겨야 해요(노드의 kubelet을 되살려 버틸 수는 있어요).",
  difficulty: "어려움",
  inject: [
    { fault: "k8s_etcd_quorum_lost", target: (c) => c.cluster, params: () => ({ down: 2 }) },
    { fault: "k8s_node_notready", target: worker },
  ],
  minWorkers: 2,
  report: (s) => `${s.name}가 느려졌고 배포가 안 된다는 알림이 왔다.`,
  waitS: 420,
  forbid: [
    { action: "k8s_rollout_restart", penalty: 10 },
    { action: "k8s_drain", penalty: 10 },
  ],
  timeLimitS: 5400,
  // only the control-plane team restores the members: its longest remote job (a day) and the five minutes to hand it over
  expectedS: 86400 + 300,
});

const pending = template({
  id: "k8s-pending",
  name: "자원이 모자라 파드가 Pending이에요",
  summary:
    "클러스터의 할당 가능한 자원이 줄고 노드 하나가 멈춰, 옮겨져야 할 파드가 들어갈 노드를 못 찾고 Pending으로 남아요. describe로 사유(Insufficient cpu)를 읽고, 덜 중요한 워크로드를 줄여 자리를 만들거나 노드 추가를 요청해야 해요.",
  difficulty: "어려움",
  inject: [
    {
      fault: "k8s_resource_exhausted",
      target: (c) => c.cluster,
      params: (c, index) => ({ lostPct: squeezePct(c, index, 0.88, true) }),
    },
    { fault: "k8s_node_notready", target: worker },
  ],
  minWorkers: 3,
  lacks: (c, index) =>
    idleWorkloads(c, index).length > 0
      ? undefined
      : "서비스가 기대지 않아 줄여도 되는 배치 작업이 이 클러스터에 없어요",
  report: (s) => `${s.name}가 느려졌다는 알림이 왔다.`,
  waitS: 420,
  forbid: [{ action: "k8s_drain", penalty: 10 }],
  timeLimitS: 5400,
});

const diskPressure = template({
  id: "k8s-disk-pressure",
  name: "노드 디스크가 가득 차 파드가 쫓겨났어요",
  summary:
    "노드의 디스크가 차 kubelet이 파드를 쫓아내고(Evicted) 노드가 스케줄을 막아요. 클러스터에 남은 자리가 빠듯해 쫓겨난 파드가 Pending으로 남으니, 디스크를 비우고 uncordon 해야 다시 자리가 나요.",
  difficulty: "보통",
  inject: [
    { fault: "k8s_disk_pressure", target: worker },
    {
      fault: "k8s_resource_exhausted",
      target: (c) => c.cluster,
      params: (c, index) => ({ lostPct: squeezePct(c, index, 1.4, false) }),
    },
  ],
  minWorkers: 3,
  lacks: (c, index) =>
    everyPodFits(c, index, squeezePct(c, index, 1.4, false))
      ? undefined
      : "노드를 되살려도 파드가 다 들어갈 자리가 없는 클러스터라서, 디스크를 비워도 서비스가 돌아오지 못해요",
  report: (s) => `${s.name}가 잠깐 느려졌고 노드에 디스크 경고가 떴다는 알림이 왔다.`,
  waitS: 120,
  forbid: [],
  ending: (c) => [
    {
      id: "node-schedulable",
      label: "끝났을 때 노드가 다시 파드를 받아요(디스크 압박 없음, cordon 아님)",
      condition: allOf([
        is(worker(c).id, "diskPressure", false),
        is(worker(c).id, "unschedulable", false),
      ]),
    },
  ],
});

export const K8S_TEMPLATES: readonly ScenarioTemplate[] = [
  workerDown,
  crashLoop,
  etcdQuorum,
  pending,
  diskPressure,
];
