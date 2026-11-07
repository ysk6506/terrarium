/**
 * How long a fault takes to be gone once it is handed to its domain's team (REQ-093, ADR-0100). The table is
 * docs/design-docs/lead-times.md as data: for each fault type a minimum, a typical and a maximum (5th, 50th and 95th
 * percentile of a log-normal, in world seconds). A run draws one value per fault from its seed, so the same seed
 * gives the same wait.
 *
 * Four kinds of work, because the rules differ:
 *   remote    a setting or a restart done over the network: no one travels, no night or weekend surcharge
 *   visit     someone must go there, but no part is needed (a breaker, a switch over to manual)
 *   replace   a part is changed: with a spare in the building it is the `spare` range; without one the part is
 *             ordered, and the `ordered` range is stretched or squeezed by the vendor's SLA
 *   external  the utility or someone else outside the building; nothing a setting changes
 *
 * What the experiment sets (`LeadTimeSettings`) overrides the defaults: the vendor SLA (4 hours / next business day /
 * 3 days) scales the ordered ranges, the spares (default per part / all / none) pick which range a replacement uses,
 * and the night and weekend surcharge (typical and maximum × 1.5) applies to anything done on site.
 */
import { formatDuration } from "@terrarium/core/kernel";
import type { FaultType } from "./faults";

/** Seconds: minimum, typical, maximum. */
export type Range = readonly [min: number, typ: number, max: number];

const M = 60;
const H = 3600;
const D = 86_400;

export type WorkKind = "remote" | "visit" | "replace" | "external";

export interface LeadRow {
  readonly kind: WorkKind;
  /** Who does it, as a person would say: the domain's team, or the vendor when parts or its engineer are needed. */
  readonly who: "team" | "vendor";
  /** With the part in the building (replace) or the only range (the other kinds). */
  readonly spare: Range;
  /** Without the part: the vendor sends it (replace only), for a next-business-day contract. */
  readonly ordered?: Range;
  /** Whether the building has the spare unless the experiment says otherwise (replace only). */
  readonly spareDefault?: boolean;
}

const remote = (r: Range): LeadRow => ({ kind: "remote", who: "team", spare: r });
const visit = (r: Range): LeadRow => ({ kind: "visit", who: "team", spare: r });
const external = (r: Range): LeadRow => ({ kind: "external", who: "team", spare: r });
const replace = (spare: Range, ordered: Range, spareDefault: boolean): LeadRow => ({
  kind: "replace",
  who: "vendor",
  spare,
  ordered,
  spareDefault,
});

