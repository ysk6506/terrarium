/** web.logic: browser-side state and logic, testable without a DOM (ADR-0012). */
export {
  type Api,
  ApiError,
  type ApiOptions,
  type CallInput,
  createApi,
  type FetchLike,
  NETWORK_MESSAGE,
} from "./api";
export * as builder from "./builder";
export { type Box, type LineChart, lineChart, niceTicks, scoreBar } from "./charts";
export * as experiment from "./experiment";
export {
  celsius,
  count,
  dateText,
  formatDuration,
  meanText,
  percent,
  relativeTime,
  STATUS_TONES,
  scoreText,
  simTime,
  statusLabel,
  type Tone,
  watts,
  won,
} from "./format";
export { Identity, type KeyValueStore, nameProblem } from "./identity";
export {
  applyEvent,
  initialLive,
  type LiveCall,
  type LiveState,
  MAX_LIVE_CALLS,
  parseEvent,
} from "./live";
export {
  hrefOf,
  type Page,
  type PageName,
  parseLocation,
  SECTIONS,
  sectionOf,
  titleOf,
} from "./router";
export * as scenario from "./scenario";
