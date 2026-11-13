/**
 * The domain of every tool (REQ-093, ADR-0098): which team's work it is. An experiment that names the domains it is
 * responsible for gets the tools of those domains, the tools every domain has (look at alarms and equipment, wait,
 * answer), and `escalate` to hand the rest to the team that owns it. A tool that is missing here fails the build, as
 * does a name that is not a tool.
 */
import { type Domain, isDomain } from "@terrarium/core/world";
import { OPT_IN_TOOLS, TOOL_NAMES } from "./catalog";

/** `common`: every domain has it. */
export type ToolDomain = Domain | "common";

export const TOOL_DOMAIN: Readonly<Record<string, ToolDomain>> = {
  list_alarms: "common",
  list_entities: "common",
  get_entity: "common",
  get_topology: "common",
  get_impact: "common",
  query_metrics: "common",
  wait: "common",
  submit_diagnosis: "common",
  events_since: "common",
  escalate: "common",
  request_approval: "common",
  create_ticket: "common",
  update_ticket: "common",
  list_tickets: "common",
  ask_human: "common",
  search_runbooks: "common",
  facility_status: "facility",
  bacnet_request: "facility",
  snmp_request: "facility",
  set_cooling_setpoint: "facility",
  restart_cooling_unit: "facility",
  reset_breaker: "facility",
  redfish_request: "server",
  power_server: "server",
  vcenter_request: "virtualization",
  vrops_request: "virtualization",
  migrate_vm: "virtualization",
  network_cli: "network",
  eapi_request: "network",
  nxapi_request: "network",
  list_services: "service_os",
  service_status: "service_os",
  failover_service: "service_os",
  restart_service: "service_os",
  run_command: "service_os",
  db_status: "service_os",
  db_promote: "service_os",
  db_failover: "service_os",
  db_restore: "service_os",
  kubectl_get: "service_os",
  kubectl_describe: "service_os",
  kubectl_logs: "service_os",
  kubectl_rollout_restart: "service_os",
  kubectl_scale: "service_os",
  kubectl_cordon: "service_os",
  kubectl_uncordon: "service_os",
  kubectl_drain: "service_os",
  kubectl_delete_pod: "service_os",
  lb_status: "service_os",
  lb_drain: "service_os",
  lb_enable: "service_os",
  breaker_status: "service_os",
  breaker_reset: "service_os",
  mesh_status: "service_os",
  mesh_rollback: "service_os",
  region_failover: "service_os",
  site_status: "service_os",
  replication_status: "service_os",
  wan_status: "network",
  dr_failover: "service_os",
  dr_failback: "service_os",
  dr_drill: "service_os",
  volume_replication_status: "storage",
  volume_promote: "storage",
  db_cluster_status: "service_os",
  db_node_restart: "service_os",
  db_transfer_leader: "service_os",
  db_managed_status: "service_os",
  db_managed_failover: "service_os",
  db_managed_scale_storage: "service_os",
  gpu_status: "server",
  gpu_reset: "server",
  ib_status: "network",
  job_status: "service_os",
  job_resume: "service_os",
  node_drain: "service_os",
  pool_scale: "service_os",
  power_status: "facility",
  bbu_status: "facility",
  substation_status: "facility",
  transfer_feed: "facility",
  set_power_cap: "server",
  power_cap_status: "server",
  cooling_status: "facility",
  cdu_status: "facility",
  cdu_pump_switch: "facility",
  storage_status: "storage",
  storage_path_switch: "storage",
  sdn_status: "network",
  sdn_sync: "network",
  sdn_failover: "network",
  overlay_trace: "network",
  evpn_sessions: "network",
  policy_list: "network",
  policy_revert: "network",
  ingress_status: "network",
  ingress_restart: "network",
};

export const toolDomain = (name: string): ToolDomain => TOOL_DOMAIN[name] ?? "common";

/** The tools that only make sense once an experiment has a scope: handing over, and hearing back. */
export const SCOPE_TOOLS: readonly string[] = ["escalate", "events_since"];

/** The domains in a list of names, without anything that is not a domain. */
export const onlyDomains = (names: readonly string[] | undefined): Domain[] =>
  (names ?? []).filter(isDomain);

/**
 * What an experiment with these domains can use out of the tools it picked: its own domains' tools and the common
 * ones stay, the tools of other domains go (those are reached through `escalate`), and `escalate` with
 * `events_since` come on. Without domains the experiment owns everything and the list is as it was.
 */
export function scopeTools(
  tools: readonly string[],
  domains: readonly Domain[] | undefined,
): string[] {
  if (!domains || domains.length === 0) return [...tools];
  const mine = tools.filter((t) => {
    const d = toolDomain(t);
    return d === "common" || domains.includes(d);
  });
  return [...new Set([...mine, ...SCOPE_TOOLS])];
}

/** The tools that are on when someone picks these domains: every tool of theirs that is not optional or opt-in. */
export function toolsForDomains(
  domains: readonly Domain[],
  all: readonly { readonly name: string; readonly optional?: boolean }[],
): string[] {
  return scopeTools(
    all.filter((t) => !t.optional && !OPT_IN_TOOLS.includes(t.name)).map((t) => t.name),
    domains,
  );
}

/** For a test and for documents: every tool name this table covers. */
export const toolsWithoutDomain = (): string[] => TOOL_NAMES.filter((n) => !(n in TOOL_DOMAIN));