/** Every fault type has a row; a missing one fails the build. Values: docs/design-docs/lead-times.md. */
export const LEAD_ROWS: Readonly<Record<FaultType, LeadRow>> = {
  // 데이터센터 인프라
  cooling_unit_failure: replace([1 * H, 3 * H, 8 * H], [2 * H, 8 * H, 36 * H], false),
  cooling_unit_degraded: replace([1 * H, 4 * H, 24 * H], [4 * H, 1 * D, 3 * D], true),
  setpoint_drift: remote([15 * M, 45 * M, 2 * H]),
  chiller_failure: replace([4 * H, 12 * H, 2 * D], [8 * H, 2 * D, 14 * D], false),
  chiller_degraded: replace([2 * H, 6 * H, 1 * D], [4 * H, 1 * D, 5 * D], false),
  cdu_failure: replace([2 * H, 6 * H, 1 * D], [4 * H, 1 * D, 3 * D], false),
  cdu_pump_failure: replace([2 * H, 4 * H, 12 * H], [4 * H, 12 * H, 2 * D], false),
  coolant_leak: replace([1 * H, 4 * H, 12 * H], [2 * H, 8 * H, 2 * D], false),
  immersion_circulation_failure: replace([2 * H, 4 * H, 12 * H], [4 * H, 12 * H, 2 * D], false),
  breaker_trip: visit([30 * M, 1 * H, 3 * H]),
  ups_battery_degraded: replace([4 * H, 8 * H, 1 * D], [1 * D, 2 * D, 5 * D], false),
  generator_start_failure: replace([2 * H, 6 * H, 1 * D], [8 * H, 1 * D, 3 * D], true),
  ats_stuck: visit([2 * H, 4 * H, 1 * D]),
  grid_outage: external([30 * M, 3 * H, 8 * H]),
  utility_outage: external([30 * M, 3 * H, 8 * H]),
  sensor_drift: replace([2 * H, 4 * H, 1 * D], [4 * H, 1 * D, 3 * D], false),
  // 서버
  fan_failure: replace([1 * H, 3 * H, 1 * D], [8 * H, 1 * D, 3 * D], true),
  psu_failure: replace([1 * H, 3 * H, 1 * D], [8 * H, 1 * D, 3 * D], true),
  bmc_unresponsive: replace([30 * M, 1 * H, 4 * H], [30 * M, 2 * H, 3 * D], false),
  memory_failure: replace([4 * H, 1 * D, 3 * D], [1 * D, 2 * D, 5 * D], true),
  firmware_update_failure: remote([30 * M, 1 * H, 4 * H]),
  // 네트워크
  link_down: replace([1 * H, 3 * H, 1 * D], [8 * H, 1 * D, 3 * D], true),
  switch_failure: replace([1 * H, 3 * H, 8 * H], [4 * H, 1 * D, 3 * D], false),
  // 스토리지
  disk_failure: replace([1 * H, 2 * H, 1 * D], [8 * H, 1 * D, 3 * D], true),
  // 가상화
  vm_cpu_spike: remote([15 * M, 30 * M, 2 * H]),
  // 서비스/OS
  cpu_runaway: remote([15 * M, 30 * M, 2 * H]),
  disk_full: remote([15 * M, 30 * M, 1 * H]),
  log_flood: remote([15 * M, 30 * M, 1 * H]),
  memory_leak: remote([15 * M, 45 * M, 2 * H]),
  process_crashloop: remote([15 * M, 45 * M, 2 * H]),
  zombie_pileup: remote([15 * M, 45 * M, 2 * H]),
  fs_readonly: remote([30 * M, 1 * H, 4 * H]),
  ntp_drift: remote([15 * M, 30 * M, 2 * H]),
  dns_failure: remote([15 * M, 30 * M, 2 * H]),
  kernel_panic: remote([15 * M, 30 * M, 2 * H]),
  cert_expired: remote([30 * M, 1 * H, 4 * H]),
  // 데이터베이스 (서비스/OS 팀)
  db_primary_down: remote([30 * M, 1 * H, 4 * H]),
  db_secondary_down: remote([15 * M, 30 * M, 2 * H]),
  db_replication_broken: remote([15 * M, 45 * M, 2 * H]),
  db_split_brain: remote([30 * M, 1 * H, 4 * H]),
  db_backup_corrupt: remote([1 * H, 4 * H, 1 * D]),
  // 스토리지 HA
  storage_path_cut: visit([30 * M, 1 * H, 4 * H]),
  storage_controller_failure: replace([2 * H, 4 * H, 1 * D], [8 * H, 1 * D, 3 * D], false),
  storage_node_lost: replace([2 * H, 6 * H, 1 * D], [8 * H, 1 * D, 3 * D], false),
  // SDN 오버레이·클라우드 네이티브 네트워크 (네트워크 팀)
  sdn_controller_down: remote([30 * M, 1 * H, 4 * H]),
  sdn_sync_failed: remote([15 * M, 30 * M, 2 * H]),
  vxlan_tunnel_down: visit([30 * M, 1 * H, 4 * H]),
  evpn_session_flap: remote([30 * M, 1 * H, 4 * H]),
  ingress_controller_down: remote([15 * M, 30 * M, 2 * H]),
  cni_plugin_failure: remote([15 * M, 45 * M, 2 * H]),
  nfv_firewall_overload: remote([1 * H, 4 * H, 1 * D]),
  // 컨테이너 (서비스/OS 팀)
  k8s_node_notready: remote([15 * M, 30 * M, 2 * H]),
  k8s_control_plane_down: remote([30 * M, 1 * H, 4 * H]),
  k8s_etcd_quorum_lost: remote([1 * H, 3 * H, 1 * D]),
  k8s_pod_crashloop: remote([15 * M, 30 * M, 2 * H]),
  k8s_resource_exhausted: remote([1 * H, 4 * H, 1 * D]),
  k8s_image_pull_failure: remote([30 * M, 1 * H, 4 * H]),
  k8s_disk_pressure: remote([15 * M, 30 * M, 2 * H]),
  k8s_cni_failure: remote([30 * M, 1 * H, 4 * H]),
  // 애플리케이션 (서비스/OS 팀)
  lb_backend_flapping: remote([15 * M, 30 * M, 2 * H]),
  session_store_down: remote([15 * M, 30 * M, 2 * H]),
  circuit_breaker_stuck_open: remote([15 * M, 30 * M, 2 * H]),
  retry_storm: remote([15 * M, 45 * M, 2 * H]),
  sidecar_crash: remote([15 * M, 30 * M, 2 * H]),
  mesh_control_down: remote([30 * M, 1 * H, 4 * H]),
  region_down: external([1 * H, 4 * H, 1 * D]),
  replication_lag_high: remote([30 * M, 2 * H, 8 * H]),
  // 사이트·DR, 지역 복제, 합의 DB, 관리형 DB (REQ-106)
  site_power_loss: external([2 * H, 8 * H, 2 * D]),
  wan_link_down: external([1 * H, 4 * H, 1 * D]),
  wan_degraded: external([1 * H, 4 * H, 1 * D]),
  replication_broken: remote([30 * M, 2 * H, 8 * H]),
  dr_failover_stuck: remote([15 * M, 1 * H, 4 * H]),
  split_brain: remote([30 * M, 2 * H, 8 * H]),
  dr_site_stale: remote([1 * H, 4 * H, 1 * D]),
  geo_replication_lag: remote([30 * M, 2 * H, 8 * H]),
  geo_replica_broken: remote([1 * H, 4 * H, 1 * D]),
  db_leader_lost: remote([5 * M, 30 * M, 2 * H]),
  db_quorum_lost: remote([15 * M, 1 * H, 4 * H]),
  db_node_lagging: remote([15 * M, 1 * H, 4 * H]),
  db_az_failure: external([30 * M, 2 * H, 8 * H]),
  db_failover_flapping: remote([30 * M, 2 * H, 8 * H]),
  db_storage_full: remote([15 * M, 1 * H, 4 * H]),
  // 가속기 층·전원·냉방 확장 (REQ-107)
  gpu_xid_error: replace([2 * H, 6 * H, 1 * D], [1 * D, 3 * D, 7 * D], false),
  nvlink_down: replace([2 * H, 8 * H, 1 * D], [1 * D, 3 * D, 7 * D], false),
  ib_link_flap: visit([1 * H, 4 * H, 12 * H]),
  gpu_thermal_throttle: visit([1 * H, 4 * H, 1 * D]),
  gpu_memory_leak_inference: remote([15 * M, 1 * H, 4 * H]),
  job_stuck_checkpoint: remote([15 * M, 1 * H, 4 * H]),
  scheduler_down: remote([15 * M, 45 * M, 2 * H]),
  mig_misconfig: remote([15 * M, 45 * M, 2 * H]),
  bbu_cell_fault: replace([2 * H, 6 * H, 1 * D], [1 * D, 3 * D, 7 * D], true),
  dc_bus_sag: visit([2 * H, 8 * H, 1 * D]),
  utility_feed_loss: external([1 * H, 4 * H, 1 * D]),
  transformer_overtemp: replace([4 * H, 12 * H, 2 * D], [3 * D, 10 * D, 30 * D], false),
  ups_module_fail: replace([2 * H, 6 * H, 1 * D], [1 * D, 3 * D, 7 * D], true),
  rdhx_valve_stuck: visit([2 * H, 6 * H, 1 * D]),
  fluid_level_low: visit([1 * H, 4 * H, 12 * H]),
};

