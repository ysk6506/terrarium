/**
 * What "서비스부터" starts with (ADR-0108): IAP, the platform the closed beta's own team runs, already chosen; the
 * "보통" ladders; and a custom service with nothing in it but a name. The numbers are an example the person
 * presses to change (VM and host counts are the real IAP shape, to be corrected by the team that owns it).
 */
import {
  DEFAULT_WORKLOAD,
  type Layers,
  type ServiceKind,
  type WorkloadProfile,
} from "@terrarium/core/world";
import type { HarmTier, ServiceDraft, ShapeSpec } from "./shaped-plan";

export const IAP_HARM: readonly HarmTier[] = [
  { name: "컨트롤 플레인 멈춤 · 배포만 막힘", perHourKrw: 300_000 },
  { name: "에이전트 응답 없음 · 파트원 40명", perHourKrw: 2_000_000 },
  { name: "그래프 DB 멈춤 · 전부 멈춤", perHourKrw: 5_000_000 },
];

export const IAP_WORKLOAD: WorkloadProfile = {
  kind: "interactive",
  perMinute: 90,
  pattern: "office",
  shares: { cpu: 0.25, mem: 0.45, disk: 0.2, net: 0.1 },
};

export const IAP_DRAFT: ServiceDraft = {
  key: "iap",
  name: "IAP",
  gives:
    "VM 위에 직접 만든 쿠버네티스 클러스터에서 도메인 에이전트·오케스트레이터·인프라 토폴로지 그래프가 돌아요. 파트원들이 쓰는 플랫폼이에요.",
  stopsText: "에이전트가 답하지 못하고 새 배포가 막혀요",
  kind: "request",
  nodes: 9,
  hosts: 3,
  switches: 2,
  parts: [
    { label: "오케스트레이터", tier: 0, workload: "orchestrator" },
    { label: "도메인 에이전트", count: 4, tier: 0, workload: "domain-agents" },
    { label: "토폴로지 그래프 DB", tier: 0, workload: "topology-graph" },
    { label: "GoClaw 코어", tier: 0, workload: "goclaw-core" },
    { label: "컨트롤 플레인 VM", count: 3, tier: 1, role: "node" },
    { label: "워커 VM", count: 6, tier: 1, role: "node" },
    { label: "가상화 호스트", count: 3, tier: 2, role: "host" },
    { label: "공유 스토리지", tier: 2 },
    { label: "스위치", count: 2, tier: 2, role: "switch" },
  ],
  stops: [
    { what: "워커 VM 하나", result: "파드가 옆으로 옮겨가요 · 잠깐 느림" },
    { what: "컨트롤 플레인", result: "새 배포·스케줄이 멈춰요 · 돌던 파드는 돌아가요" },
    { what: "호스트 하나", result: "그 위 VM 3대가 같이 멈춰요 → 에이전트 일부 응답 없음" },
    {
      what: "그래프 DB·스토리지",
      result: "오케스트레이터가 답을 못 해요 · 파트 전체 멈춤",
      bad: true,
    },
  ],
  harm: IAP_HARM,
  workload: IAP_WORKLOAD,
};

/** "보통": a virtualised cluster on a leaf-spine network, A+B feeds, N+1 cooling, one room. */
export const MIDDLE_LAYERS: Layers = {
  network: "net-leaf-spine",
  compute: "cmp-virt-ha",
  storage: "sto-shared",
  database: "db-primary-secondary",
  app: "app-lb-sticky",
  power: "pwr-ab",
  cooling: "cool-n1",
  site: "site-one-room",
};

/** IAP is a Kubernetes built by hand on VMs (REQ-096): its world starts with the container choice for compute. */
export const IAP_LAYERS: Layers = { ...MIDDLE_LAYERS, compute: "cmp-containers" };

export const DEFAULT_SHAPE: ShapeSpec = {
  name: "IAP 실험용",
  seed: 1,
  site: "hwaseong",
  servers: 480,
  layers: IAP_LAYERS,
  services: [IAP_DRAFT],
};

/** A service the person adds by name, what it gives and what its stop does. */
export function customService(
  n: number,
  fields: { name: string; gives: string; stopsText: string; kind?: ServiceKind },
): ServiceDraft {
  const kind = fields.kind ?? "request";
  return {
    key: `svc${n}`,
    name: fields.name,
    gives: fields.gives,
    stopsText: fields.stopsText,
    kind,
    nodes: 3,
    hosts: 3,
    switches: 2,
    parts: [
      { label: "VM", count: 3, tier: 1, role: "node" },
      { label: "호스트", count: 3, tier: 2, role: "host" },
      { label: "스위치", count: 2, tier: 2, role: "switch" },
    ],
    stops: [{ what: fields.name, result: fields.stopsText, bad: true }],
    harm: [{ name: "멈춤", perHourKrw: 1_000_000 }],
    workload: kind === "batch" ? DEFAULT_WORKLOAD.batch : DEFAULT_WORKLOAD.api,
  };
}
