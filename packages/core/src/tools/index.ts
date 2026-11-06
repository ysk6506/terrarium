/** core.tools: the tool catalog agents can use, and its dispatcher (REQ-007, REQ-031). */
export {
  DEFAULT_TOOLSET,
  type JsonSchema,
  TOOL_NAMES,
  TOOL_SPECS,
  type ToolCategory,
  type ToolSpec,
  toolSpec,
} from "./catalog";
export { OPS_DOCS, OPS_SPECS, TICKET_BUNDLE, TICKET_HELP } from "./catalog-ops";
export {
  onlyDomains,
  SCOPE_TOOLS,
  scopeTools,
  TOOL_DOMAIN,
  type ToolDomain,
  toolDomain,
  toolsForDomains,
  toolsWithoutDomain,
} from "./domains";
export {
  type Args,
  type Diagnosis,
  dependencies,
  dependents,
  locationPath,
  type MetricSource,
  observedState,
  summarizeState,
  type ToolContext,
} from "./handlers";
export type { EscalateAnswer, OpsPort, TicketInput, VisibleEvent } from "./handlers-ops";
export { type CallEffect, callEffect, callTargets } from "./targets";
export { Toolbox, type ToolResult, validateArgs } from "./toolbox";
