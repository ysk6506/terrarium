/**
 * The scenario document (REQ-033, REQ-034). It is what the no-code editor saves, the runner executes
 * and the oracle scores. Two parts:
 *
 *   flow          a graph of blocks (start → wait → inject fault → agent task → ...) run in simulated time
 *   expectations  the scoring sheet: expected diagnosis, required/forbidden actions, final state, limits
 *
 * Entities are referenced by id, so a scenario belongs to one world (`worldId`). Positions and labels
 * are layout only: they never change the scenario's digest (see digest.ts).
 */
import type { Runbook } from "@terrarium/core/tools";

export const SCENARIO_SCHEMA_VERSION = 1;

export type CompareOp = "<" | "<=" | ">" | ">=" | "==" | "!=";

/**
 * What an agent did to the world, whichever tool it used (a power-off through power_server and one
 * through a Redfish ComputerSystem.Reset are the same action). Scoring judges actions, not tool names,
 * so experiments with different toolsets stay comparable (ADR-0019).
 */
export type ActionKind =
  | "power_off"
  | "power_on"
  | "restart"
  | "breaker_reset"
  | "setpoint_change"
  | "port_shutdown"
  | "port_enable"
  | "outlet_off"
  | "outlet_on"
  | "config_change"
  | "firmware_update"
  | "service_failover"
  | "service_restart"
  | "process_restart"
  | "disk_cleanup"
  | "fs_remount"
  | "vm_migrate"
  | "db_promote"
  | "db_failover"
  | "db_restore"
  | "path_switch"
  | "sdn_sync"
  | "sdn_failover"
  | "policy_revert"
  | "ingress_restart"
  | "k8s_rollout_restart"
  | "k8s_scale"
  | "k8s_cordon"
  | "k8s_drain"
  | "k8s_delete_pod"
  | "lb_drain"
  | "lb_enable"
  | "circuit_reset"
  | "mesh_rollback"
  | "region_failover";

export const ACTION_LABELS: Readonly<Record<ActionKind, string>> = {
  power_off: "전원 끄기",
  power_on: "전원 켜기",
  restart: "재시작",
  breaker_reset: "차단기 리셋",
  setpoint_change: "냉방 설정 변경",
  port_shutdown: "포트 끄기",
  port_enable: "포트 켜기",
  outlet_off: "콘센트 끄기",
  outlet_on: "콘센트 켜기",
  config_change: "스위치 설정 변경",
  firmware_update: "펌웨어 올리기",
  service_failover: "서비스를 대기 쪽으로 옮기기",
  service_restart: "서비스 다시 시작",
  process_restart: "프로세스 다시 시작",
  disk_cleanup: "디스크 비우기",
  fs_remount: "파일시스템 다시 마운트",
  vm_migrate: "VM 다른 서버로 옮기기",
  db_promote: "인스턴스 승격",
  db_failover: "클러스터 페일오버",
  db_restore: "백업에서 복원",
  path_switch: "스토리지 경로 전환",
  sdn_sync: "스위치 설정 재동기화",
  sdn_failover: "SDN 컨트롤러 전환",
  policy_revert: "네트워크 정책 되돌리기",
  ingress_restart: "인그레스 다시 시작",
  k8s_rollout_restart: "롤아웃 재시작",
  k8s_scale: "레플리카 수 바꾸기",
  k8s_cordon: "노드 cordon·uncordon",
  k8s_drain: "노드 drain",
  k8s_delete_pod: "파드 지우기",
  lb_drain: "백엔드 빼기(drain)",
  lb_enable: "백엔드 되돌리기",
  circuit_reset: "서킷 브레이커 리셋",
  mesh_rollback: "메시 설정 되돌리기",
  region_failover: "리전 옮기기",
};

export const ACTION_KINDS = Object.keys(ACTION_LABELS) as ActionKind[];

export interface AgentAction {
  readonly action: ActionKind;
  /** What the command named: a switch or PDU, or the network link of a port. */
  readonly target: string;
  /** For a port: the switch it belongs to, so scoring can say "no port of the core switch" without link ids. */
  readonly device?: string;
}
export const COMPARE_OPS: readonly CompareOp[] = ["<", "<=", ">", ">=", "==", "!="];

/** A question about the world or the agent, asked by branch/wait_until blocks and by expectations. */
export type Condition =
  /** A state field of one entity, e.g. srv-a1.inletC > 35. */
  | {
      readonly kind: "state";
      readonly entity: string;
      readonly field: string;
      readonly op: CompareOp;
      readonly value: number | boolean | string;
    }
  /** Whether an alarm matching the filters is active (`active: false` asks for "no such alarm"). */
  | {
      readonly kind: "alarm";
      readonly active: boolean;
      readonly entity?: string;
      readonly code?: string;
      readonly severity?: "warning" | "critical";
    }
  /** Whether the agent has called a tool (optionally on a given target). */
  | { readonly kind: "tool_called"; readonly tool: string; readonly target?: string }
  /** Whether the agent has done something to the world (optionally to a given target), by any tool. */
  | { readonly kind: "action_taken"; readonly action: ActionKind; readonly target?: string }
  /**
   * Whether something happened in the world at least once since the scenario started (`occurred: false` asks for
   * "never"). `type` is a world event ("thermal.shutdown": a server shut itself down on heat); `target` narrows it
   * to one entity or link. It looks at the history, not at the state now, so it answers "was ever" questions.
   */
  | {
      readonly kind: "event";
      readonly type: string;
      readonly target?: string;
      readonly occurred?: boolean;
    }
  /** Whether the agent has submitted its diagnosis. */
  | { readonly kind: "diagnosis_submitted" }
  | { readonly kind: "all"; readonly of: readonly Condition[] }
  | { readonly kind: "any"; readonly of: readonly Condition[] };

