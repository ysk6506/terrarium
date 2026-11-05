/**
 * Everything in the world an operator can change, and for each: which scenario block makes the change, which
 * tools let an agent make it, and which action scoring records (REQ-069, ADR-0066). This is the list a person
 * reads to see what an experiment can control, and the list a test walks to prove that none of it is a dead end:
 * a thing a scenario can set but no agent can reach, or that an agent can change but scoring never sees.
 *
 * It is data. The world's commands, the block palette, the tool catalog and the action kinds are the sources of
 * truth; tests/spec/controllability.test.ts checks every row against them and drives each row with a real tool call.
 */
import type { EntityKind, FaultType, WorldCommand } from "@terrarium/core/world";
import type { ActionKind } from "./model";

/** One way for an agent to make the change: a tool, and what to ask of it. */
export interface AgentRoute {
  readonly tool: string;
  /** What the request names, in the protocol's own words. */
  readonly via: string;
}

export interface ControlRow {
  readonly id: string;
  readonly label: string;
  /** The world command the change becomes. */
  readonly command: OperatorCommand;
  /** What it can act on (a network link for a port). */
  readonly targets: readonly (EntityKind | "link")[];
  /** Scenario blocks that make the change (a fault block makes the breaker trip that a reset undoes). */
  readonly blocks: readonly string[];
  /** The tools that reach it. Empty means only a scenario can do it, and `note` says why. */
  readonly agent: readonly AgentRoute[];
  /** How scoring sees an agent doing it (`undefined` when no agent can). */
  readonly actions: readonly ActionKind[];
  readonly note?: string;
}

export type OperatorCommand = Exclude<
  WorldCommand["type"],
  | "fault.add"
  | "fault.remove"
  | "thermal.shutdown"
  | "alarm.raise"
  | "alarm.clear"
  | "note"
  | "firmware.reboot"
  | "firmware.finish"
  | "firmware.fail"
>;

const REDFISH = "redfish_request";
const BACNET = "bacnet_request";
const NETWORK = [
  {
    tool: "network_cli",
    via: "구성 모드의 CLI 명령 (shutdown, switchport access vlan, ip route …)",
  },
  { tool: "eapi_request", via: "Arista eAPI runCmds" },
  { tool: "nxapi_request", via: "Cisco NX-API cli" },
] as const satisfies readonly AgentRoute[];
const SNMP_PORT: AgentRoute = {
  tool: "snmp_request",
  via: "set ifAdminStatus.<포트> (1 켜기, 2 끄기), 커뮤니티 private",
};
const POWER: readonly ActionKind[] = ["power_off", "power_on", "restart"];

export const CONTROL_ROWS: readonly ControlRow[] = [
  {
    id: "power.server",
    label: "서버 전원",
    command: "power.set",
    targets: ["server"],
    blocks: ["power"],
    agent: [
      { tool: "power_server", via: "id, action on/off" },
      {
        tool: REDFISH,
        via: "Systems/…/Actions/ComputerSystem.Reset (ForceOff, On, ForceRestart …)",
      },
    ],
    actions: POWER,
  },
  {
    id: "power.vm",
    label: "가상 머신 전원",
    command: "power.set",
    targets: ["vm"],
    blocks: ["power"],
    agent: [
      { tool: "vcenter_request", via: "POST /api/vcenter/vm/{vm}/power?action=start|stop|reset" },
    ],
    actions: POWER,
  },
  {
    id: "power.cooling",
    label: "냉방기 켜기/끄기",
    command: "power.set",
    targets: ["cooling_unit"],
    blocks: ["power"],
    agent: [
      { tool: "restart_cooling_unit", via: "unitId" },
      { tool: BACNET, via: "binary-output 1 Unit-Enable에 write-property" },
    ],
    actions: POWER,
  },
  {
    id: "power.plant",
    label: "냉각 플랜트·발전기 켜기/끄기",
    command: "power.set",
    targets: ["chiller", "cdu", "generator"],
    blocks: ["power"],
    agent: [
      { tool: BACNET, via: "binary-output 1 Unit-Enable에 write-property (발전기는 AUTO/OFF)" },
    ],
    actions: POWER,
  },
  {
    id: "power.network_storage",
    label: "스위치·스토리지 전원",
    command: "power.set",
    targets: ["switch", "storage"],
    blocks: ["power"],
    agent: [],
    actions: [],
    note: "현장에서는 전원 분배기 콘센트로 끈다. 에이전트는 PDU 콘센트 줄을 쓴다.",
  },
  {
    id: "cooling.setpoint",
    label: "냉방 설정 온도",
    command: "setpoint.set",
    targets: ["cooling_unit"],
    blocks: ["set_setpoint"],
    agent: [
      { tool: "set_cooling_setpoint", via: "unitId, celsius" },
      { tool: BACNET, via: "analog-value 1 Supply-Air-Setpoint에 write-property" },
    ],
    actions: ["setpoint_change"],
  },
  {
    id: "breaker.reset",
    label: "차단기 리셋",
    command: "breaker.reset",
    targets: ["pdu", "power_panel"],
    blocks: ["inject_fault"],
    agent: [
      { tool: "reset_breaker", via: "id" },
      {
        tool: REDFISH,
        via: "PowerEquipment/RackPDUs/1/Mains/1/Actions/Circuit.BreakerControl (On)",
      },
    ],
    actions: ["breaker_reset"],
    note: "차단기를 떨어뜨리는 쪽은 고장 발생 블록(차단기 트립)이다.",
  },
  {
    id: "power.outlet",
    label: "PDU 콘센트",
    command: "outlet.set",
    targets: ["pdu"],
    blocks: ["outlet_set"],
    agent: [
      { tool: REDFISH, via: "PowerEquipment/RackPDUs/1/Outlets/{n}/Actions/Outlet.PowerControl" },
    ],
    actions: ["outlet_off", "outlet_on"],
  },
  {
    id: "network.port",
    label: "스위치 포트 끄기/켜기",
    command: "link.admin",
    targets: ["link"],
    blocks: ["port_admin"],
    agent: [...NETWORK, SNMP_PORT],
    actions: ["port_shutdown", "port_enable"],
  },
  {
    id: "network.config",
    label: "스위치 설정 (VLAN, SVI, 경로, BGP)",
    command: "net.set",
    targets: ["switch"],
    blocks: ["port_vlan", "svi_admin", "route_del", "bgp_admin"],
    agent: NETWORK,
    actions: ["config_change"],
  },
  {
    id: "firmware.update",
    label: "서버 펌웨어(BMC·BIOS) 올리기",
    command: "firmware.update",
    targets: ["server"],
    blocks: [],
    agent: [
      {
        tool: REDFISH,
        via: "UpdateService/Actions/UpdateService.SimpleUpdate (ImageURI: bios-2.4.1.bin 같은 이미지 이름)",
      },
    ],
    actions: ["firmware_update"],
    note: "시나리오는 올리기를 시키지 않는다. 실패만 고장 발생 블록(펌웨어 올리기 실패)으로 만든다. 재부팅과 버전 바뀜은 물리 엔진이 시간에 맞춰 한다.",
  },
  {
    id: "outdoor.set",
    label: "외기 온도",
    command: "outdoor.set",
    targets: ["site"],
    blocks: ["set_outdoor_temp"],
    agent: [],
    actions: [],
    note: "날씨는 운영자가 바꿀 수 없다. 시나리오가 폭염이나 한파를 만들 뿐이고, 에이전트는 BACnet 외기 온도 입력으로 읽기만 한다.",
  },
  {
    id: "load.set",
    label: "서버·VM 부하",
    command: "load.set",
    targets: ["server", "vm"],
    blocks: ["set_load"],
    agent: [],
    actions: [],
    note: "일감은 운영자가 바꾸는 설정이 아니라 실험이 만드는 상황이다. 에이전트가 건드리면 정답이 사라진다.",
  },
];