// ---------- what the experiment sets ----------

export type VendorSla = "4h" | "nbd" | "3d";
export type SpareSetting = "default" | "yes" | "no";
export type StartKind = "weekday_day" | "weekday_night" | "weekend";

export interface LeadTimeSettings {
  /** The vendor's promise for parts and an engineer: 4 hours, next business day (default) or 3 days. */
  readonly vendorSla?: VendorSla;
  /** Spare parts in the building: per part as the table says (default), all of them, or none. */
  readonly spares?: SpareSetting;
  /** Whether work done on site at night or on a weekend takes 1.5 times as long (default yes). */
  readonly afterHours?: boolean;
  /** When the agent gets the task: a weekday daytime (default), a weekday night or a weekend. */
  readonly start?: StartKind;
}

export const DEFAULT_LEAD_SETTINGS: Required<LeadTimeSettings> = {
  vendorSla: "nbd",
  spares: "default",
  afterHours: true,
  start: "weekday_day",
};

export const SLA_LABELS: Readonly<Record<VendorSla, string>> = {
  "4h": "4시간",
  nbd: "익일",
  "3d": "3일",
};
export const SPARE_LABELS: Readonly<Record<SpareSetting, string>> = {
  default: "부품마다 기본값",
  yes: "모두 있음",
  no: "모두 없음",
};
export const START_LABELS: Readonly<Record<StartKind, string>> = {
  weekday_day: "평일 낮",
  weekday_night: "평일 밤",
  weekend: "주말",
};

