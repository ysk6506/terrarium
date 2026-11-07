/**
 * Faults of the accelerator layer, seen as a service that stops or slows (REQ-107, ADR-0130): seven sheets, each a training
 * job or an inference pool in trouble because of one thing in a GPU, between the GPUs, in front of them or beside them. They
 * are scored recovery first (REQ-088). Where the layer heals itself (a scheduler that drains a node with a Xid after thirty
 * seconds and starts a failed job from its last checkpoint after five minutes, a pool that takes a dead replica out), an agent
 * that is quick still beats one that waits.
 *
 *   gpu-xid-error          GPU 하나가 Xid 오류로 떨어졌어요          → 그 GPU를 리셋해요 (gpu_reset)
 *   nvlink-down            노드 안 NVLink가 끊겼어요                → 노드를 빼고 잡을 다시 올려요 (node_drain, job_resume)
 *   ib-link-flap           패브릭 링크가 흔들려 학습이 느려요          → 그 노드를 빼요 (node_drain)
 *   gpu-memory-leak        추론 서버의 GPU 메모리가 새요             → GPU를 리셋해요 (gpu_reset)
 *   job-stuck-checkpoint   체크포인트 저장소가 느려 잡이 멈췄어요      → 잡을 이어 가요 (job_resume)
 *   mig-misconfig          MIG 분할이 모델과 안 맞아요              → 풀을 다시 나눠요 (pool_scale)
 *   scheduler-down-job     스케줄러가 멈춘 채 잡이 떨어졌어요         → slurmctld를 다시 시작해요 (run_command)
 */
import type { BlueprintIndex, Domain, Entity } from "@terrarium/core/world";
import { Accel } from "@terrarium/core/world";
import type { ScenarioTemplate } from "./library-kit";
import { type Case, dependents, layerTemplate, type Plan } from "./library-layer";

const OWN: readonly Domain[] = ["service_os", "virtualization", "server"];
const HOUR = 3600;

const NEED = {
  gpu: "GPU가 이 세계에 없어요 (가속기 칩 'GPU 서버'가 필요해요)",
  job: "학습 잡이 이 세계에 없어요 (가속기 칩 'GPU 학습 클러스터'가 필요해요)",
  pool: "추론 풀이 이 세계에 없어요 (가속기 칩 'GPU 서버'나 '추론 풀'이 필요해요)",
  fabric: "GPU 패브릭이 이 세계에 없어요 (가속기 칩 'GPU 학습 클러스터'가 필요해요)",
  sched: "스케줄러가 이 세계에 없어요 (가속기 칩 'GPU 학습 클러스터'가 필요해요)",
};

/** The first node of the first training job, its first GPU and the services that wait for the job. */
function jobNode(index: BlueprintIndex) {
  const job = Accel.jobsOf(index)[0];
  const node = job ? Accel.jobDef(job).nodes[0] : undefined;
  return job && node ? { job, node, services: dependents(index, job.id) } : undefined;
}

function poolNode(index: BlueprintIndex) {
  const pool = Accel.poolsOf(index)[0];
  const node = pool ? Accel.poolDef(pool).servers[0] : undefined;
  return pool && node ? { pool, node, services: dependents(index, pool.id) } : undefined;
}

const gpuOf = (index: BlueprintIndex, node: string): Entity | undefined =>
  Accel.gpusOf(index, node)[0];

function xidCase(index: BlueprintIndex): Case | string {
  const at = jobNode(index) ?? poolNode(index);
  const gpu = at ? gpuOf(index, at.node) : undefined;
  if (!at || !gpu) return NEED.gpu;
  return {
    target: gpu,
    roots: [at.node, gpu.id],
    services: at.services,
    where: `${at.node}의 ${gpu.name}`,
  };
}

function nvlinkCase(index: BlueprintIndex): Case | string {
  const at = jobNode(index);
  const nv = at ? Accel.nvlinkOf(index, at.node) : undefined;
  if (!at || !nv) return NEED.job;
  return {
    target: nv,
    roots: [nv.id, at.node],
    services: at.services,
    where: `${at.node}의 NVLink`,
  };
}

