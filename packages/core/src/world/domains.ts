/**
 * Domains: who looks after what in an operations team (REQ-093, ADR-0098, ADR-0100). Every fault, every mistake and
 * every tool belongs to exactly one domain (tests keep the lists whole). An experiment names the domains it is
 * responsible for ("내 도메인"); the tools of those domains are on, and a fault in any other domain is handed to that
 * domain's team with `escalate(domain)`.
 */
import type { FaultType, MistakeType } from "./faults";

export type Domain =
  | "service_os"
  | "virtualization"
  | "server"
  | "network"
  | "storage"
  | "facility";

export interface DomainInfo {
  readonly id: Domain;
  /** What the screens call the domain. */
  readonly label: string;
  /** The team that takes a hand-off to this domain. */
  readonly team: string;
  /** One line on what the domain covers. */
  readonly covers: string;
}

export const DOMAINS: readonly DomainInfo[] = [
  {
    id: "service_os",
    label: "서비스/OS",
    team: "서비스/OS 팀",
    covers: "서비스, 호스트의 운영 체제와 프로세스",
  },
  { id: "virtualization", label: "가상화", team: "가상화 팀", covers: "VM, 클러스터, 호스트 배치" },
  {
    id: "server",
    label: "서버",
    team: "서버 팀",
    covers: "서버 하드웨어(메모리, 팬, 전원 공급 장치, BMC)",
  },
  { id: "network", label: "네트워크", team: "네트워크 팀", covers: "스위치, 링크, VLAN, 라우팅" },
  { id: "storage", label: "스토리지", team: "스토리지 팀", covers: "스토리지와 디스크" },
  {
    id: "facility",
    label: "데이터센터 인프라",
    team: "데이터센터 인프라 팀",
    covers: "전원, 냉방, 센서",
  },
];

export const DOMAIN_IDS: readonly Domain[] = DOMAINS.map((d) => d.id);

export const isDomain = (value: unknown): value is Domain =>
  typeof value === "string" && DOMAIN_IDS.includes(value as Domain);

export function domainInfo(id: Domain): DomainInfo {
  return DOMAINS.find((d) => d.id === id) as DomainInfo;
}

/** A domain by its id or by what people call it ("서버", "서버 팀", "Facility" is not accepted). */
export function parseDomain(text: unknown): Domain | undefined {
  if (typeof text !== "string") return undefined;
  const t = text.trim().toLowerCase();
  return DOMAINS.find((d) => d.id === t || d.label === text.trim() || d.team === text.trim())?.id;
}

/** The domains as a sentence an agent can pick from: `service_os (서비스/OS), …`. */
export const domainChoices = (): string => DOMAINS.map((d) => `${d.id} (${d.label})`).join(", ");

/** The domain of every fault type: who has to fix it. A type that is missing fails the build. */
export const FAULT_DOMAIN: Readonly<Record<FaultType, Domain>> = {
  cooling_unit_failure: "facility",
  cooling_unit_degraded: "facility",
  setpoint_drift: "facility",
  breaker_trip: "facility",
  grid_outage: "facility",
  utility_outage: "facility",
  ups_battery_degraded: "facility",
  chiller_failure: "facility",
  chiller_degraded: "facility",
  cdu_failure: "facility",
  cdu_pump_failure: "facility",
  coolant_leak: "facility",
  immersion_circulation_failure: "facility",
  generator_start_failure: "facility",
  ats_stuck: "facility",
  sensor_drift: "facility",
  fan_failure: "server",
  psu_failure: "server",
  bmc_unresponsive: "server",
  memory_failure: "server",
  firmware_update_failure: "server",
  link_down: "network",
  switch_failure: "network",
  disk_failure: "storage",
  vm_cpu_spike: "virtualization",
  cpu_runaway: "service_os",
  disk_full: "service_os",
  log_flood: "service_os",
  memory_leak: "service_os",
  process_crashloop: "service_os",
  zombie_pileup: "service_os",
  fs_readonly: "service_os",
  ntp_drift: "service_os",
  dns_failure: "service_os",
  kernel_panic: "service_os",
  cert_expired: "service_os",
};

/** The domain of the mistakes people make (a wrong VLAN, a shut port, a PDU outlet switched off). */
export const MISTAKE_DOMAIN: Readonly<Record<MistakeType, Domain>> = {
  port_vlan_mismatch: "network",
  port_shutdown: "network",
  svi_shutdown: "network",
  bgp_neighbor_shutdown: "network",
  route_missing: "network",
  outlet_off: "facility",
};

export function faultDomain(type: FaultType | MistakeType): Domain {
  return (
    (FAULT_DOMAIN as Record<string, Domain>)[type] ??
    (MISTAKE_DOMAIN as Record<string, Domain>)[type] ??
    "facility"
  );
}