/** How much the vendor's ordered ranges stretch with the SLA (next business day is the table). */
export const SLA_FACTOR: Readonly<Record<VendorSla, number>> = { "4h": 0.25, nbd: 1, "3d": 3 };
/** Night and weekend work takes this much longer (typical and maximum). */
export const AFTER_HOURS_FACTOR = 1.5;
/** An ordered part never arrives sooner than this, whatever the SLA. */
const ORDER_FLOOR_S = 1 * H;

export const resolveLeadSettings = (s?: LeadTimeSettings): Required<LeadTimeSettings> => ({
  vendorSla: s?.vendorSla ?? DEFAULT_LEAD_SETTINGS.vendorSla,
  spares: s?.spares ?? DEFAULT_LEAD_SETTINGS.spares,
  afterHours: s?.afterHours ?? DEFAULT_LEAD_SETTINGS.afterHours,
  start: s?.start ?? DEFAULT_LEAD_SETTINGS.start,
});

export function isDefaultLeadSettings(s?: LeadTimeSettings): boolean {
  const r = resolveLeadSettings(s);
  return (Object.keys(DEFAULT_LEAD_SETTINGS) as Array<keyof typeof r>).every(
    (k) => r[k] === DEFAULT_LEAD_SETTINGS[k],
  );
}

/** What a result says about the settings the run had: "기본값" or what was changed. */
export function describeLeadSettings(s?: LeadTimeSettings): string {
  if (isDefaultLeadSettings(s)) return "기본값";
  const r = resolveLeadSettings(s);
  return [
    `벤더 ${SLA_LABELS[r.vendorSla]}`,
    `예비 부품 ${SPARE_LABELS[r.spares]}`,
    r.afterHours ? "야간·주말 ×1.5" : "야간·주말 가산 없음",
    `${START_LABELS[r.start]}에 시작`,
  ].join(" · ");
}

// ---------- the clock the surcharge reads ----------

export interface Clock {
  /** 0 = Monday … 6 = Sunday. */
  readonly weekday: number;
  readonly hour: number;
}

const START_AT: Readonly<Record<StartKind, Clock>> = {
  weekday_day: { weekday: 1, hour: 10 },
  weekday_night: { weekday: 1, hour: 22 },
  weekend: { weekday: 5, hour: 10 },
};

