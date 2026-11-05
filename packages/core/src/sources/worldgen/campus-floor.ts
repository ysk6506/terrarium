/**
 * The floor plan of a data-centre building that has the size of a real one (REQ-076, ADR-0081): where each
 * room stands on each storey. A server storey keeps its server rooms to the white space (55 to 60 % of the
 * floor), a column of electrical room, mechanical room and storeroom down one side, and the rest bare for the
 * core and for rooms to grow into. The ground storey holds the lobby and loading bay, a storeroom, the network
 * room and the control room. Pure numbers: the same size gives the same plan.
 */
import type { Rect } from "@terrarium/core/spatial";
import { WHITE_FLOOR_SHARE } from "@terrarium/core/world";

export interface Size {
  readonly w: number;
  readonly d: number;
}

/** Rooms stand on the raised-floor tile (0.6 m) so that the builder's tile grid never moves one by a hair when it is resized. */
const TILE_M = 0.6;
/** Space left between a room and the wall or the next room (a corridor), metres. */
const GAP_M = 1.8;
const EDGE_M = 1.2;
/** Width of the column of support rooms, metres. */
const SUPPORT_W_M = 24;
/** Depth of each support room, metres: the electrical room holds the storey's UPS, switchgear and transfer switches. */
const ELECTRICAL_D_M = 39.6;
const MECHANICAL_D_M = 12;
const STORAGE_D_M = 7.8;

const thousandth = (v: number) => Math.round(v * 1000) / 1000;
/** A length of whole tiles, never longer than asked. */
const tiles = (v: number) => thousandth(Math.floor(v / TILE_M + 1e-9) * TILE_M);
const rect = (x: number, y: number, w: number, d: number): Rect => ({
  x: thousandth(x),
  y: thousandth(y),
  w: tiles(w),
  d: tiles(d),
});

/** Server rooms on a storey: two, and three on the fifth (a storey cut in three has less white space left after the walls and cooling). */
export const hallsOnFloor = (level: number): number => (level === 5 ? 3 : 2);

/** The share of the floor the server rooms take on a storey: 57 to 60 % (the upper part of the 55 to 60 % range), a little different on each. */
export function whiteShare(level: number): number {
  const steps = 4;
  const span = WHITE_FLOOR_SHARE.high - WHITE_FLOOR_SHARE.low;
  return WHITE_FLOOR_SHARE.low + span * (0.4 + (0.6 * ((level * 3) % steps)) / (steps - 1));
}

export interface ServerFloorPlan {
  readonly halls: readonly Rect[];
  readonly electrical: Rect;
  readonly mechanical: Rect;
  readonly storage: Rect;
}

export function serverFloorPlan(size: Size, level: number): ServerFloorPlan {
  const count = hallsOnFloor(level);
  const x0 = EDGE_M + SUPPORT_W_M + GAP_M;
  const w = size.w - x0 - EDGE_M;
  const stack = (count - 1) * GAP_M;
  const total = Math.min(size.d - 2 * EDGE_M, (whiteShare(level) * size.w * size.d) / w + stack);
  const each = tiles((total - stack) / count);
  const e = EDGE_M;
  return {
    halls: Array.from({ length: count }, (_, i) => rect(x0, e + i * (each + GAP_M), w, each)),
    electrical: rect(e, e, SUPPORT_W_M, ELECTRICAL_D_M),
    mechanical: rect(e, e + ELECTRICAL_D_M + GAP_M, SUPPORT_W_M, MECHANICAL_D_M),
    storage: rect(e, e + ELECTRICAL_D_M + MECHANICAL_D_M + 2 * GAP_M, SUPPORT_W_M, STORAGE_D_M),
  };
}

export interface GroundFloorPlan {
  readonly lobby: Rect;
  readonly storage: Rect;
  readonly noc: Rect;
  readonly mmr: Rect;
}

export function groundFloorPlan(): GroundFloorPlan {
  return {
    lobby: rect(EDGE_M, EDGE_M, 40.2, 24),
    storage: rect(EDGE_M + 40.2 + GAP_M, EDGE_M, 30, 24),
    noc: rect(EDGE_M, EDGE_M + 24 + GAP_M, 16.2, 10.2),
    mmr: rect(EDGE_M + 16.2 + GAP_M, EDGE_M + 24 + GAP_M, 13.8, 10.2),
  };
}
