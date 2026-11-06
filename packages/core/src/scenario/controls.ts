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
import { K8S_CONTROL_ROWS } from "./controls-k8s";
import { SDN_CONTROL_ROWS } from "./controls-sdn";
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
    id: "host.process",
    label: "호스트의 프로세스·서비스 다시 시작",
    command: "host.act",
    targets: ["server", "vm"],
    blocks: [],
    agent: [
      { tool: "run_command", via: "systemctl restart <서비스>" },
      { tool: "restart_service", via: "service (서비스가 도는 모든 곳에서 다시 시작)" },
    ],
    actions: ["process_restart", "service_restart"],
    note: "고장 발생 블록 없이 운영자의 조치로만 일어난다. 프로세스를 다시 띄우면 그 프로세스가 원인인 고장(좀비, 로그 폭주, 시계·이름 풀이)이 풀린다.",
  },
  {
    id: "host.disk",
    label: "호스트 디스크 비우기",
    command: "host.act",
    targets: ["server", "vm"],
    blocks: [],
    agent: [{ tool: "run_command", via: "rm /var/log/… 또는 logrotate -f" }],
    actions: ["disk_cleanup"],
  },
  {
    id: "host.remount",
    label: "파일시스템 다시 마운트",
    command: "host.act",
    targets: ["server", "vm"],
    blocks: [],
    agent: [{ tool: "run_command", via: "mount -o remount,rw /" }],
    actions: ["fs_remount"],
  },
  {
    id: "host.reboot",
    label: "호스트 재부팅",
    command: "host.act",
    targets: ["server", "vm"],
    blocks: [],
    agent: [{ tool: "run_command", via: "reboot" }],
    actions: ["restart"],
    note: "재부팅하는 동안 호스트 위의 서비스가 멈춘다.",
  },
  {
    id: "service.failover",
    label: "서비스를 대기 쪽으로 옮기기",
    command: "service.failover",
    targets: ["service"],
    blocks: [],
    agent: [{ tool: "failover_service", via: "service" }],
    actions: ["service_failover"],
  },
  {
    id: "vm.migrate",
    label: "VM을 다른 서버로 옮기기",
    command: "vm.migrate",
    targets: ["vm"],
    blocks: [],
    agent: [{ tool: "migrate_vm", via: "vm, host" }],
    actions: ["vm_migrate"],
  },
  {
    id: "host.database",
    label: "데이터베이스 인스턴스 다시 시작",
    command: "host.act",
    targets: ["server", "vm"],
    blocks: [],
    agent: [{ tool: "run_command", via: "systemctl restart postgresql" }],
    actions: ["process_restart"],
    note: "멈춘 세컨더리와 끊긴 복제는 다시 시작하면 풀린다. 프라이머리의 데이터 파일이 깨진 것은 다시 시작해도 안 풀린다.",
  },
  {
    id: "db.promote",
    label: "인스턴스를 프라이머리로 승격",
    command: "db.promote",
    targets: ["db_instance"],
    blocks: [],
    agent: [{ tool: "db_promote", via: "instance" }],
    actions: ["db_promote"],
    note: "복제 지연만큼의 쓰기를 잃는다. 스플릿 브레인에서는 남길 쪽을 고르는 일이고, 다른 쪽은 격리된다.",
  },
  {
    id: "db.failover",
    label: "클러스터 페일오버 강제",
    command: "db.failover",
    targets: ["db_cluster"],
    blocks: [],
    agent: [{ tool: "db_failover", via: "cluster" }],
    actions: ["db_failover"],
    note: "클러스터가 가장 덜 뒤처진 복제본을 고른다. 자동 페일오버가 켜진 클러스터는 감지 시간이 지나면 스스로 한다(원인 cluster).",
  },
  {
    id: "db.restore",
    label: "백업에서 인스턴스 복원",
    command: "db.restore",
    targets: ["db_instance"],
    blocks: [],
    agent: [{ tool: "db_restore", via: "instance, backup" }],
    actions: ["db_restore"],
    note: "복원하는 동안 인스턴스가 멈추고, 프라이머리를 복원하면 백업 이후의 쓰기를 잃는다. 깨진 백업은 중간에 실패한다.",
  },
  {
    id: "storage.path",
    label: "스토리지 경로 전환",
    command: "storage.path_switch",
    targets: ["storage_controller"],
    blocks: [],
    agent: [{ tool: "storage_path_switch", via: "controller" }],
    actions: ["path_switch"],
    note: "멀티패스가 아니면 호스트가 경로를 알아서 바꾸지 못해 사람이 바꿔야 한다.",
  },
  ...SDN_CONTROL_ROWS,
  ...K8S_CONTROL_ROWS,
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
  memory_failure: { remedy: "diagnose", via: [] },
  firmware_update_failure: { remedy: "fix", via: ["firmware.update"] },
  link_down: { remedy: "diagnose", via: [] },
  switch_failure: { remedy: "diagnose", via: [] },
  disk_failure: { remedy: "diagnose", via: [] },
  vm_cpu_spike: { remedy: "mitigate", via: ["power.vm"] },
  disk_full: { remedy: "fix", via: ["host.disk"] },
  log_flood: { remedy: "fix", via: ["host.process"] },
  memory_leak: { remedy: "mitigate", via: ["host.process", "service.failover"] },
  process_crashloop: { remedy: "mitigate", via: ["service.failover"] },
  zombie_pileup: { remedy: "fix", via: ["host.process"] },
  fs_readonly: { remedy: "fix", via: ["host.remount"] },
  ntp_drift: { remedy: "fix", via: ["host.process"] },
  dns_failure: { remedy: "fix", via: ["host.process"] },
  kernel_panic: { remedy: "mitigate", via: ["service.failover"] },
  cert_expired: { remedy: "diagnose", via: [] },
  db_primary_down: { remedy: "mitigate", via: ["db.promote", "db.failover", "db.restore"] },
  db_secondary_down: { remedy: "fix", via: ["host.database"] },
  db_replication_broken: { remedy: "fix", via: ["host.database"] },
  db_split_brain: { remedy: "fix", via: ["db.promote"] },
  db_backup_corrupt: { remedy: "diagnose", via: [] },
  storage_path_cut: { remedy: "mitigate", via: ["storage.path"] },
  storage_controller_failure: { remedy: "mitigate", via: ["storage.path"] },
  storage_node_lost: { remedy: "diagnose", via: [] },
  sdn_controller_down: { remedy: "mitigate", via: ["sdn.failover"] },
  sdn_sync_failed: { remedy: "fix", via: ["sdn.sync"] },
  vxlan_tunnel_down: { remedy: "diagnose", via: [] },
  evpn_session_flap: { remedy: "fix", via: ["sdn.sync"] },
  ingress_controller_down: { remedy: "fix", via: ["ingress.restart"] },
  cni_plugin_failure: { remedy: "fix", via: ["host.cni"] },
  nfv_firewall_overload: { remedy: "diagnose", via: [] },
  k8s_node_notready: { remedy: "fix", via: ["host.kubelet"] },
  k8s_control_plane_down: { remedy: "fix", via: ["host.kubelet"] },
  k8s_etcd_quorum_lost: { remedy: "diagnose", via: [] },
  k8s_pod_crashloop: { remedy: "fix", via: ["k8s.rollout_restart"] },
  k8s_resource_exhausted: { remedy: "mitigate", via: ["k8s.scale"] },
  k8s_image_pull_failure: { remedy: "diagnose", via: [] },
  k8s_disk_pressure: { remedy: "fix", via: ["host.disk"] },
  k8s_cni_failure: { remedy: "fix", via: ["host.kubelet"] },
};
