/**
 * Workload (REQ-094, ADR-0107 item 3b): what a service is asked to do, kept on the service entity beside its
 * settings. Four plain things: what kind of work, how many requests a minute, the day's pattern, and which
 * resource it leans on most. The simulation reads two things from it, no more: the service's normal conditions
 * (a service that leans on one resource is slow sooner when that resource runs hot) and when in the day trouble
 * is likely to find it (`hourWeights`). Deeper effects (load that follows the profile, saturation) belong to the
 * operation mode and are not here.
 */
import type { Entity, PropValue } from "./blueprint";
import type { ServiceConditions } from "./service";

export type WorkloadKind = "api" | "batch" | "interactive" | "stream";
export type DayPattern = "office" | "flat" | "night" | "bursty";
export type Resource = "cpu" | "mem" | "disk" | "net";

export const WORKLOAD_KINDS: readonly WorkloadKind[] = ["api", "interactive", "batch", "stream"];
export const DAY_PATTERNS: readonly DayPattern[] = ["office", "flat", "night", "bursty"];
export const RESOURCES: readonly Resource[] = ["cpu", "mem", "disk", "net"];

export const WORKLOAD_KIND_LABELS: Readonly<Record<WorkloadKind, string>> = {
  api: "요청에 답하는 일",
  interactive: "사람이 기다리는 일",
  batch: "쌓아 두고 돌리는 일",
  stream: "계속 흘러드는 일",
};

export const DAY_PATTERN_LABELS: Readonly<Record<DayPattern, string>> = {
  office: "낮에 많아요",
  flat: "하루 내내 비슷해요",
  night: "밤에 많아요",
  bursty: "갑자기 몰려요",
};

export const RESOURCE_LABELS: Readonly<Record<Resource, string>> = {
  cpu: "CPU",
  mem: "메모리",
  disk: "디스크",
  net: "네트워크",
};

export interface WorkloadProfile {
  readonly kind: WorkloadKind;
  /** Requests a minute at the busiest hour. */
  readonly perMinute: number;
  readonly pattern: DayPattern;
  /** Shares of what it asks of the machines, summing to 1. */
  readonly shares: Readonly<Record<Resource, number>>;
}

export const WORKLOAD_LIMITS = { perMinute: { min: 1, max: 1_000_000 } } as const;

/** The profile a kind of service starts with when nobody says otherwise (each with a one-line reason on screen). */
export const DEFAULT_WORKLOAD: Readonly<Record<WorkloadKind, WorkloadProfile>> = {
  api: {
    kind: "api",
    perMinute: 600,
    pattern: "office",
    shares: { cpu: 0.4, mem: 0.3, disk: 0.1, net: 0.2 },
  },
  interactive: {
    kind: "interactive",
    perMinute: 120,
    pattern: "office",
    shares: { cpu: 0.3, mem: 0.4, disk: 0.1, net: 0.2 },
  },
  batch: {
    kind: "batch",
    perMinute: 60,
    pattern: "night",
    shares: { cpu: 0.5, mem: 0.2, disk: 0.25, net: 0.05 },
  },
  stream: {
    kind: "stream",
    perMinute: 6000,
    pattern: "flat",
    shares: { cpu: 0.2, mem: 0.2, disk: 0.3, net: 0.3 },
  },
};

const HOURS = 24;

const BUSY: Readonly<Record<DayPattern, (h: number) => number>> = {
  flat: () => 1,
  office: (h) => (h >= 9 && h < 18 ? 3 : h >= 7 && h < 21 ? 1.5 : 0.5),
  night: (h) => (h >= 22 || h < 6 ? 3 : h >= 18 || h < 8 ? 1.5 : 0.5),
  bursty: (h) => (h % 6 === 0 ? 4 : 1),
};

/** How likely trouble is to start in each hour of the day, summing to 1: busy hours weigh more. */
export function hourWeights(pattern: DayPattern): readonly number[] {
  const raw = Array.from({ length: HOURS }, (_, h) => BUSY[pattern](h));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => w / sum);
}

/** The share of the day's trouble that lands in the daytime (07-19) rather than the night. */
export function daytimeShare(pattern: DayPattern): number {
  return hourWeights(pattern).reduce((sum, w, h) => sum + (h >= 7 && h < 19 ? w : 0), 0);
}

/** The resource a profile leans on most (the first of a tie). */
export function heaviest(shares: WorkloadProfile["shares"]): Resource {
  return RESOURCES.reduce((a, b) => (shares[b] > shares[a] ? b : a));
}

export function workloadProps(w: WorkloadProfile): Record<string, PropValue> {
  return {
    workKind: w.kind,
    workPerMinute: w.perMinute,
    workPattern: w.pattern,
    workCpu: w.shares.cpu,
    workMem: w.shares.mem,
    workDisk: w.shares.disk,
    workNet: w.shares.net,
  };
}

const num = (v: PropValue | undefined, d: number): number => (typeof v === "number" ? v : d);
const oneOf = <T extends string>(list: readonly T[], v: PropValue | undefined, d: T): T =>
  list.find((x) => x === v) ?? d;

/** The workload kept on a service entity, or undefined when none was ever set. */
export function workloadOf(entity: Entity): WorkloadProfile | undefined {
  const p = entity.props;
  if (p.workKind === undefined) return undefined;
  const kind = oneOf(WORKLOAD_KINDS, p.workKind, "api");
  const base = DEFAULT_WORKLOAD[kind];
  return {
    kind,
    perMinute: num(p.workPerMinute, base.perMinute),
    pattern: oneOf(DAY_PATTERNS, p.workPattern, base.pattern),
    shares: {
      cpu: num(p.workCpu, base.shares.cpu),
      mem: num(p.workMem, base.shares.mem),
      disk: num(p.workDisk, base.shares.disk),
      net: num(p.workNet, base.shares.net),
    },
  };
}

/** Each point of a resource's share above a quarter makes the service slow this much sooner (percentage points). */
const LEAN = 20;

/**
 * The normal conditions of a service with this workload: the resource it leans on most tolerates less heat. A
 * service that is mostly CPU is slow at a lower CPU use, one that is mostly disk at a lower disk use, and so on.
 */
export function conditionsFor(w: WorkloadProfile, base: ServiceConditions): ServiceConditions {
  const cut = (share: number) => Math.max(0, share - 0.25) * LEAN;
  return {
    maxInletC: base.maxInletC,
    maxCpuUtil: Math.round((base.maxCpuUtil - cut(w.shares.cpu) / 100) * 100) / 100,
    maxMemPct: Math.round(base.maxMemPct - cut(w.shares.mem)),
    maxDiskPct: Math.round(base.maxDiskPct - cut(w.shares.disk)),
  };
}

/** A problem with a profile in words, or undefined. */
export function workloadProblem(w: WorkloadProfile): string | undefined {
  const { min, max } = WORKLOAD_LIMITS.perMinute;
  if (!Number.isFinite(w.perMinute) || w.perMinute < min || w.perMinute > max)
    return `분당 요청은 ${min}~${max}건 사이여야 해요`;
  const sum = RESOURCES.reduce((s, r) => s + w.shares[r], 0);
  if (Math.abs(sum - 1) > 0.02) return "자원 비중을 다 더하면 100%여야 해요";
  return undefined;
}