function flapCase(index: BlueprintIndex): Case | string {
  const at = jobNode(index);
  const link = at ? Accel.ibLinkOf(index, at.node) : undefined;
  if (!at || !link) return NEED.fabric;
  return {
    target: link,
    roots: [link.id, at.node],
    services: at.services,
    where: `${at.node}의 패브릭 링크`,
  };
}

function leakCase(index: BlueprintIndex): Case | string {
  const at = poolNode(index);
  const gpu = at ? gpuOf(index, at.node) : undefined;
  if (!at || !gpu) return NEED.pool;
  return {
    target: gpu,
    roots: [at.node, gpu.id],
    services: at.services,
    where: `${at.node}의 ${gpu.name}`,
  };
}

function ckptCase(index: BlueprintIndex): Case | string {
  const job = Accel.jobsOf(index)[0];
  if (!job) return NEED.job;
  return { target: job, roots: [job.id], services: dependents(index, job.id), where: job.name };
}

function migCase(index: BlueprintIndex): Case | string {
  const pool = Accel.poolsOf(index).find((p) => Accel.poolDef(p).mig);
  if (!pool) return NEED.pool;
  return { target: pool, roots: [pool.id], services: dependents(index, pool.id), where: pool.name };
}

function schedulerCase(index: BlueprintIndex): Case | string {
  const sched = Accel.schedulerOf(index);
  const at = jobNode(index);
  const gpu = at ? gpuOf(index, at.node) : undefined;
  if (!sched || !at || !gpu) return NEED.sched;
  const host = index.outgoing(sched.id, "hosted_on")[0]?.to;
  return {
    target: sched,
    roots: host ? [sched.id, host] : [sched.id],
    services: at.services,
    where: `${sched.name}`,
    more: [{ fault: "gpu_xid_error", target: gpu.id }],
  };
}

const FORBID = [{ action: "power_off", penalty: 15 }] as const;

const plan = (
  p: Partial<Plan> & Pick<Plan, "id" | "name" | "summary" | "fault" | "find" | "report">,
): ScenarioTemplate =>
  layerTemplate({
    difficulty: "보통",
    waitS: 30,
    forbid: FORBID,
    timeLimitS: 2 * HOUR,
    budget: 40,
    own: OWN,
    cause: "server",
    recovery: true,
    ...p,
  });

const xid = plan({
  id: "gpu-xid-error",
  name: "GPU 하나가 Xid 오류로 떨어졌어요",
  summary:
    "GPU 하나가 Xid 79(GPU가 버스에서 떨어짐)를 내요. 그 노드의 학습 잡이 죽거나 추론 복제본이 빠져 서비스가 느려지거나 멈춰요. 스케줄러가 30초 뒤 노드를 빼고 잡은 5분 뒤 체크포인트부터 스스로 다시 올라오지만, 그 GPU를 리셋해야 노드가 돌아와요.",
  fault: "gpu_xid_error",
  faultParams: { code: 79 },
  find: xidCase,
  report: (c) =>
    `${c.services[0]?.name ?? "서비스"}가 갑자기 느려지거나 멈췄다는 알림이 왔다. GPU 서버 쪽 같다.`,
  wanted: [{ action: "gpu_reset", weight: 15 }],
});

const nvlink = plan({
  id: "nvlink-down",
  name: "노드 안 NVLink가 끊겼어요",
  summary:
    "GPU 서버 안 NVLink가 끊겨 학습 잡이 죽어요. GPU 자체는 멀쩡해 보여요. 스케줄러는 5분 뒤 예비 노드로 잡을 다시 올리지만, 노드를 빼고 잡을 바로 이어 주면 더 빨라요. NVLink 수리는 하드웨어 팀 몫이에요.",
  fault: "nvlink_down",
  find: nvlinkCase,
  report: (c) =>
    `${c.services[0]?.name ?? "학습"}이 멈췄다는 알림이 왔다. GPU 상태는 멀쩡해 보인다.`,
  wanted: [{ action: "node_drain", weight: 15 }],
});

