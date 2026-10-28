/** core.scenario: the workflow scenario model, its block palette, validation and deterministic runner (REQ-033, REQ-034). */
export {
  BLOCK_SPECS,
  type BlockCategory,
  type BlockSpec,
  blockSpec,
  CATEGORY_LABELS,
  CONDITION_FIELDS,
  type FieldSpec,
  outputsOf,
  type ParamSpec,
  PORT_LABELS,
} from "./blocks";
export {
  type AgentSignals,
  compare,
  describe as describeCondition,
  evaluate,
  matchesCall,
  NO_AGENT,
  type ToolCallRecord,
} from "./conditions";
export { scenarioDigest } from "./digest";
export { SCENARIO_TEMPLATES, type ScenarioTemplate, scenarioTemplate } from "./library";
export {
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
export { defaultParams, FAULT_DOMAIN_LABELS, type PaletteItem, paletteFor } from "./palette";
export { type AgentTask, ScenarioRunner, type TraceEntry } from "./runner";
export {
  hasErrors,
  MAX_NODES,
  type ScenarioEnv,
  type ScenarioIssue,
  validateScenario,
} from "./validate";
