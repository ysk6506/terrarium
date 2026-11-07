/**
 * What a service is asked to carry (REQ-109, ADR-0132): five plain numbers on every catalog card. "알아서" reads them to
 * pick the layers, and the sizing of the world (rooms, racks, servers) starts from them. They are numbers a person can
 * say out loud ("초당 300건, 데이터 2 TB, 동시 사용자 1,200명, 1분까지는 멈춰도 돼요"), not a model of traffic: the
 * time-of-day and resource shape of the work stay in `WorkloadProfile` (`workload.ts`).
 */

export interface ServiceLoad {
  /** Requests a second at the busy hour. */
  readonly rps: number;
  /** Data it keeps, in GB (decimal: 1 TB = 1,000 GB). */
  readonly dataGB: number;
  /** People using it at the same time. */
  readonly users: number;
  /** The longest it may stand still before people are hurt, in seconds ("허용 중단"). */
  readonly maxDowntimeS: number;
  /** GPU hours of training it runs in a month; absent or 0: no GPU work of its own. */
  readonly gpuHours?: number;
}

export const LOAD_LIMITS = {
  rps: { min: 0, max: 1_000_000 },
  dataGB: { min: 0, max: 10_000_000 },
  users: { min: 0, max: 10_000_000 },
  maxDowntimeS: { min: 1, max: 604_800 },
  gpuHours: { min: 0, max: 10_000_000 },
} as const satisfies Record<keyof ServiceLoad, { min: number; max: number }>;

export const LOAD_FIELDS = ["rps", "dataGB", "users", "maxDowntimeS", "gpuHours"] as const;

/** The words of each number, as the screen and the reasons say them. */
export const LOAD_LABELS: Readonly<Record<keyof ServiceLoad, { name: string; unit: string }>> = {
  rps: { name: "초당 요청", unit: "건" },
  dataGB: { name: "데이터", unit: "GB" },
  users: { name: "동시 사용자", unit: "명" },
  maxDowntimeS: { name: "허용 중단", unit: "초" },
  gpuHours: { name: "GPU 학습", unit: "시간" },
};

/** What is wrong with a load, in words, or undefined. */
export function loadProblem(load: ServiceLoad): string | undefined {
  for (const key of LOAD_FIELDS) {
    const v = load[key];
    if (v === undefined && key === "gpuHours") continue;
    const { min, max } = LOAD_LIMITS[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
      return `${LOAD_LABELS[key].name}은 ${min.toLocaleString("ko-KR")}~${max.toLocaleString("ko-KR")}${LOAD_LABELS[key].unit} 사이로 적어 주세요`;
  }
  return undefined;
}

const group = (n: number): string => Math.round(n).toLocaleString("ko-KR");

/** "2 TB", "300 GB": data the way a person says it (decimal terabytes from 1,000 GB). */
export function dataText(gb: number): string {
  if (gb < 1_000) return `${group(gb)} GB`;
  const tb = gb / 1_000;
  return `${Number.isInteger(tb) ? group(tb) : tb.toFixed(1)} TB`;
}

/** "30초", "1분", "1분 30초", "2시간": how long a stop is allowed to last. */
export function downtimeText(seconds: number): string {
  if (seconds < 60) return `${group(seconds)}초`;
  if (seconds < 3_600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return s === 0 ? `${m}분` : `${m}분 ${s}초`;
  }
  const h = seconds / 3_600;
  return `${Number.isInteger(h) ? group(h) : h.toFixed(1)}시간`;
}

/** "초당 300 · 2 TB · 사용자 1,200 · 중단 허용 1분" (a training card adds "GPU 5,000시간"): the one grey line of a card row. */
export function loadText(load: ServiceLoad): string {
  const parts = [
    `초당 ${group(load.rps)}`,
    dataText(load.dataGB),
    `사용자 ${group(load.users)}`,
    `중단 허용 ${downtimeText(load.maxDowntimeS)}`,
  ];
  if (load.gpuHours && load.gpuHours > 0) parts.push(`GPU ${group(load.gpuHours)}시간`);
  return parts.join(" · ");
}

/** The same numbers with zero for what is not set, for code that adds services up. */
export const whole = (load: ServiceLoad): Required<ServiceLoad> => ({
  ...load,
  gpuHours: load.gpuHours ?? 0,
});
