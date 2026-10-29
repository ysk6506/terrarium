/**
 * Fault types: what can go wrong in the world. This is data (the scenario editor builds its palette
 * from it); the effects are implemented by core.physics. `status: "planned"` faults are listed so
 * people can see them, but they cannot be used until physics implements them (REQ-034).
 */
import type { EntityKind } from "./blueprint";

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
  | "chiller_failure"
  | "chiller_degraded"
  | "cdu_failure"
  | "cdu_pump_failure"
  | "coolant_leak"
  | "immersion_circulation_failure"
  | "generator_start_failure"
  | "ats_stuck"
  | "utility_outage";

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
  readonly domain: "facility" | "server" | "network" | "storage" | "virtual";
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
    description: "항온항습기/인로우 냉방기가 멈춘다",
    targets: ["cooling_unit"],
    params: [],
    status: "supported",
    domain: "facility",
  },
  {
    type: "cooling_unit_degraded",
    label: "냉방 능력 저하",
    description: "냉방 용량이 일부만 나온다(필터 막힘, 압축기 고장)",
    targets: ["cooling_unit"],
    params: [p("factor", "남은 용량", 0.05, 0.95, 0.4, "비율")],
    status: "supported",
    domain: "facility",
  },
  {
    type: "setpoint_drift",
    label: "설정 온도 틀어짐",
    description: "제어기가 설정보다 높은 온도로 공급한다",
    targets: ["cooling_unit"],
    params: [p("deltaC", "상승 폭", 1, 15, 6, "°C")],
    status: "supported",
    domain: "facility",
  },
  {
    type: "breaker_trip",
    label: "차단기 트립",
    description: "분전반/PDU 차단기가 떨어져 하위 장비 전원이 끊긴다",
    targets: ["power_panel", "pdu"],
    params: [],
    status: "supported",
    domain: "facility",
  },
  {
    type: "grid_outage",
    label: "한전 정전",
    description: "UPS 입력 전원이 끊겨 배터리로 버틴다",
    targets: ["ups"],
    params: [],
    status: "supported",
    domain: "facility",
  },
  {
    type: "ups_battery_degraded",
    label: "UPS 배터리 열화",
    description: "배터리 용량이 줄어든다",
    targets: ["ups"],
    params: [p("factor", "남은 용량", 0.05, 0.95, 0.3, "비율")],
    status: "supported",
    domain: "facility",
  },
  {
    type: "utility_outage",
    label: "수전 중단(한전 정전)",
    description:
      "한전 인입이 끊긴다. 자동절체반이 있으면 발전기가 기동하고, UPS는 그동안 배터리로 버틴다",
    targets: ["power_panel"],
    params: [],
    status: "supported",
    domain: "facility",
  },
  {
    type: "chiller_failure",
    label: "냉각 플랜트 정지",
    description: "칠러·드라이쿨러·냉각탑이 멈춰 냉수 공급이 끊긴다",
    targets: ["chiller"],
    params: [],
    status: "supported",
    domain: "facility",
  },
  {
    type: "chiller_degraded",
    label: "냉각 플랜트 능력 저하",
    description: "외기 조건이나 압축기 문제로 용량이 일부만 나온다",
    targets: ["chiller"],
    params: [p("factor", "남은 용량", 0.05, 0.95, 0.5, "비율")],
    status: "supported",
    domain: "facility",
  },
  {
    type: "cdu_failure",
    label: "CDU 정지",
    description: "냉각수 분배 장치가 멈춰 수랭 랙과 액침 탱크의 열이 빠지지 않는다",
    targets: ["cdu"],
    params: [],
    status: "supported",
    domain: "facility",
  },
  {
    type: "cdu_pump_failure",
    label: "CDU 펌프 고장",
    description: "예비 펌프까지 쓰고 나면 유량이 줄어 용량이 떨어진다",
    targets: ["cdu"],
    params: [p("pumps", "고장 펌프 수", 1, 3, 2, "대")],
    status: "supported",
    domain: "facility",
  },
  {
    type: "coolant_leak",
    label: "냉각수 누설",
    description: "누설이 감지되어 해당 랙·CDU의 냉각수 공급이 곧 차단된다",
    targets: ["rack", "cdu"],
    params: [p("shutoffSeconds", "차단까지", 30, 900, 120, "초")],
    status: "supported",
    domain: "facility",
  },
  {
    type: "immersion_circulation_failure",
    label: "액침 순환 정지",
    description: "탱크 안 유체 순환이 멈춰 열이 열교환기로 가지 않는다",
    targets: ["rack"],
    params: [],
    status: "supported",
    domain: "facility",
  },
  {
    type: "generator_start_failure",
    label: "발전기 기동 실패",
    description: "정전 때 발전기가 시동되지 않는다",
    targets: ["generator"],
    params: [],
    status: "supported",
    domain: "facility",
  },
  {
    type: "ats_stuck",
    label: "자동절체반 고착",
    description: "ATS가 발전기로 넘어가지 못해 정전된 한전 쪽에 머문다",
    targets: ["power_panel"],
    params: [],
    status: "supported",
    domain: "facility",
  },
  {
    type: "fan_failure",
    label: "서버 팬 고장",
    description: "서버 팬 하나가 멈춘다",
    targets: ["server"],
    params: [p("fanIndex", "팬 번호", 0, 9, 0, "번")],
    status: "supported",
    domain: "server",
  },
  {
    type: "psu_failure",
    label: "PSU 고장",
    description: "서버 전원 공급 장치 하나가 고장 난다",
    targets: ["server"],
    params: [p("psuIndex", "PSU 번호", 0, 5, 0, "번")],
    status: "supported",
    domain: "server",
  },
  {
    type: "sensor_drift",
    label: "온도 센서 오차",
    description: "흡기 온도 센서가 실제보다 높게(낮게) 보고한다",
    targets: ["server"],
    params: [p("deltaC", "오차", -15, 15, 8, "°C")],
    status: "supported",
    domain: "server",
  },
  {
    type: "cpu_runaway",
    label: "CPU 폭주",
    description: "프로세스 폭주로 CPU 사용률이 치솟는다",
    targets: ["server"],
    params: [p("util", "사용률", 0.5, 1, 0.98, "비율")],
    status: "supported",
    domain: "server",
  },
  {
    type: "bmc_unresponsive",
    label: "BMC 무응답",
    description: "BMC(Redfish)가 응답하지 않는다",
    targets: ["server"],
    params: [],
    status: "supported",
    domain: "server",
  },
  {
    type: "link_down",
    label: "네트워크 링크 다운",
    description: "서버-스위치 사이 링크가 끊긴다",
    targets: ["link"],
    params: [],
    status: "supported",
    domain: "network",
  },
  {
    type: "switch_failure",
    label: "스위치 고장",
    description: "스위치가 멈춰 연결된 링크가 모두 끊긴다",
    targets: ["switch"],
    params: [],
    status: "supported",
    domain: "network",
  },
  {
    type: "disk_failure",
    label: "디스크 고장",
    description: "스토리지 디스크가 고장 난다",
    targets: ["storage"],
    params: [p("disks", "고장 개수", 1, 24, 1, "개")],
    status: "supported",
    domain: "storage",
  },
  {
    type: "vm_cpu_spike",
    label: "VM CPU 급증",
    description: "VM의 CPU 수요가 치솟아 호스트가 과부하된다",
    targets: ["vm"],
    params: [p("demand", "수요", 0.5, 1, 1, "비율")],
    status: "supported",
    domain: "virtual",
  },
];

export function faultSpec(type: FaultType): FaultSpec {
  return FAULT_SPECS.find((s) => s.type === type) as FaultSpec;
}

export const isFaultType = (value: string): value is FaultType =>
  FAULT_SPECS.some((s) => s.type === value);
