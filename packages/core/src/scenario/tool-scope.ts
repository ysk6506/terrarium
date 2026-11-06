/**
 * Which tools solve which fault (ADR-0087 item 5). Every fault and every mistake lists the tools that fix it or
 * limit its harm, written down in the core next to the definitions of the faults, so an experiment that gives
 * fewer tools can tell, before it starts, which scenarios it can still ask an agent to solve. A scenario whose
 * fault no given tool reaches is out of scope: the agent could only diagnose it and call for help.
 *
 * `tests/spec/tool-scope.test.ts` checks the table both ways: a fault with no entry fails the test, and the tools
 * of a fault must be exactly the tools of the control rows its remedy goes through (controls.ts).
 */
import {
  diagnosisLabel,
  type FaultType,
  isFaultType,
  type MistakeType,
} from "@terrarium/core/world";
import { MISTAKE_OF_BLOCK } from "./blocks-net";
import type { Remedy } from "./controls";
import type { ScenarioDoc } from "./model";

export type ScopeKey = FaultType | MistakeType;

export interface ToolNeed {
  /** `fix` clears it, `mitigate` limits the harm, `diagnose` has no remote cure: the answer is the diagnosis. */
  readonly remedy: Remedy;
  /** Any one of these tools is enough; the first is the one "필요한 것만 켜기" picks. Empty for `diagnose`. */
  readonly tools: readonly string[];
}

const SHED = ["power_server", "redfish_request"] as const;
const COOLING = ["set_cooling_setpoint", "bacnet_request", ...SHED] as const;
const HOST = ["run_command", "restart_service"] as const;
const NET = ["network_cli", "eapi_request", "nxapi_request"] as const;
const NONE: ToolNeed = { remedy: "diagnose", tools: [] };

const fix = (...tools: readonly string[]): ToolNeed => ({ remedy: "fix", tools });
const limit = (...tools: readonly string[]): ToolNeed => ({ remedy: "mitigate", tools });

/** The tools that solve each fault and each mistake. */
export const FAULT_TOOLS: Readonly<Record<ScopeKey, ToolNeed>> = {
  cooling_unit_failure: limit(...COOLING),
  cooling_unit_degraded: limit(...COOLING),
  setpoint_drift: limit("set_cooling_setpoint", "bacnet_request"),
  breaker_trip: fix("reset_breaker", "redfish_request"),
  grid_outage: limit(...SHED),
  ups_battery_degraded: NONE,
  utility_outage: limit("bacnet_request", ...SHED),
  chiller_failure: limit(...COOLING),
  chiller_degraded: limit(...SHED),
  cdu_failure: limit(...SHED),
  cdu_pump_failure: limit(...SHED),
  coolant_leak: limit(...SHED),
  immersion_circulation_failure: limit(...SHED),
  generator_start_failure: limit(...SHED),
  ats_stuck: limit(...SHED),
  fan_failure: limit(...SHED),
  psu_failure: NONE,
  sensor_drift: NONE,
  cpu_runaway: limit(...SHED),
  bmc_unresponsive: NONE,
  memory_failure: NONE,
  firmware_update_failure: fix("redfish_request"),
  link_down: NONE,
  switch_failure: NONE,
  disk_failure: NONE,
  vm_cpu_spike: limit("vcenter_request"),
  disk_full: fix("run_command"),
  log_flood: fix(...HOST),
  memory_leak: limit(...HOST, "failover_service"),
  process_crashloop: limit("failover_service"),
  zombie_pileup: fix(...HOST),
  fs_readonly: fix("run_command"),
  ntp_drift: fix(...HOST),
  dns_failure: fix(...HOST),
  kernel_panic: limit("failover_service"),
  cert_expired: NONE,
  db_primary_down: limit("db_promote", "db_failover", "db_restore"),
  db_secondary_down: fix("run_command"),
  db_replication_broken: fix("run_command"),
  db_split_brain: fix("db_promote"),
  db_backup_corrupt: NONE,
  storage_path_cut: limit("storage_path_switch"),
  storage_controller_failure: limit("storage_path_switch"),
  storage_node_lost: NONE,
  port_vlan_mismatch: fix(...NET),
  port_shutdown: fix(...NET, "snmp_request"),
  svi_shutdown: fix(...NET),
  bgp_neighbor_shutdown: fix(...NET),
  route_missing: fix(...NET),
  outlet_off: fix("redfish_request"),
};

/** Tools every investigation starts with; "필요한 것만 켜기" always includes them. */
export const BASE_TOOLS: readonly string[] = ["list_alarms", "submit_diagnosis"];

/** The faults and mistakes a scenario puts into the world, from its blocks. */
export function scenarioProblems(doc: ScenarioDoc): ScopeKey[] {
  const found: ScopeKey[] = [];
  for (const node of doc.nodes) {
    const type = node.type === "inject_fault" ? String(node.params.faultType ?? "") : "";
    if (isFaultType(type)) found.push(type);
    const mistake = MISTAKE_OF_BLOCK[node.type];
    if (mistake) found.push(mistake);
  }
  return [...new Set(found)];
}

/**
 * The ones the scenario is about: those its diagnosis names. The rest are background (a second, smaller trouble
 * the story adds). A scenario that asks for no diagnosis is about all of them.
 */
export function mainProblems(doc: ScenarioDoc): ScopeKey[] {
  const all = scenarioProblems(doc);
  const named = new Set(
    doc.expectations.flatMap((e) => (e.kind === "diagnosis" ? e.faultType : [])),
  );
  if (named.size === 0) return all;
  const main = all.filter((p) => named.has(p));
  return main.length > 0 ? main : all;
}

/** Whether `have` reaches a problem: a problem nothing remote cures is always reachable (it is diagnosed). */
export function reaches(problem: ScopeKey, have: ReadonlySet<string>): boolean {
  const need = FAULT_TOOLS[problem];
  return need.tools.length === 0 || need.tools.some((t) => have.has(t));
}

export interface ScopeCheck {
  readonly inScope: boolean;
  /** The main problems no given tool reaches, with the tools that would. */
  readonly missing: readonly { readonly problem: ScopeKey; readonly tools: readonly string[] }[];
  /** In plain Korean, when out of scope: which tool is missing. */
  readonly reason?: string;
}

/** Whether an agent with `tools` can solve the scenario's main problems; says what is missing if not. */
export function scopeCheck(doc: ScenarioDoc, tools: readonly string[]): ScopeCheck {
  const have = new Set(tools);
  const missing = mainProblems(doc)
    .filter((p) => !reaches(p, have))
    .map((problem) => ({ problem, tools: FAULT_TOOLS[problem].tools }));
  if (missing.length === 0) return { inScope: true, missing };
  const first = missing[0] as (typeof missing)[number];
  const lead = first.tools[0] as string;
  return { inScope: false, missing, reason: `\`${lead}\`이 없어서 풀 수 없어요` };
}

/**
 * The tools a scenario needs, the fewest that reach every main problem: for each one the first tool of its list
 * that is already wanted, else the first (preferring tools a real team has without raw protocol access).
 */
export function requiredTools(doc: ScenarioDoc): string[] {
  const picked = new Set<string>(BASE_TOOLS);
  for (const problem of mainProblems(doc)) {
    const { tools } = FAULT_TOOLS[problem];
    if (tools.length === 0 || tools.some((t) => picked.has(t))) continue;
    picked.add(tools[0] as string);
  }
  return [...picked];
}

/** A fault or mistake in words, for lists. */
export const problemName = (problem: ScopeKey): string => diagnosisLabel(problem);
