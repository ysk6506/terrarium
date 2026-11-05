/** web.logic: browser-side state and logic, testable without a DOM (ADR-0012). */

export {
  type ActivityState,
  applyActivity,
  doingOf,
  EFFECT_LABELS,
  IDLE_MS,
  isIdle,
  MAX_WORKERS,
  nameOf,
  noActivity,
  parseActivity,
  WORKER_HUES,
  type Worker,
} from "./activity";
export {
  addRequest,
  canEditVersions,
  changeText,
  editRequest,
  type Pending,
  pendingOf,
  type VersionForm,
  versionFormOf,
  versionTitle,
} from "./agent-versions";
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
export {
  blankForm,
  type ConnectionForm,
  configOf,
  EXPIRY_WARNING_DAYS,
  type Expiry,
  expiringNotice,
  expiryOf,
  formOf,
  formProblems,
  type HeaderRow,
  headersOf,
  type MetaRow,
  metadataOf,
  metaProblems,
  TRANSPORT_LABELS,
} from "./connections";
export * as experiment from "./experiment";
export {
  celsius,
  count,
  dateText,
  formatDuration,
  meanText,
  PASS_RULE_TEXT,
  PASS_SHARE_TEXT,
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
export { HEADLINES, type Headline, pickHeadline, STARTS, type Start } from "./home-copy";
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
  NARROW_ABOVE,
  NARROW_LIMIT,
  type Narrowable,
  type Narrowed,
  narrowNote,
  narrowOptions,
} from "./narrow";
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
export * as world3d from "./world3d";