/** The world commands no operator gives, and who does: a scenario, the physics, or only the log. */
export const NOT_OPERATOR: Readonly<
  Record<Exclude<WorldCommand["type"], OperatorCommand>, string>
> = {
  "fault.add": "시나리오의 고장 발생 블록",
  "fault.remove": "시나리오의 고장 복구 블록",
  "thermal.shutdown": "물리 엔진 (CPU가 한계 온도를 넘으면 스스로 꺼진다)",
  "firmware.reboot": "물리 엔진 (펌웨어 올리기가 시작되고 2분이 지나면 서버가 재부팅한다)",
  "firmware.finish": "물리 엔진 (재부팅이 끝나면 새 버전으로 돈다)",
  "firmware.fail": "물리 엔진 (올리기가 실패하게 정해진 서버는 이전 버전으로 돌아온다)",
  "alarm.raise": "모니터링",
  "alarm.clear": "모니터링",
  note: "기록 전용",
};

/**
 * What an agent can do about each fault. `fix`: an operator command clears it (a test drives it). `mitigate`:
 * operator commands limit the harm (shed load, raise cooling) but the fault stays. `diagnose`: nothing remote
 * helps; the answer is the diagnosis and the call for a technician. This says what a scenario author may
 * expect of an agent, so no scenario scores a fix that no tool can make.
 */
export type Remedy = "fix" | "mitigate" | "diagnose";

export interface FaultResponse {
  readonly remedy: Remedy;
  /** The control rows that fix or mitigate it. */
  readonly via: readonly string[];
}

const SHED = ["power.server"] as const;
const COOLING = ["cooling.setpoint", "power.server"] as const;

export const FAULT_RESPONSES: Readonly<Record<FaultType, FaultResponse>> = {
  cooling_unit_failure: { remedy: "mitigate", via: COOLING },
  cooling_unit_degraded: { remedy: "mitigate", via: COOLING },
  setpoint_drift: { remedy: "mitigate", via: ["cooling.setpoint"] },
  breaker_trip: { remedy: "fix", via: ["breaker.reset"] },
  grid_outage: { remedy: "mitigate", via: SHED },
  ups_battery_degraded: { remedy: "diagnose", via: [] },
  utility_outage: { remedy: "mitigate", via: ["power.plant", "power.server"] },
  chiller_failure: { remedy: "mitigate", via: COOLING },
  chiller_degraded: { remedy: "mitigate", via: SHED },
  cdu_failure: { remedy: "mitigate", via: SHED },
  cdu_pump_failure: { remedy: "mitigate", via: SHED },
  coolant_leak: { remedy: "mitigate", via: SHED },
  immersion_circulation_failure: { remedy: "mitigate", via: SHED },
  generator_start_failure: { remedy: "mitigate", via: SHED },
  ats_stuck: { remedy: "mitigate", via: SHED },
  fan_failure: { remedy: "mitigate", via: SHED },
  psu_failure: { remedy: "diagnose", via: [] },
  sensor_drift: { remedy: "diagnose", via: [] },
  cpu_runaway: { remedy: "mitigate", via: SHED },
  bmc_unresponsive: { remedy: "diagnose", via: [] },
  firmware_update_failure: { remedy: "fix", via: ["firmware.update"] },
  link_down: { remedy: "diagnose", via: [] },
  switch_failure: { remedy: "diagnose", via: [] },
  disk_failure: { remedy: "diagnose", via: [] },
  vm_cpu_spike: { remedy: "mitigate", via: ["power.vm"] },
};