/** The day and hour at world time `t`, when the agent got the task at `originT`. */
export function clockAt(t: number, originT: number, start: StartKind): Clock {
  const from = START_AT[start];
  const hours = from.hour + Math.floor(Math.max(0, t - originT) / H);
  return { weekday: (from.weekday + Math.floor(hours / 24)) % 7, hour: hours % 24 };
}

/** Evenings from 18:00, nights until 08:00 and the whole weekend. */
export const isAfterHours = (c: Clock): boolean => c.weekday >= 5 || c.hour >= 18 || c.hour < 8;

// ---------- the range of one fault ----------

export interface LeadRange {
  readonly min: number;
  readonly typ: number;
  readonly max: number;
  readonly kind: WorkKind;
  readonly who: "team" | "vendor";
  /** For a replacement: whether the part was in the building. */
  readonly spare?: boolean;
  /** Whether the night and weekend surcharge was applied. */
  readonly surcharged: boolean;
}

const scale = (r: Range, f: number, floor = 0): Range => [
  Math.max(floor, r[0] * f),
  Math.max(floor, r[1] * f),
  Math.max(floor, r[2] * f),
];

const hasSpare = (row: LeadRow, spares: SpareSetting): boolean =>
  spares === "yes" ? true : spares === "no" ? false : (row.spareDefault ?? true);

/** The range a fault takes when handed over at `at`, under the experiment's settings. */
export function leadRange(
  type: FaultType,
  settings: LeadTimeSettings | undefined,
  at: Clock,
): LeadRange {
  const set = resolveLeadSettings(settings);
  const row = LEAD_ROWS[type];
  const spare = row.kind === "replace" ? hasSpare(row, set.spares) : undefined;
  const base: Range =
    row.kind === "replace" && !spare
      ? scale(row.ordered as Range, SLA_FACTOR[set.vendorSla], ORDER_FLOOR_S)
      : row.spare;
  const surcharged =
    set.afterHours && row.kind !== "remote" && row.kind !== "external" && isAfterHours(at);
  const [min, typ, max] = surcharged
    ? [base[0], base[1] * AFTER_HOURS_FACTOR, base[2] * AFTER_HOURS_FACTOR]
    : base;
  return {
    min,
    typ,
    max,
    kind: row.kind,
    who: row.who,
    ...(spare === undefined ? {} : { spare }),
    surcharged,
  };
}

/** A draw from the range: log-normal with the typical value as the median and the bounds as the 5th and 95th percentile. */
export function sampleLead(
  range: Pick<LeadRange, "min" | "typ" | "max">,
  normal: () => number,
): number {
  const { min, typ, max } = range;
  if (max <= min) return min;
  const z = normal();
  const sigma =
    z < 0 ? (Math.log(typ) - Math.log(min)) / 1.645 : (Math.log(max) - Math.log(typ)) / 1.645;
  const value = Math.exp(Math.log(typ) + sigma * z);
  return Math.min(max, Math.max(min, value));
}

/** The wait is told in ten-minute steps, and it ends exactly then. */
export const LEAD_STEP_S = 10 * M;
export const roundLead = (seconds: number): number =>
  Math.max(LEAD_STEP_S, Math.round(seconds / LEAD_STEP_S) * LEAD_STEP_S);

/** The last stretch of the wait is the work itself: someone on site (replace, visit) or a person at a console. */
export function workWindow(kind: WorkKind): { readonly seconds: number; readonly onSite: boolean } {
  if (kind === "replace") return { seconds: 30 * M, onSite: true };
  if (kind === "visit") return { seconds: 20 * M, onSite: true };
  return { seconds: 10 * M, onSite: false };
}

/** "4시간 10분", "1일 2시간": days when it is a day or more, else the usual hours and minutes. */
export function formatSpan(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < D) return formatDuration(total);
  const days = Math.floor(total / D);
  const hours = Math.floor((total % D) / H);
  return hours > 0 ? `${days}일 ${hours}시간` : `${days}일`;
}
