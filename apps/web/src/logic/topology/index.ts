/**
 * The topology view's calculation (REQ-078, ADR-0084): what it reads of the builder's world, where the tiles and
 * pipes go, and its words. Its own namespace (`hallTopology`), apart from the rest of the logic, so the screen that
 * does not open the view does not carry it.
 */
export {
  BOARD_W,
  type Column,
  fitHead,
  headWidth,
  type Layout,
  layout,
  type Pipe,
  type Placed,
  pipeWidth,
  TILE_HALF,
} from "./layout";
export { cutTo, pathFor } from "./path";
export {
  advance,
  type Bar,
  type Bubble,
  barsOf,
  bubbleOf,
  clamp,
  DEFAULT_SPEED,
  KEY_STEP_S,
  keyedT,
  type Moment,
  momentAt,
  nearestFrame,
  PULSE_MS,
  pct,
  ratioOf,
  relative,
  SPEEDS,
  serversMoved,
  type Tick,
  ticks,
  valueText,
  whoText,
} from "./replay";
export { frameOf, sourceOf } from "./source";
export { drawnText, pictureText, TOPO_WORDS, tileText } from "./words";
