/** core.sources.worldgen: deterministic worlds from site presets and size parameters (REQ-009, REQ-035). */

export { type CampusResult, generateCampus, type HallSummary } from "./campus";
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
} from "./campus-spec";
export { generateWorld, type WorldgenResult } from "./generate";
export { outlineLand, SITE_SHAPES, type SiteShape, shapeOutline } from "./sites";
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
