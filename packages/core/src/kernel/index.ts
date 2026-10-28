/** core.kernel: ids, errors, Clock/Rng/IdGenerator ports, stable hashing, the only entropy entry point. */
export { type Clock, ManualClock } from "./clock";
export { freshSeed, isoNow, randomToken, wallClockMs } from "./entropy";
export {
  asTerrariumError,
  ConflictError,
  InvalidValueError,
  NotFoundError,
  ReadOnlyViolationError,
  TerrariumError,
  UnsupportedError,
} from "./errors";
export { hash53, hashHex, hashValue, stableStringify } from "./hash";
export {
  type EntityId,
  entityId,
  type IdGenerator,
  isEntityId,
  joinId,
  SequentialIds,
  slug,
} from "./ids";
export { type Rng, SeededRng } from "./rng";
export {
  approach,
  clamp,
  RACK_DEPTH_M,
  RACK_UNITS_DEFAULT,
  RACK_WIDTH_M,
  round,
  U_HEIGHT_M,
} from "./units";
