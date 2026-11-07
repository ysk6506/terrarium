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
  type CensusText,
  censusText,
  hiddenWarning,
  reasonPhrase,
} from "./agent-census";
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
export * as hallAir from "./air";
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
  ADDRESS_LABELS,
  type AddressKind,
  AGENT_PREVIEW,
  addressKind,
  agentLine,
  KIND_CARDS,
  MCP_WORDS,
  markSlotRegistered,
  matchAgents,
  registerSteps,
  SLOT_CONNECTORS,
  SLOT_PENDING_PROBLEM,
  shortSlotUrl,
  slotRegistered,
  slotToken,
  splitConnections,
} from "./connection-places";
export {
  advancedChanges,
  advancedFields,
  CUSTOM_PRESET,
  presetOf,
  presetProblems,
  presetSettings,
  splitAddress,
  typedUrl,
} from "./connection-presets";
export {
  adapterSpecOf,
  blankTraces,
  TRACES_QUESTION,
  type TracesForm,
  tracesFormOf,
  tracesKind,
  tracesLabel,
  tracesOptions,
  tracesProblems,
  tracesRequest,
} from "./connection-traces";
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
  settingsOf,
  TRANSPORT_LABELS,
} from "./connections";
export * as hallCrew from "./crew";
export * as humanTalk from "./escalation";
export { CARD_WORDS, HUMAN_ACTIONS } from "./escalation";
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
export * as handoffs from "./handoffs";
export { HEADLINES, type Headline, pickHeadline, STARTS, type Start } from "./home-copy";
export * as howWords from "./how-words";
export { Identity, type KeyValueStore, nameProblem } from "./identity";
export {
  applyEvent,
  initialLive,
  type LiveCall,
  type LiveState,
  MAX_LIVE_CALLS,
  parseEvent,
} from "./live";
export * as miniMarkdown from "./mini-markdown";
export {
  blankModelForm,
  cardFacts,
  checkedWhen,
  checkLine,
  createBody as createModelBody,
  DELETE_NOTE,
  deleteText,
  EMPTY_BODY,
  EMPTY_TITLE,
  firstStep as modelFirstStep,
  formOfModel,
  type HeaderRow as ModelHeaderRow,
  hasDefaultModel,
  isKind as isModelKind,
  kindName as modelKindName,
  LIMIT_LINE,
  MODEL_KIND_CARDS,
  MODELS_CHANGED,
  MODELS_HASH,
  MOSS_SLEEP_LINE,
  type ModelForm,
  type ModelKindCard,
  type ModelSectionState,
  modelProblems,
  msText,
  sectionState as modelSectionState,
  updateBody as updateModelBody,
} from "./models";
export {
  NARROW_ABOVE,
  NARROW_LIMIT,
  type Narrowable,
  type Narrowed,
  narrowNote,
  narrowOptions,
} from "./narrow";
export {
  type Aim,
  hasRacks,
  type NextStep,
  nextStep,
  type StepId,
  TOUR_STEPS,
  type TourStep,
  tourLabel,
} from "./next-step";
export * as operationWords from "./operation";
export * as presets from "./presets";
export { quickDraft, quickOperation } from "./quick-draft";
export { type HarmRow, harmRows, withHarm } from "./quick-harm";
export {
  commonPathNote,
  NO_COMMON_PATH_TEXT,
  probeLines,
  recoveryFigures,
  scoringText,
} from "./recovery";
export {
  hrefOf,
  type Page,
  type PageName,
  parseLocation,
  SECTIONS,
  SETTINGS_SECTION,
  sectionOf,
  titleOf,
} from "./router";
export * as runbook from "./runbook";
export * as scenario from "./scenario";
export {
  DEFAULT_SETTINGS,
  readSettings,
  SETTING_DEFS,
  SETTINGS_KEY,
  type SettingDef,
  type SettingKey,
  type Settings,
  type SoundChoice,
  saveSetting,
  type ThemeChoice,
  themeAttribute,
} from "./settings";
export * as shellOutside from "./shell-outside";
export { earnedDay, NO_TITLES, SHOWN_TITLES, titleHint, titleRow } from "./titles";
export * as toolPicker from "./tool-picker";
export { HUMAN_WORDS, TOOL_WORDS } from "./tool-words";
export * as hallTopology from "./topology";
export {
  advanceTour,
  answerTour,
  hasLearned,
  type Lesson,
  learn,
  queueTour,
  readTour,
  type TourMode,
  type TourSave,
  tourMode,
} from "./tour";
export { DEFAULT_QUESTION, type Fact, traceAdvice, tryDetail, tryFacts } from "./try-talk";
export {
  boardEmpty,
  DEFAULT_WORLD_SORT,
  type EmptyBoard,
  evidenceHint,
  evidenceLine,
  likeLabel,
  quietPopular,
  readWorldSort,
  SORT_NOTES,
  saveWorldSort,
  settledLike,
  toggledLike,
  WORLD_SORT_KEY,
  WORLD_SORT_OPTIONS,
} from "./world-board";
export {
  type DraftStep,
  type RowMeta,
  type WorldDraft,
  worldDraft,
  worthKeeping,
} from "./world-draft";
export {
  advance,
  builtFact,
  CARD_LIST_MAX,
  CARDS,
  type Chip,
  type ChipCard,
  capList,
  cardOf,
  chipsOfLayer,
  costText,
  type Diagram,
  type DiagramRow,
  guessWorkload,
  type Join,
  LAYER_INFO,
  LOAD_RULE_ROWS,
  LOAD_RULES,
  PRESET_LABELS,
  type PresetId,
  presetLayers,
  pressesToExperiment,
  QUICK,
  type Resolved,
  type ResolveOptions,
  recommendLine,
  resolveLayers,
  resolveServiceLayers,
  retreat,
  type ShapeView,
  STEPS,
  type Step,
  shapeView,
  workloadView,
} from "./world-shape";
export * as world3d from "./world3d";
export * as worldScale from "./worldgen-scale";
