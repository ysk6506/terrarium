/**
 * Fault types: what can go wrong in the world. This is data (the scenario editor builds its palette
 * from it); the effects are implemented by core.physics. `status: "planned"` faults are listed so
 * people can see them, but they cannot be used until physics implements them (REQ-034).
 */
import type { EntityKind } from "./blueprint";
import { ACCEL_FAULT_SPECS } from "./faults-accel";
import { APP_FAULT_SPECS } from "./faults-app";
import { DB_FAULT_SPECS } from "./faults-db";
import { K8S_FAULT_SPECS } from "./faults-k8s";
import { OS_FAULT_SPECS } from "./faults-os";
import { SDN_FAULT_SPECS, SDN_MISTAKE_SPEC } from "./faults-sdn";

export type FaultType =
  | "cooling_unit_failure"
  | "cooling_unit_degraded"
  | "setpoint_drift"
  | "fan_failure"
  | "psu_failure"
  | "breaker_trip"
  | "grid_outage"
  | "ups_battery_degraded"
  | "link_down"
  | "switch_failure"
  | "disk_failure"
  | "sensor_drift"
  | "cpu_runaway"
  | "vm_cpu_spike"
  | "bmc_unresponsive"
  | "memory_failure"
  | "firmware_update_failure"
  | "chiller_failure"
  | "chiller_degraded"
  | "cdu_failure"
  | "cdu_pump_failure"
  | "coolant_leak"
  | "immersion_circulation_failure"
  | "generator_start_failure"
  | "ats_stuck"
  | "utility_outage"
  | "disk_full"
  | "log_flood"
  | "memory_leak"
  | "process_crashloop"
  | "zombie_pileup"
  | "fs_readonly"
  | "ntp_drift"
  | "dns_failure"
  | "kernel_panic"
  | "cert_expired"
  | "db_primary_down"
  | "db_secondary_down"
  | "db_replication_broken"
  | "db_split_brain"
  | "db_backup_corrupt"
  | "storage_path_cut"
  | "storage_controller_failure"
  | "storage_node_lost"
  | "sdn_controller_down"
  | "sdn_sync_failed"
  | "vxlan_tunnel_down"
  | "evpn_session_flap"
  | "ingress_controller_down"
  | "cni_plugin_failure"
  | "nfv_firewall_overload"
  | "k8s_node_notready"
  | "k8s_control_plane_down"
  | "k8s_etcd_quorum_lost"
  | "k8s_pod_crashloop"
  | "k8s_resource_exhausted"
  | "k8s_image_pull_failure"
  | "k8s_disk_pressure"
  | "k8s_cni_failure"
  | "lb_backend_flapping"
  | "session_store_down"
  | "circuit_breaker_stuck_open"
  | "retry_storm"
  | "sidecar_crash"
  | "mesh_control_down"
  | "region_down"
  | "replication_lag_high"
  | "gpu_xid_error"
  | "nvlink_down"
  | "ib_link_flap"
  | "gpu_thermal_throttle"
  | "gpu_memory_leak_inference"
  | "job_stuck_checkpoint"
  | "scheduler_down"
  | "mig_misconfig"
  | "bbu_cell_fault"
  | "dc_bus_sag"
  | "utility_feed_loss"
  | "transformer_overtemp"
  | "ups_module_fail"
  | "rdhx_valve_stuck"
  | "fluid_level_low";

/**
 * Things people do wrong, as opposed to things that break: a port put in the wrong VLAN, a gateway interface left
 * shut, a route deleted, a PDU outlet switched off. A scenario makes them with its configuration blocks (they are
 * ordinary operator commands, which an agent can undo the same way), never with `inject_fault`. They are named
 * here so a diagnosis can say what kind of mistake it found, the way it names a fault.
 */
export type MistakeType =
  | "port_vlan_mismatch"
  | "port_shutdown"
  | "svi_shutdown"
  | "bgp_neighbor_shutdown"
  | "route_missing"
  | "outlet_off"
  | "network_policy_deny";

export interface FaultParamSpec {
  readonly name: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly default: number;
  readonly unit: string;
}

