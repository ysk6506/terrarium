/** Reference paths of the fault kinds no built-in sheet injects (REQ-110, ADR-0133). */
import { change, path, type ReferencePath, read, sh, untilTeamDone } from "./reference-path";

const alarms = read("list_alarms");
const handOver = (domain: string, note: string) => change("escalate", { domain, note });
const LOOK = path([read("list_alarms"), read("get_entity", { id: "{target}" })], []);

export const REST_PATHS = {
  cooling_unit_degraded: LOOK,
  setpoint_drift: LOOK,
  grid_outage: LOOK,
  ups_battery_degraded: LOOK,
  chiller_degraded: LOOK,
  coolant_leak: LOOK,
  immersion_circulation_failure: LOOK,
  generator_start_failure: LOOK,
  ats_stuck: LOOK,
  psu_failure: LOOK,
  cpu_runaway: LOOK,
  bmc_unresponsive: LOOK,
  switch_failure: path(
    [alarms, read("get_entity", { id: "{target}" })],
    [handOver("network", "스위치가 멈췄어요"), untilTeamDone],
    [],
    { settleS: 60 },
  ),
  disk_failure: LOOK,
  log_flood: LOOK,
  zombie_pileup: LOOK,
  dns_failure: path(
    [alarms, read("run_command", { host: "{target}", cmd: "cat /etc/resolv.conf" })],
    [sh("{target}", "systemctl restart systemd-resolved")],
  ),
  kernel_panic: path(
    [alarms, read("get_entity", { id: "{target}" })],
    [change("failover_service", { service: "{service}" })],
  ),
  cert_expired: path(
    [alarms, read("run_command", { host: "{target}", cmd: "journalctl -n 20" })],
    [
      change("failover_service", { service: "{service}" }),
      sh("{target}", "systemctl restart kubelet"),
    ],
    [],
    { settleS: 300 },
  ),
  db_secondary_down: LOOK,
  db_backup_corrupt: LOOK,
  storage_controller_failure: path(
    [alarms, read("storage_status", { id: "{alarm:storage_pool_down}" })],
    [change("storage_path_switch", { controller: "{sibling}" })],
  ),
  evpn_session_flap: path(
    [alarms, read("sdn_status")],
    [change("sdn_sync", { switch: "{@sdn_status/vteps/id={target}/switch}" })],
  ),
  nfv_firewall_overload: path(
    [alarms, read("sdn_status")],
    [handOver("network", "가상 방화벽이 한계예요"), untilTeamDone],
    [],
    { settleS: 60 },
  ),
  k8s_control_plane_down: LOOK,
  k8s_image_pull_failure: LOOK,
  k8s_cni_failure: LOOK,
  replication_lag_high: path(
    [alarms, read("lb_status")],
    [change("region_failover", { region: "{sibling}" })],
  ),
  wan_degraded: LOOK,
  dr_site_stale: LOOK,
  geo_replication_lag: LOOK,
  db_leader_lost: LOOK,
  db_node_lagging: path(
    [alarms, read("db_cluster_status")],
    [change("db_node_restart", { node: "{target}" })],
  ),
  db_az_failure: LOOK,
  // the node with the hot GPU leaves the job; the job goes on at full speed on a spare
  gpu_thermal_throttle: path(
    [alarms, read("gpu_status"), read("job_status")],
    [
      change("node_drain", { node: "{node}" }),
      change("job_resume", { job: "{@job_status/jobs/0/id}" }),
    ],
  ),
  bbu_cell_fault: LOOK,
  dc_bus_sag: LOOK,
  transformer_overtemp: LOOK,
  ups_module_fail: path(
    [alarms, read("power_status")],
    [handOver("facility", "UPS 모듈이 고장 났어요")],
  ),
  rdhx_valve_stuck: LOOK,
  fluid_level_low: LOOK,
} as const satisfies Partial<Record<string, ReferencePath>>;
