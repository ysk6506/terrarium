/** core.session: one running simulation — world, physics, scenario, tools and recorder (REQ-001, REQ-007, REQ-014). */
export {
  DEFAULT_RECORDER,
  MetricRecorder,
  type MetricSeries,
  RECORDED_METRICS,
  type RecorderCapture,
  type RecorderOptions,
} from "./recorder";
export {
  type CallResult,
  DEFAULT_TIME,
  type RunResult,
  Session,
  type SessionConfig,
  type SessionStatus,
  type TimePolicy,
} from "./session";
export { buildTimeline, type TimelineEntry, type TimelineSource } from "./timeline";
export { type WarmStart, WarmStartCache } from "./warm";