const flap = plan({
  id: "ib-link-flap",
  name: "패브릭 링크가 흔들려 학습이 느려요",
  summary:
    "InfiniBand 링크 하나가 끊겼다 붙기를 되풀이해 모든 노드의 스텝이 느려져요. 3분쯤 지나면 NCCL 타임아웃으로 잡이 죽어요. GPU도 서버도 멀쩡해 보여요. 그 노드를 빼고 잡을 이어 주면 돌아와요.",
  fault: "ib_link_flap",
  find: flapCase,
  report: (c) =>
    `${c.services[0]?.name ?? "학습"}의 스텝이 갑자기 느려졌다는 알림이 왔다. 서버는 멀쩡해 보인다.`,
  cause: "network",
  own: ["service_os", "virtualization", "server", "network"],
  wanted: [{ action: "node_drain", weight: 15 }],
});

const leak = plan({
  id: "gpu-memory-leak",
  name: "추론 서버의 GPU 메모리가 새요",
  summary:
    "추론 프로세스가 GPU 메모리를 쥔 채 놓지 않아 1분쯤 뒤 메모리가 가득 차 죽어요. 풀이 90초 뒤 다시 띄우지만 새는 건 그대로라 같은 일이 되풀이돼요. 그 GPU를 리셋해 새는 프로세스를 정리해야 멈춰요.",
  fault: "gpu_memory_leak_inference",
  faultParams: { giBPerMin: 20 },
  find: leakCase,
  report: (c) => `${c.services[0]?.name ?? "추론"}이 몇 분 간격으로 끊긴다는 알림이 왔다.`,
  waitS: 120,
  wanted: [{ action: "gpu_reset", weight: 15 }],
});

const stuck = plan({
  id: "job-stuck-checkpoint",
  name: "체크포인트 저장소가 느려 잡이 멈췄어요",
  summary:
    "체크포인트 저장소가 느려 학습 잡이 쓰기를 기다리며 멈춰 있어요. GPU는 놀고 있고 오래 두면 마지막 체크포인트가 깨져 처음부터 다시 해야 해요. 저장소가 돌아온 걸 확인하고 잡을 이어 주면 돼요.",
  fault: "job_stuck_checkpoint",
  find: ckptCase,
  report: (c) =>
    `${c.services[0]?.name ?? "학습"}이 진행되지 않는다는 알림이 왔다. GPU 사용률이 바닥이다.`,
  cause: "storage",
  own: ["service_os", "virtualization", "server", "storage"],
  wanted: [{ action: "job_resume", weight: 15 }],
});

const mig = plan({
  id: "mig-misconfig",
  name: "MIG 분할이 모델과 안 맞아요",
  summary:
    "GPU를 쪼개는 MIG 설정이 모델이 필요로 하는 메모리와 안 맞아 복제본이 절반밖에 못 떠요. 서버도 GPU도 멀쩡하고 응답이 느려져요. 풀을 올바른 분할로 다시 나눠 복제본 수를 맞추면 돌아와요.",
  fault: "mig_misconfig",
  find: migCase,
  report: (c) =>
    `${c.services[0]?.name ?? "추론"}의 응답이 느려졌다는 알림이 왔다. 서버는 멀쩡해 보인다.`,
  cause: "service_os",
  own: ["service_os", "virtualization"],
  wanted: [{ action: "pool_scale", weight: 15 }],
});

const schedulerDown = plan({
  id: "scheduler-down-job",
  name: "스케줄러가 멈춘 채 잡이 떨어졌어요",
  summary:
    "GPU 하나가 떨어져 학습 잡이 죽었는데 스케줄러(slurmctld)까지 멈춰 있어요. 스케줄러가 살아야 잡을 다시 올리니 기다려도 돌아오지 않아요. 스케줄러가 선 호스트에서 slurmctld를 다시 시작해야 해요.",
  fault: "scheduler_down",
  find: schedulerCase,
  report: (c) => `${c.services[0]?.name ?? "학습"}이 죽었는데 몇 분이 지나도 다시 올라오지 않는다.`,
  cause: "service_os",
  own: ["service_os", "virtualization"],
  difficulty: "어려움",
  budget: 60,
  wanted: [{ action: "process_restart", weight: 15 }],
});

export const ACCEL_TEMPLATES: readonly ScenarioTemplate[] = [
  xid,
  nvlink,
  flap,
  leak,
  stuck,
  mig,
  schedulerDown,
];
