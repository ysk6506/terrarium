/**
 * The topology view's calculation (REQ-078, ADR-0084): what it reads of the builder's world, where the tiles and
 * pipes go, and its words. Its own namespace (`hallTopology`), apart from the rest of the logic, so the screen that
 * does not open the view does not carry it.
 */
export {
  BOARD_W,
  type Column,
  type Layout,
  layout,
  type Pipe,
  type Placed,
  pipeWidth,
  TILE_HALF,
} from "./layout";
export { cutTo, pathFor } from "./path";
export { frameOf, sourceOf } from "./source";
export { drawnText, pictureText, TOPO_WORDS, tileText } from "./words";