export interface FaultSpec {
  readonly type: FaultType;
  readonly label: string;
  readonly description: string;
  /** Entity kinds the fault applies to; "link" means a network link id. */
  readonly targets: readonly (EntityKind | "link")[];
  readonly params: readonly FaultParamSpec[];
  readonly status: "supported" | "planned";
  readonly domain: "facility" | "server" | "network" | "storage" | "virtual" | "os";
}

export interface Fault {
  readonly id: string;
  readonly type: FaultType;
  readonly target: string;
  readonly params: Readonly<Record<string, number>>;
  readonly since: number;
}

const p = (
  name: string,
  label: string,
  min: number,
  max: number,
  def: number,
  unit: string,
): FaultParamSpec => ({ name, label, min, max, default: def, unit });

export const FAULT_SPECS: readonly FaultSpec[] = [
  {
    type: "cooling_unit_failure",
    label: "냉방기 정지",
    description: "항온항습기/인로우 냉방기가 멈춰요",
    targets: ["cooling_unit"],
    params: [],
    status: "supported",
    domain: "facility",
  },
  {
    type: "cooling_unit_degraded",
    label: "냉방 능력 저하",
    description: "냉방 용량이 일부만 나와요(필터 막힘, 압축기 고장)",
    targets: ["cooling_unit"],
    params: [p("factor", "남은 용량", 0.05, 0.95, 0.4, "비율")],
    status: "supported",
    domain: "facility",
  },
  {
    type: "setpoint_drift",
    label: "설정 온도 틀어짐",
    description: "제어기가 설정보다 높은 온도로 공급해요",
    targets: ["cooling_unit"],
    params: [p("deltaC", "상승 폭", 1, 15, 6, "°C")],
    status: "supported",
    domain: "facility",
  },
  {
    type: "breaker_trip",
    label: "차단기 트립",
    description: "분전반/PDU 차단기가 떨어져 하위 장비 전원이 끊겨요",
    targets: ["power_panel", "pdu"],
    params: [],
    status: "supported",
    domain: "facility",
  },
  {
    type: "grid_outage",
    label: "한전 정전",
    description: "UPS 입력 전원이 끊겨 배터리로 버텨요",
    targets: ["ups"],
    params: [],
    status: "supported",
    domain: "facility",
  },
  {
    type: "ups_battery_degraded",
    label: "UPS 배터리 열화",
    description: "배터리 용량이 줄어들어요",
    targets: ["ups"],
    params: [p("factor", "남은 용량", 0.05, 0.95, 0.3, "비율")],
    status: "supported",
    domain: "facility",
  },
  {
    type: "utility_outage",
    label: "수전 중단(한전 정전)",
    description:
      "한전 인입이 끊겨요. 자동절체반이 있으면 발전기가 기동하고, UPS는 그동안 배터리로 버텨요",
    targets: ["power_panel"],
    params: [],
    status: "supported",
    domain: "facility",
  },
  {
    type: "chiller_failure",
    label: "냉각 플랜트 정지",
    description: "칠러·드라이쿨러·냉각탑이 멈춰 냉수 공급이 끊겨요",
    targets: ["chiller"],
    params: [],
    status: "supported",
    domain: "facility",
  },
  {
    type: "chiller_degraded",
    label: "냉각 플랜트 능력 저하",
    description: "외기 조건이나 압축기 문제로 용량이 일부만 나와요",
    targets: ["chiller"],
    params: [p("factor", "남은 용량", 0.05, 0.95, 0.5, "비율")],
    status: "supported",
    domain: "facility",
  },
  {
    type: "cdu_failure",
    label: "CDU 정지",
    description: "냉각수 분배 장치가 멈춰 수랭 랙과 액침 탱크의 열이 빠지지 않아요",
    targets: ["cdu"],
    params: [],
    status: "supported",
    domain: "facility",
  },
  {
    type: "cdu_pump_failure",
    label: "CDU 펌프 고장",
    description: "예비 펌프까지 쓰고 나면 유량이 줄어 용량이 떨어져요",
    targets: ["cdu"],
    params: [p("pumps", "고장 펌프 수", 1, 3, 2, "대")],
    status: "supported",
    domain: "facility",
  },
  {
    type: "coolant_leak",
    label: "냉각수 누설",
    description: "누설이 감지되어 해당 랙·CDU의 냉각수 공급이 곧 차단돼요",
    targets: ["rack", "cdu"],
    params: [p("shutoffSeconds", "차단까지", 30, 900, 120, "초")],
    status: "supported",
    domain: "facility",
  },
  {
    type: "immersion_circulation_failure",
    label: "액침 순환 정지",
    description: "탱크 안 유체 순환이 멈춰 열이 열교환기로 가지 않아요",
    targets: ["rack"],
    params: [],
    status: "supported",
    domain: "facility",
  },
  {
    type: "generator_start_failure",
    label: "발전기 기동 실패",
    description: "정전 때 발전기가 시동되지 않아요",
    targets: ["generator"],
    params: [],
    status: "supported",
    domain: "facility",
  },
  {
    type: "ats_stuck",
    label: "자동절체반 고착",
    description: "ATS가 발전기로 넘어가지 못해 정전된 한전 쪽에 머물러요",
    targets: ["power_panel"],
    params: [],
    status: "supported",
    domain: "facility",
  },
  {
    type: "fan_failure",
    label: "서버 팬 고장",
    description: "서버 팬 하나가 멈춰요",
    targets: ["server"],
    params: [p("fanIndex", "팬 번호", 0, 9, 0, "번")],
    status: "supported",
    domain: "server",
  },
  {
    type: "psu_failure",
    label: "PSU 고장",
    description: "서버 전원 공급 장치 하나가 고장 나요",
    targets: ["server"],
    params: [p("psuIndex", "PSU 번호", 0, 5, 0, "번")],
    status: "supported",
    domain: "server",
  },
  {
    type: "sensor_drift",
    label: "온도 센서 오차",
    description: "흡기 온도 센서가 실제보다 높게(낮게) 보고해요",
    targets: ["server"],
    params: [p("deltaC", "오차", -15, 15, 8, "°C")],
    status: "supported",
    domain: "server",
  },
  {
    type: "cpu_runaway",
    label: "CPU 폭주",
    description: "프로세스 폭주로 CPU 사용률이 치솟아요",
    targets: ["server"],
    params: [p("util", "사용률", 0.5, 1, 0.98, "비율")],
    status: "supported",
    domain: "server",
  },
  {
    type: "bmc_unresponsive",
    label: "BMC 무응답",
    description: "BMC(Redfish)가 응답하지 않아요",
    targets: ["server"],
    params: [],
    status: "supported",
    domain: "server",
  },
  {
    type: "memory_failure",
    label: "메모리 불량",
    description: "메모리 모듈이 불량이라 서버가 멈춰요. 모듈을 바꿔야 돌아와요",
    targets: ["server"],
    params: [],
    status: "supported",
    domain: "server",
  },
  {
    type: "firmware_update_failure",
    label: "펌웨어 올리기 실패",
    description: "서버의 펌웨어 올리기가 끝에서 실패해요. 정해진 횟수만큼 실패한 뒤에는 성공해요",
    targets: ["server"],
    params: [p("failures", "실패하는 횟수", 1, 3, 1, "번")],
    status: "supported",
    domain: "server",
  },
  {
    type: "link_down",
    label: "네트워크 링크 다운",
    description: "서버-스위치 사이 링크가 끊겨요",
    targets: ["link"],
    params: [],
    status: "supported",
    domain: "network",
  },
  {
    type: "switch_failure",
    label: "스위치 고장",
    description: "스위치가 멈춰 연결된 링크가 모두 끊겨요",
    targets: ["switch"],
    params: [],
    status: "supported",
    domain: "network",
  },
  {
    type: "disk_failure",
    label: "디스크 고장",
    description: "스토리지 디스크가 고장 나요",
    targets: ["storage"],
    params: [p("disks", "고장 개수", 1, 24, 1, "개")],
    status: "supported",
    domain: "storage",
  },
  {
    type: "vm_cpu_spike",
    label: "VM CPU 급증",
    description: "VM의 CPU 수요가 치솟아 호스트가 과부하돼요",
    targets: ["vm"],
    params: [p("demand", "수요", 0.5, 1, 1, "비율")],
    status: "supported",
    domain: "virtual",
  },
  ...OS_FAULT_SPECS,
  ...DB_FAULT_SPECS,
  ...SDN_FAULT_SPECS,
  ...K8S_FAULT_SPECS,
  ...APP_FAULT_SPECS,
  ...ACCEL_FAULT_SPECS,
];

