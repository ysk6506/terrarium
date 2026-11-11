/** core.sources.worldgen: deterministic worlds from site presets and size parameters (REQ-009, REQ-035). */

export {
  type CampusResult,
  type CampusSize,
  campusSize,
  generateCampus,
  type HallSummary,
} from "./campus";
export {
  CONTAINMENT_LABELS,
  HALL_MODE_LABELS,
  type HallContainment,
  type HallMode,
} from "./campus-plan";
export {
  CAMPUS_NUMBERS,
  CAMPUS_PROFILE_LABELS,
  type CampusProfile,
  type CampusSpec,
  campusProblems,
  DEFAULT_CAMPUS,
  MAX_CAMPUS_RACKS,
  MAX_DETAILED_RACKS,
  SITE_CAMPUS_MIX,
} from "./campus-spec";
export { generateWorld, type WorldgenResult } from "./generate";
export {
  type CardOverrides,
  cardOfKey,
  cardWorkload,
  catalogKey,
  draftFromCard,
} from "./service-card";
export { generateShaped, type ShapedResult } from "./shaped";
export {
  customService,
  DEFAULT_SHAPE,
  IAP_DRAFT,
  IAP_HARM,
  IAP_LAYERS,
  IAP_WORKLOAD,
  MIDDLE_LAYERS,
} from "./shaped-defaults";
export {
  buildFor,
  buildOf,
  type HarmTier,
  hostsOf,
  layersOf,
  planShape,
  recount,
  SERVERS_PER_RACK,
  SERVICE_LAYERS,
  type ServiceDraft,
  type ServiceLayerId,
  type ServiceLayers,
  type ServicePart,
  SHAPE_LIMITS,
  type ShapePlan,
  type ShapeSpec,
  type StopRow,
  shapeProblem,
} from "./shaped-plan";
export {
  askOf,
  askTotal,
  BACKGROUND,
  defaultSize,
  fillFor,
  GUESS_LOAD,
  loadOf,
  PER_SERVER,
  SIZE_LIMITS,
  type SizeAsk,
  serversForLoad,
  sizeFields,
  sizeFor,
  sizeFromServers,
  sizeProblem,
  sizeTotals,
  sizingNotes,
  workloadServers,
  worldTotals,
} from "./shaped-sizing";
export {
  outlineLand,
  SITE_SHAPES,
  type SitePlace,
  type SiteShape,
  type SiteSlot,
  shapeOutline,
} from "./sites";
export {
  CHOICE_FIELD_LABELS,
  CHOICE_LABELS,
  DEFAULT_WORLDGEN,
  MAX_RACKS,
  type NumberField,
  rackCount,
  SITE_PRESETS,
  type SiteId,
  type SitePreset,
  sitePreset,
  specProblems,
  WORLDGEN_FIELDS,
  type WorldgenSpec,
} from "./spec";
