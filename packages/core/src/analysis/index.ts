/** core.analysis: result analysis, leaderboards, share renderings and diagnosis export (REQ-015, REQ-037–040). */
export {
  analyzeExperiment,
  type CriterionRate,
  type ExperimentAnalysis,
  type ExperimentInput,
  endLabelOf,
  type ParentComparison,
} from "./experiment";
export {
  buildLeaderboards,
  type Leaderboard,
  type LeaderboardRow,
  MIN_SEEDS_TO_RANK,
} from "./leaderboard";
export {
  actionLabel,
  actionsFor,
  deriveNeeds,
  faultTypesOf,
  MISTAKE_ACTIONS,
  type OntologyAction,
  type OntologyCount,
  type OntologyNeeds,
  PHYSICAL_ACTION,
  TASK_ACTIONS,
} from "./ontology";
export {
  DOER_LABELS,
  DOERS,
  type Doer,
  deriveUse,
  type OntologyUse,
  type UsedAction,
  type UseRun,
} from "./ontology-use";
export {
  baselineNumbers,
  deltaNumbers,
  meanNumbers,
  type ProcessNumbers,
  remainingLine,
  TAG_LABELS,
  typicalRun,
} from "./process-compare";
export {
  AGENT_WHO,
  type FoldInput,
  foldRun,
  HUMAN_WHO,
  type LedgerRow,
  type LedgerTag,
  type RunProcess,
} from "./process-steps";
export {
  escapeHtml,
  metricLabel,
  type RenderOptions,
  renderHtml,
  renderMarkdown,
  renderText,
  sparkline,
} from "./render";
export { analyzeRun, type RunAnalysis } from "./run";
export {
  groupBySeed,
  meanOf,
  type SeedGroup,
  seedMeans,
  seedRate,
  seedSummary,
  splitSeeds,
  withinSeedSpread,
} from "./seeds";
export { clearlyDifferent, ratio, type Summary, summarize, tCritical } from "./stats";
export {
  type AttributeValue,
  costOf,
  type LogLine,
  type MetricPoint,
  type ModelUsage,
  NO_TELEMETRY,
  type Span,
  type SpanKind,
  spanKind,
  type Telemetry,
  type TelemetryAdapter,
  type TelemetryPort,
  traceIdOf,
  usageOf,
} from "./telemetry";
export { type RuleSummary, type TrustSummary, trustSummary } from "./trust";
export {
  type BriefInput,
  DIAGNOSIS_SCHEMA,
  type DiagnosisRecord,
  diagnosisRecords,
  errorPattern,
  type FaultTypeStats,
  faultTypeStats,
  fromJsonl,
  modelingBrief,
  type ToolErrorStats,
  toJsonl,
  toolErrorStats,
  type WorldGaps,
} from "./twin";
