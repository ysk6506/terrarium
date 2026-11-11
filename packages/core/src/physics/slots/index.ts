/** core.physics.slots: the physics slots, their numbers and tables, the profile and its fingerprint (REQ-113, ADR-0137). */
export { curveProblems, interpolate, parseWeatherCsv, type WeatherRow } from "./curve";
export { describeSlots, type SlotsView, type SlotView } from "./describe";
export { HAZARD_ROWS, type HazardRow } from "./hazard-table";
export {
  canonicalProfile,
  DEFAULT_FINGERPRINT,
  DEFAULT_PROFILE,
  fingerprintOf,
  isDefaultProfile,
  PHYSICS_BASES,
  type PhysicsBase,
  type PhysicsProfile,
  profileProblems,
  type ScopedParam,
  type WeatherTable,
} from "./profile";
export { defaultsOf, SLOTS, type SlotValues, splitName } from "./registry";
export {
  DEFAULT_PHYSICS_PROFILE_RESOLVED,
  ResolvedPhysics,
  resolveProfile,
} from "./resolved";
export {
  type CurveSpec,
  type FieldSpec,
  type ParamSpec,
  type Point,
  SCOPE_KINDS,
  type ScopeKind,
  SLOT_IDS,
  type SlotId,
  type SlotSpec,
} from "./types";
