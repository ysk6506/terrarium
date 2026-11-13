/**
 * What a tool call touches (REQ-050). A call names the equipment it works on in one of its arguments
 * (`id`, `server`, `unitId`, …); the live view needs those ids and the kind of act, not the whole call.
 * Which argument names equipment is written down once, here, and a test keeps it in step with the catalog.
 */
import { changesWorld } from "@terrarium/core/world";
import { toolSpec } from "./catalog";

/** What the agent does to the world with a call. */
export type CallEffect = "observe" | "act" | "wait" | "answer";

/** The arguments of each tool that hold an entity id. */
export const TARGET_ARGS: Readonly<Record<string, readonly string[]>> = {
  list_alarms: ["entityId"],
  list_entities: ["under"],
  get_entity: ["id"],
  get_topology: ["id"],
  get_impact: ["id"],
  query_metrics: ["id"],
  facility_status: ["roomId"],
  redfish_request: ["server"],
  vcenter_request: [],
  vrops_request: [],
  snmp_request: ["device"],
  bacnet_request: ["device"],
  network_cli: ["device"],
  eapi_request: ["device"],
  nxapi_request: ["device"],
  set_cooling_setpoint: ["unitId"],
  restart_cooling_unit: ["unitId"],
  reset_breaker: ["id"],
  power_server: ["id"],
  list_services: [],
  service_status: ["service"],
  failover_service: ["service"],
  migrate_vm: ["vm", "host"],
  restart_service: ["service"],
  run_command: ["host"],
  wait: [],
  submit_diagnosis: ["rootCause"],
  ask_human: [],
  search_runbooks: [],
  db_status: ["cluster"],
  db_promote: ["instance"],
  db_failover: ["cluster"],
  db_restore: ["instance"],
  kubectl_get: ["cluster"],
  kubectl_describe: ["name"],
  kubectl_logs: ["pod"],
  kubectl_rollout_restart: ["workload"],
  kubectl_scale: ["workload"],
  kubectl_cordon: ["node"],
  kubectl_uncordon: ["node"],
  kubectl_drain: ["node"],
  kubectl_delete_pod: ["pod"],
  lb_status: ["service"],
  lb_drain: ["backend"],
  lb_enable: ["backend"],
  breaker_status: ["service"],
  breaker_reset: ["link"],
  mesh_status: [],
  mesh_rollback: ["control"],
  region_failover: ["region"],
  site_status: [],
  replication_status: [],
  wan_status: [],
  dr_failover: ["site"],
  dr_failback: [],
  dr_drill: [],
  volume_replication_status: ["volume"],
  volume_promote: ["volume", "site"],
  db_cluster_status: ["service"],
  db_node_restart: ["node"],
  db_transfer_leader: ["node"],
  db_managed_status: ["service"],
  db_managed_failover: ["db"],
  db_managed_scale_storage: ["db"],
  gpu_status: ["server"],
  gpu_reset: ["server"],
  ib_status: ["server"],
  job_status: ["job"],
  job_resume: ["job"],
  node_drain: ["node"],
  pool_scale: ["pool"],
  power_status: ["id"],
  bbu_status: ["rack"],
  substation_status: [],
  transfer_feed: ["substation"],
  set_power_cap: ["server"],
  power_cap_status: ["rack"],
  cooling_status: ["id"],
  cdu_status: ["cdu"],
  cdu_pump_switch: ["cdu"],
  storage_status: ["id"],
  storage_path_switch: ["controller"],
  sdn_status: ["controller"],
  sdn_sync: ["switch"],
  sdn_failover: ["controller"],
  overlay_trace: ["src", "dst"],
  evpn_sessions: ["vtep"],
  policy_list: [],
  policy_revert: ["policy"],
  ingress_status: ["ingress"],
  ingress_restart: ["ingress"],
  escalate: [],
  events_since: [],
  create_ticket: [],
  update_ticket: [],
  list_tickets: [],
};

/** Work tickets are the agent's own notes: they change nothing in the world, so they are not acts. */
const TICKET_TOOLS: readonly string[] = ["create_ticket", "update_ticket", "list_tickets"];

/** The entity ids a call names, in argument order, without repeats; nothing for a tool that names none. */
export function callTargets(name: string, args: Readonly<Record<string, unknown>>): string[] {
  const ids: string[] = [];
  for (const key of TARGET_ARGS[name] ?? []) {
    const value = args[key];
    if (typeof value === "string" && value !== "" && !ids.includes(value)) ids.push(value);
  }
  return ids;
}

/** Lines that only look: show commands and the session housekeeping around them. */
const LOOKING = /^\s*(show|sh|enable|en|terminal|term|exit|logout)\b/i;

const eapiCommands = (args: Readonly<Record<string, unknown>>): unknown[] => {
  const params = (args.body as { params?: { cmds?: unknown } } | undefined)?.params;
  return Array.isArray(params?.cmds) ? params.cmds : [];
};

/** Protocol tools that change the world only for some requests: SNMP `set`, BACnet `write-property`, a configuring CLI line. */
const WRITES: Readonly<Record<string, (args: Readonly<Record<string, unknown>>) => boolean>> = {
  snmp_request: (args) => args.operation === "set",
  bacnet_request: (args) => args.service === "write-property",
  run_command: (args) => changesWorld(String(args.cmd)),
  network_cli: (args) =>
    args.configure === true ||
    (Array.isArray(args.commands) && args.commands.some((c) => !LOOKING.test(String(c)))),
  eapi_request: (args) =>
    eapiCommands(args).some(
      (c) => !LOOKING.test(typeof c === "string" ? c : String((c as { cmd?: unknown })?.cmd ?? "")),
    ),
  nxapi_request: (args) =>
    (args.body as { ins_api?: { type?: unknown } } | undefined)?.ins_api?.type === "cli_conf",
};

/**
 * Whether the call changes the world: an `act` of a tool that can change it. A hand-off to a team (`escalate`) is
 * judged `act` by `callEffect` but changes nothing itself, so it is not an action here (REQ-123).
 */
export function isWorldAction(name: string, args: Readonly<Record<string, unknown>>): boolean {
  return callEffect(name, args) === "act" && toolSpec(name)?.mutating === true;
}

/**
 * What the call does: `act` changes the world (a Redfish or vCenter request only when it is not a plain GET),
 * `wait` lets time pass, `answer` hands in the diagnosis, and everything else only looks.
 */
export function callEffect(name: string, args: Readonly<Record<string, unknown>>): CallEffect {
  const spec = toolSpec(name);
  if (!spec) return "observe";
  if (spec.category === "answer") return "answer";
  if (name === "wait") return "wait";
  if (TICKET_TOOLS.includes(name)) return "observe";
  if (spec.category === "act") return "act";
  if (!spec.mutating) return "observe";
  const writes = WRITES[name];
  if (writes) return writes(args) ? "act" : "observe";
  return String(args.method ?? "GET").toUpperCase() === "GET" ? "observe" : "act";
}
