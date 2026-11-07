/** The links between entities (dependency direction, consumer to supplier): their kinds and what each may join (split from blueprint.ts for size). */
import type { EntityKind } from "./blueprint";

export type LinkKind =
  | "power"
  | "network"
  | "cooling"
  | "runs_on"
  | "member_of"
  | "managed_by"
  | "stored_on"
  | "backed_by"
  /** A service runs on this VM, server or storage; `role` is `active` or `standby` (ADR-0091). */
  | "service_on"
  /** A service needs the traffic of this switch to reach its users. */
  | "service_via"
  /** A service needs this database or storage pool (REQ-095): it reads its state, not its host. */
  | "depends_on"
  /** A database instance runs on this VM or server; a storage controller sits in this storage array; a Kubernetes node is this VM or server. */
  | "hosted_on"
  /** An SDN controller manages this switch's VTEP (REQ-097). */
  | "controls"
  /** A network policy applies to this service (REQ-097). */
  | "applies_to"
  /**
   * A service calls another service (REQ-100, ADR-0121): the caller leans on the callee. Settings: `critical` (the caller
   * cannot work without the answer), `fanout` (calls it makes for one request) and `timeoutMs`. Workloads of the container
   * layer may call each other too; that only draws the picture and widens the impact range.
   */
  | "calls";

/** Allowed (from kinds, to kinds) per link kind. `from` depends on `to`. */
export const LINK_RULES: Readonly<
  Record<LinkKind, { readonly from: readonly EntityKind[]; readonly to: readonly EntityKind[] }>
> = {
  power: {
    from: [
      "server",
      "switch",
      "storage",
      "rack",
      "pdu",
      "cooling_unit",
      "power_panel",
      "cdu",
      "chiller",
      "ups",
    ],
    to: ["pdu", "power_panel", "ups", "generator", "substation"],
  },
  network: { from: ["server", "storage", "switch"], to: ["switch"] },
  cooling: { from: ["rack", "cooling_unit", "cdu"], to: ["cooling_unit", "cdu", "chiller"] },
  runs_on: { from: ["vm"], to: ["server"] },
  member_of: {
    from: [
      "server",
      "db_instance",
      "storage_controller",
      "vtep",
      "k8s_node",
      "k8s_workload",
      "app_instance",
      "mesh_sidecar",
      "region",
      "replication_stream",
      "gpu",
      "nvlink_domain",
      "ib_link",
      "training_job",
      "bbu",
      "dc_bus",
      "rdhx",
      "immersion_tank",
    ],
    to: [
      "server",
      "rack",
      "nvlink_domain",
      "ib_fabric",
      "job_scheduler",
      "cluster",
      "db_cluster",
      "storage_pool",
      "overlay_segment",
      "k8s_cluster",
      "service",
      "region",
      "mesh_control",
      "load_balancer",
      "dr_site",
      "dr_plan",
    ],
  },
  managed_by: { from: ["cluster"], to: ["vcenter"] },
  stored_on: { from: ["vm", "db_instance", "volume"], to: ["datastore", "storage_pool"] },
  backed_by: { from: ["datastore", "storage_pool"], to: ["storage"] },
  service_on: { from: ["service"], to: ["vm", "server", "storage"] },
  service_via: { from: ["service"], to: ["switch"] },
  depends_on: {
    from: ["service"],
    to: [
      "db_cluster",
      "db_instance",
      "storage_pool",
      "overlay_segment",
      "ingress",
      "nfv_function",
      "k8s_workload",
      "load_balancer",
      "session_store",
      "volume",
      "db_node",
      "db_managed",
      "inference_pool",
      "job_scheduler",
      "training_job",
      "ib_fabric",
    ],
  },
  hosted_on: {
    from: [
      "db_instance",
      "storage_controller",
      "sdn_controller",
      "vtep",
      "nfv_function",
      "cni",
      "ingress",
      "k8s_node",
      "app_instance",
      "load_balancer",
      "session_store",
      "mesh_sidecar",
      "mesh_control",
      "db_node",
      "replication_stream",
      "job_scheduler",
    ],
    to: ["vm", "server", "storage", "switch", "app_instance"],
  },
  controls: { from: ["sdn_controller"], to: ["switch"] },
  applies_to: { from: ["network_policy"], to: ["service"] },
  calls: { from: ["service", "k8s_workload"], to: ["service", "k8s_workload"] },
};
