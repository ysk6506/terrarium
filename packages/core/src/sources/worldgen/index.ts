/** core.sources.worldgen: deterministic worlds from site presets and size parameters (REQ-009, REQ-035). */
export { generateWorld, type WorldgenResult } from "./generate";
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
