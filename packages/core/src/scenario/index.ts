/** core.scenario: the workflow scenario model, its block palette, validation and deterministic runner (REQ-033, REQ-034). */
export {
  BLOCK_SPECS,
  type BlockCategory,
  type BlockSpec,
  blockSpec,
  CATEGORY_LABELS,
  CONDITION_FIELDS,
  type FieldSpec,
  type NetPick,
  outputsOf,
  type ParamSpec,
  PORT_LABELS,
} from "./blocks";
export {
  type AgentSignals,
  actionsOf,
  agentActions,
  compare,
  type Diagnosis,
  describe as describeCondition,
  evaluate,
  matchesAction,
  matchesCall,
  NO_AGENT,
  type ToolCallRecord,
} from "./conditions";
export {
  type AgentRoute,
  CONTROL_ROWS,
  type ControlRow,
  FAULT_RESPONSES,
  type FaultResponse,
  NOT_OPERATOR,
  type OperatorCommand,
  type Remedy,
} from "./controls";
export { scenarioDigest } from "./digest";
export { EVENT_LABELS, EVENT_TYPES, type EventType, eventTarget, isEventType } from "./events";
export {
  ALL_SCENARIO_TEMPLATES,
  FACILITY_TEMPLATES,
  FIRMWARE_TEMPLATES,
  NETWORK_TEMPLATES,
  OS_TEMPLATES,
  SCENARIO_TEMPLATES,
  type ScenarioTemplate,
  scenarioTemplate,
  TEMPLATE_GROUPS,
} from "./library";
export {
  ACTION_KINDS,
  ACTION_LABELS,
  type ActionKind,
  type AgentAction,
  COMPARE_OPS,
  type CompareOp,
  type Condition,
  callTargets,
  type DiagnosisExpectation,
  type Expectation,
  type ExpectationKind,
  emptyScenario,
  type FinalStateExpectation,
  type ForbiddenActionExpectation,
  type ParamValue,
  type RequiredActionExpectation,
  SCENARIO_SCHEMA_VERSION,
  type ScenarioDoc,
  type ScenarioEdge,
  type ScenarioNode,
  TARGET_ARGS,
  type TimeLimitExpectation,
  type ToolBudgetExpectation,
} from "./model";
export { builtinCatalog, type NetChoice, netChoices, netEmptyText } from "./net-blocks";
export { defaultParams, FAULT_DOMAIN_LABELS, type PaletteItem, paletteFor } from "./palette";
export { type AgentTask, type RunnerOptions, ScenarioRunner, type TraceEntry } from "./runner";
export {
  draftFromCalls,
  type SopCall,
  type SopCompliance,
  type SopStepResult,
  scoreSop,
} from "./sop";
export {
  BASE_TOOLS,
  FAULT_TOOLS,
  mainProblems,
  problemName,
  reaches,
  requiredTools,
  type ScopeCheck,
  type ScopeKey,
  scenarioProblems,
  scopeCheck,
  type ToolNeed,
} from "./tool-scope";
export { minutesText, toMinutes, toSeconds } from "./units";
export {
  hasErrors,
  MAX_NODES,
  type ScenarioEnv,
  type ScenarioIssue,
  validateScenario,
} from "./validate";