export type ParamValue = string | number | boolean | Condition | Readonly<Record<string, number>>;

export interface ScenarioNode {
  readonly id: string;
  readonly type: string;
  readonly params: Readonly<Record<string, ParamValue>>;
  /** Editor canvas position (layout only). */
  readonly position: { readonly x: number; readonly y: number };
  /** Optional caption shown on the canvas (layout only). */
  readonly label?: string;
}

export interface ScenarioEdge {
  readonly id: string;
  readonly from: string;
  /** Output port of `from`, e.g. "next", "yes", "no", "met", "timeout", "1". */
  readonly port: string;
  readonly to: string;
}

interface ExpectationBase {
  readonly id: string;
  /** What a person reads in the result (layout only). */
  readonly label?: string;
}

/** Points for a correct diagnosis; any listed root cause / fault type counts as correct. */
export interface DiagnosisExpectation extends ExpectationBase {
  readonly kind: "diagnosis";
  readonly rootCause: readonly string[];
  readonly faultType: readonly string[];
  readonly weight: number;
}

/** Points if the condition holds when the run ends (e.g. "every server is still powered"). */
export interface FinalStateExpectation extends ExpectationBase {
  readonly kind: "final_state";
  readonly condition: Condition;
  readonly weight: number;
}

/** Points if the agent did this to the world (to this target) at least once, by any tool. */
export interface RequiredActionExpectation extends ExpectationBase {
  readonly kind: "required_action";
  readonly action: ActionKind;
  readonly target?: string;
  readonly weight: number;
}

/** A penalty, in points, each time the agent does this to the world (to this target), by any tool. */
export interface ForbiddenActionExpectation extends ExpectationBase {
  readonly kind: "forbidden_action";
  readonly action: ActionKind;
  readonly target?: string;
  readonly penalty: number;
}

/** Points if the diagnosis came within this many simulated seconds of the agent task starting. */
export interface TimeLimitExpectation extends ExpectationBase {
  readonly kind: "time_limit";
  readonly seconds: number;
  readonly weight: number;
}

/** Points if the agent used at most this many tool calls. */
export interface ToolBudgetExpectation extends ExpectationBase {
  readonly kind: "tool_budget";
  readonly maxCalls: number;
  readonly weight: number;
}

export type Expectation =
  | DiagnosisExpectation
  | FinalStateExpectation
  | RequiredActionExpectation
  | ForbiddenActionExpectation
  | TimeLimitExpectation
  | ToolBudgetExpectation;

export type ExpectationKind = Expectation["kind"];

export interface ScenarioDoc {
  readonly schemaVersion: number;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** The world (blueprint id) whose entities this scenario references. */
  readonly worldId: string;
  readonly nodes: readonly ScenarioNode[];
  readonly edges: readonly ScenarioEdge[];
  readonly expectations: readonly Expectation[];
  /**
   * How the sheet is scored. Absent means the items as written. `recovery` is for a scenario with services (ADR-0091
   * item 3): the score is the services' recovery time, the order, no harm on the way, and the report; the sheet then
   * supplies the diagnosis, the prohibitions and the conditions for a lasting recovery.
   */
  readonly scoring?: "recovery";
  /** Which built-in template it came from, if any (informational). */
  readonly template?: string;
  /** The team's way of handling this situation (ADR-0087 item 6); the experiment decides whether the agent gets it. */
  readonly runbook?: Runbook;
}

/** An empty scenario with just a start block, as the editor creates it. */
export function emptyScenario(id: string, worldId: string, name = "새 시나리오"): ScenarioDoc {
  return {
    schemaVersion: SCENARIO_SCHEMA_VERSION,
    id,
    name,
    description: "",
    worldId,
    nodes: [{ id: "start", type: "start", params: {}, position: { x: 0, y: 0 } }],
    edges: [],
    expectations: [],
  };
}

/** Values in tool-call arguments that name a target entity. */
export const TARGET_ARGS: readonly string[] = ["id", "unitId", "server", "entityId", "target"];

/** The entity ids a tool call acted on, read from its arguments. */
export function callTargets(args: Readonly<Record<string, unknown>>): string[] {
  return TARGET_ARGS.map((key) => args[key]).filter((v): v is string => typeof v === "string");
}
