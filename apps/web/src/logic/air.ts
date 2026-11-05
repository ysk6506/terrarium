/**
 * The calculation of the airflow map (REQ-072, ADR-0074): the temperature of the floor, the paths the air takes and
 * the colours. Kept in a namespace of its own, apart from `world3d`, so the screen that has no map does not carry it:
 * the view loads this only when the map is opened. The map's words stay in `world3d` (`AIR_WORDS`).
 */
export {
  AIR_SCALES,
  ARROWS_PER_PATH,
  airColor,
  airflowOf,
  aisleReach,
  CRITICAL_C,
  doorColor,
  fieldAt,
  frameText,
  hottestOf,
  hottestText,
  loadShareOf,
  marginText,
  PUFF_BUDGET,
  WARN_C,
  workBounds,
} from "./world3d/airflow";
