/** core.analysis: result analysis, leaderboards, share renderings and diagnosis export (REQ-015, REQ-037–040). */
export {
  analyzeExperiment,
  type CriterionRate,
  type ExperimentAnalysis,
  type ExperimentInput,
  type ParentComparison,
} from "./experiment";
export {
  buildLeaderboards,
  type Leaderboard,
  type LeaderboardRow,
  MIN_RUNS_TO_RANK,
} from "./leaderboard";
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