/** The mistakes a scenario can make with its configuration blocks, named so a diagnosis can name them. */
export const MISTAKE_SPECS: ReadonlyArray<
  Omit<FaultSpec, "type"> & { readonly type: MistakeType }
> = [
  {
    type: "port_vlan_mismatch",
    label: "포트 VLAN 오설정",
    description: "서버가 꽂힌 스위치 포트가 다른 VLAN에 들어 있어요",
    targets: ["switch"],
    params: [],
    status: "supported",
    domain: "network",
  },
  {
    type: "port_shutdown",
    label: "포트 꺼짐",
    description: "스위치 포트를 관리자가 꺼 두었어요(shutdown)",
    targets: ["switch"],
    params: [],
    status: "supported",
    domain: "network",
  },
  {
    type: "svi_shutdown",
    label: "VLAN 인터페이스 꺼짐",
    description: "게이트웨이 역할을 하는 VLAN 인터페이스(SVI)가 꺼져 있어요",
    targets: ["switch"],
    params: [],
    status: "supported",
    domain: "network",
  },
  {
    type: "bgp_neighbor_shutdown",
    label: "BGP 이웃 꺼짐",
    description: "스위치가 BGP 이웃 하나를 꺼 두어 그 길로 배운 경로가 사라졌어요",
    targets: ["switch"],
    params: [],
    status: "supported",
    domain: "network",
  },
  {
    type: "route_missing",
    label: "경로 지워짐",
    description: "스위치에서 정적 경로 하나가 지워져 그쪽으로 가는 길을 잃었어요",
    targets: ["switch"],
    params: [],
    status: "supported",
    domain: "network",
  },
  {
    type: "outlet_off",
    label: "PDU 콘센트 꺼짐",
    description: "PDU의 콘센트 하나를 꺼 두어 거기 꽂힌 장비가 전원을 잃었어요",
    targets: ["pdu"],
    params: [],
    status: "supported",
    domain: "facility",
  },
  SDN_MISTAKE_SPEC,
];

