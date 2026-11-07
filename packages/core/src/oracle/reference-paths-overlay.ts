/** Reference paths of the faults of the SDN, the containers and the application (REQ-110, ADR-0133). */
import {
  change,
  path,
  type ReferencePath,
  read,
  refusedRead,
  sh,
  untilTeamDone,
} from "./reference-path";

const alarms = read("list_alarms");
const sdn = read("sdn_status");
const kube = read("kubectl_get", { kind: "pods" });
const handOver = (domain: string, note: string) => change("escalate", { domain, note });

export const OVERLAY_PATHS = {
  sdn_sync_failed: path(
    [alarms, sdn],
    [change("sdn_sync", { switch: "{@sdn_status/vteps/id={target}/switch}" })],
  ),
  // the standby takes over by itself when there is one
  sdn_controller_down: path([alarms, sdn], [], [], { handsOff: true, settleS: 600 }),
  // nothing in this domain mends a tunnel: trace it, hand it to the network team, wait for them
  vxlan_tunnel_down: path(
    [alarms, read("evpn_sessions")],
    [handOver("network", "VXLAN 터널이 끊겼어요"), untilTeamDone],
    [],
    { settleS: 60 },
  ),
  network_policy_deny: path(
    [alarms, read("policy_list")],
    [change("policy_revert", { policy: "{target}" })],
  ),
  ingress_controller_down: path(
    [alarms, read("ingress_status")],
    [change("ingress_restart", { ingress: "{target}" })],
  ),
  cni_plugin_failure: path([alarms, sdn], [sh("{host}", "systemctl restart calico-node")]),
  k8s_node_notready: path([alarms, kube], [sh("{host}", "systemctl restart kubelet")]),
  k8s_pod_crashloop: path(
    [alarms, kube],
    [change("kubectl_rollout_restart", { workload: "{target}" })],
  ),
  k8s_etcd_quorum_lost: path(
    [alarms, refusedRead("kubectl_get", { kind: "pods" })],
    [handOver("service_os", "etcd 쿼럼을 잃었어요"), untilTeamDone],
    [],
    { settleS: 60 },
  ),
  k8s_resource_exhausted: path(
    [alarms, kube],
    [change("kubectl_scale", { workload: "report", replicas: 0 })],
  ),
  k8s_disk_pressure: path(
    [alarms, kube],
    [sh("{host}", "rm -f /var/log/*/*.log"), change("kubectl_uncordon", { node: "{target}" })],
  ),
  lb_backend_flapping: path(
    [alarms, read("lb_status")],
    [change("lb_drain", { backend: "{target}" })],
  ),
  session_store_down: path(
    [alarms, read("service_status", { service: "{service}" })],
    [sh("{host}", "systemctl restart redis-server")],
  ),
  circuit_breaker_stuck_open: path(
    [alarms, read("breaker_status")],
    [change("breaker_reset", { link: "{@breaker_status/breakers/0/link}" })],
  ),
  retry_storm: path([alarms, read("mesh_status")], [change("mesh_rollback")]),
  sidecar_crash: path(
    [alarms, read("mesh_status")],
    [{ ...sh("{host}", "systemctl restart envoy"), forEach: "targets" }],
  ),
  mesh_control_down: path(
    [alarms, read("mesh_status")],
    [
      sh("{host}", "systemctl restart istiod"),
      change("wait", { seconds: 30 }),
      change("mesh_rollback"),
    ],
  ),
  region_down: path(
    [alarms, read("lb_status")],
    [change("region_failover", { region: "{sibling}" })],
  ),
} as const satisfies Partial<Record<string, ReferencePath>>;
