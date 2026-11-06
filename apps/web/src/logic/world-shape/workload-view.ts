/**
 * The workload screen (ADR-0107 item 3b): what the work is, how much, when, and what it leans on. Everything starts
 * on a guess with a one-line reason, and "이 일감이면" says which of the shape's faults hurt this work most and least,
 * and how many scenarios land in the day and in the night.
 */

import { withJosa } from "@terrarium/core/kernel";
import type { ScopeKey } from "@terrarium/core/scenario";
import { problemName } from "@terrarium/core/scenario";
import {
  DEFAULT_WORKLOAD,
  daytimeShare,
  heaviest,
  RESOURCE_LABELS,
  type Resource,
  type ServiceKind,
  type WorkloadKind,
  type WorkloadProfile,
} from "@terrarium/core/world";

/** Which resource a fault bites into, when it bites into one. */
const RESOURCE_OF: Readonly<Partial<Record<ScopeKey, Resource>>> = {
  cpu_runaway: "cpu",
  vm_cpu_spike: "cpu",
  memory_leak: "mem",
  disk_failure: "disk",
  disk_full: "disk",
  log_flood: "disk",
  fs_readonly: "disk",
  link_down: "net",
  switch_failure: "net",
  port_vlan_mismatch: "net",
  port_shutdown: "net",
  route_missing: "net",
  bgp_neighbor_shutdown: "net",
  dns_failure: "net",
};

const KIND_WHY: Readonly<Record<WorkloadKind, string>> = {
  api: "요청을 받아 답하는 서비스라서",
  interactive: "사람이 결과를 기다리는 서비스라서",
  batch: "쌓아 두고 돌리는 서비스라서",
  stream: "상태를 계속 쓰고 읽는 서비스라서",
};

const PATTERN_WHY: Readonly<Record<WorkloadProfile["pattern"], string>> = {
  office: "쓰는 사람이 일하는 낮에 많다고 봤어요",
  flat: "하루 내내 비슷하게 온다고 봤어요",
  night: "밤에 몰아서 돌린다고 봤어요",
  bursty: "갑자기 몰려 온다고 봤어요",
};

/** What a kind of service most likely is: a plain request service, a batch one, or one that keeps state. */
export function guessKind(kind: ServiceKind): WorkloadKind {
  if (kind === "batch") return "batch";
  return kind === "stateful" ? "stream" : "api";
}

/** A profile for a kind of work, with the sentence that says why (each sentence is about what is shown now). */
export function guessWorkload(service: {
  kind: ServiceKind;
  name?: string;
  workload?: WorkloadProfile;
}): {
  profile: WorkloadProfile;
  why: Readonly<Record<"kind" | "rate" | "pattern" | "shares", string>>;
} {
  const w = service.workload ?? DEFAULT_WORKLOAD[guessKind(service.kind)];
  return {
    profile: w,
    why: {
      kind: `알아서 ${KIND_WHY[w.kind]}`,
      rate: "알아서 이런 서비스가 흔히 받는 만큼으로 봤어요",
      pattern: `알아서 ${PATTERN_WHY[w.pattern]}`,
      shares: `알아서 ${withJosa(RESOURCE_LABELS[heaviest(w.shares)], "을")} 가장 많이 쓴다고 봤어요`,
    },
  };
}

export interface WorkloadView {
  readonly hardest: readonly string[];
  readonly easiest: readonly string[];
  readonly day: number;
  readonly night: number;
}

/** What this work does to the shape: which faults hurt most and least, and when the scenarios fall. */
export function workloadView(
  w: WorkloadProfile,
  problems: readonly ScopeKey[],
  scenarios: number,
): WorkloadView {
  const lean = heaviest(w.shares);
  const hard = problems.filter((p) => RESOURCE_OF[p] === lean);
  const spare = (Object.keys(w.shares) as Resource[]).reduce((a, b) =>
    w.shares[b] < w.shares[a] ? b : a,
  );
  const easy = problems.filter((p) => RESOURCE_OF[p] === spare && spare !== lean);
  const day = Math.round(scenarios * daytimeShare(w.pattern));
  return {
    hardest: hard.slice(0, 3).map(problemName),
    easiest: easy.slice(0, 3).map(problemName),
    day,
    night: scenarios - day,
  };
}