export function faultSpec(type: FaultType): FaultSpec {
  return FAULT_SPECS.find((s) => s.type === type) as FaultSpec;
}

/** The fault's own parameters, with the spec's default for each one it left out. */
export function withParamDefaults(fault: Omit<Fault, "since">): Record<string, number> {
  const params: Record<string, number> = {};
  for (const spec of faultSpec(fault.type).params)
    params[spec.name] = fault.params[spec.name] ?? spec.default;
  return params;
}

export const isFaultType = (value: string): value is FaultType =>
  FAULT_SPECS.some((s) => s.type === value);

export const isMistakeType = (value: string): value is MistakeType =>
  MISTAKE_SPECS.some((s) => s.type === value);

/**
 * Work a scenario can ask an agent to do. There is nothing broken to find, so the report of the work names
 * the kind of work where a diagnosis names the kind of problem.
 */
export type TaskType = "firmware_update";

export const TASK_SPECS: ReadonlyArray<{ readonly type: TaskType; readonly label: string }> = [
  { type: "firmware_update", label: "펌웨어 올리기" },
];

export const isTaskType = (value: string): value is TaskType =>
  TASK_SPECS.some((s) => s.type === value);

/** What a diagnosis can name as the kind of problem: a fault or a mistake, or the kind of work, by id. */
export const isDiagnosisType = (value: string): value is FaultType | MistakeType | TaskType =>
  isFaultType(value) || isMistakeType(value) || isTaskType(value);

/** The label of a fault, mistake or kind of work, for comparing a diagnosis written in words with the id. */
export function diagnosisLabel(type: FaultType | MistakeType | TaskType): string {
  return (
    FAULT_SPECS.find((s) => s.type === type) ??
    MISTAKE_SPECS.find((s) => s.type === type) ??
    TASK_SPECS.find((s) => s.type === type)
  )?.label as string;
}
