/** core.session: one running simulation — world, physics, scenario, tools and recorder (REQ-001, REQ-007, REQ-014). */
export {
  BASELINE_SUMMARY,
  type BaselineId,
  type BaselineRun,
  baselineRun,
  type Calibration,
  calibrate,
  FLOOR_LIMIT,
  GUESS,
  IDLE_ROUNDS,
  IDLE_WAIT_SECONDS,
  judge,
  knownAnswer,
  NO_COMMON_PATH,
  withProbes,
} from "./baselines";
export {
  DEFAULT_AUTO_REPLY,
  DEFAULT_ESCALATION,
  ESCALATION_LABELS,
  type EscalationMode,
  type EscalationPolicy,
  type HumanAct,
  type HumanRequest,
  type HumanResolution,
  type HumanSummary,
} from "./human";
export {
  type CommonReach,
  commonReach,
  REACH_CALLS,
  type RecoveryPath,
  recoveryPath,
} from "./probes";
export {
  DEFAULT_RECORDER,
  MetricRecorder,
  type MetricSeries,
  RECORDED_METRICS,
  type RecorderCapture,
  type RecorderOptions,
} from "./recorder";
export { type CallStamp, legacyEvents, RunLog, stampReal } from "./run-events";
export {
  type CallResult,
  DEFAULT_TIME,
  type FaultScope,
  type RunResult,
  Session,
  type SessionConfig,
  type SessionStatus,
  type SopMode,
  type SopResult,
  type TimePolicy,
} from "./session";
export { buildTimeline, type TimelineEntry, type TimelineSource } from "./timeline";
export {
  type AmbiguousPair,
  PICK_SITUATIONS,
  type PickRow,
  type PickSituation,
  type ToolPickCheck,
  toolPickCheck,
} from "./tool-pick";
export { type WarmStart, WarmStartCache } from "./warm";
