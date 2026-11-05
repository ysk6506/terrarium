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
  | "firmware_update";

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
  /** Which built-in template it came from, if any (informational). */
  readonly template?: string;
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
