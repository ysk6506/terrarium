/**
 * What a fab's cleanroom looks like from above (REQ-006, REQ-043): rows of process tools in bays with a
 * gown aisle between the two rows of each bay, a service chase between bays, and the overhead rail of
 * the wafer carriers running down every aisle. The world does not model the tools — the room is the
 * data — so this is scenery, laid out from the room's id and size alone: the same room always looks the
 * same, and a huge one still draws a bounded number of boxes.
 */
import { unit } from "./plan";

export interface ProcessTool {
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
  readonly h: number;
  /** 0..1: picks the tool's paint. */
  readonly tone: number;
}

/** The overhead hoist rail: a straight run along x. */
export interface Rail {
  readonly x0: number;
  readonly x1: number;
  readonly z: number;
}

export interface BayDecor {
  readonly tools: readonly ProcessTool[];
  readonly rails: readonly Rail[];
}

/** Clear floor left along the walls of the bay. */
export const EDGE_M = 4;
const TOOL_DEPTH_M = 3.4;
const AISLE_M = 3;
const CHASE_M = 3.2;
const GAP_M = 0.9;
/** A cross aisle every this far along a row. */
const CROSS_EVERY_M = 36;
const CROSS_AISLE_M = 4;
/** The most tools one room draws, however big it is. */
export const MAX_TOOLS = 1400;

const hash = (id: string): number => {
  let h = 17;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return h;
};

/** How many tool slots the room has, to thin them out when there are too many. */
function slotCount(w: number, d: number): { rows: number; perRow: number } {
  const bay = 2 * TOOL_DEPTH_M + AISLE_M;
  const rows = Math.max(0, Math.floor((d - 2 * EDGE_M + CHASE_M) / (bay + CHASE_M)));
  const perRow = Math.max(0, Math.floor((w - 2 * EDGE_M) / 4.2));
  return { rows, perRow };
}

/** Where the tools and rails of a cleanroom of this size stand, in the room's frame. */
export function bayDecor(id: string, w: number, d: number): BayDecor {
  const { rows, perRow } = slotCount(w, d);
  if (rows === 0 || perRow < 3) return { tools: [], rails: [] };
  const seed = hash(id);
  const keep = Math.min(0.9, MAX_TOOLS / (rows * 2 * perRow));
  const bay = 2 * TOOL_DEPTH_M + AISLE_M;
  const used = rows * bay + (rows - 1) * CHASE_M;
  const top = (d - used) / 2;
  const tools: ProcessTool[] = [];
  const rails: Rail[] = [];
  for (let r = 0; r < rows; r++) {
    const z0 = top + r * (bay + CHASE_M);
    rails.push({ x0: EDGE_M, x1: w - EDGE_M, z: z0 + TOOL_DEPTH_M + AISLE_M / 2 });
    for (const [side, z] of [
      [0, z0],
      [1, z0 + TOOL_DEPTH_M + AISLE_M],
    ] as const) {
      let x = EDGE_M;
      let next = CROSS_EVERY_M;
      for (let i = 0; x < w - EDGE_M; i++) {
        const at = r * 2 + side;
        const tw = 2.4 + unit(seed + at * 977, i) * 2;
        if (x + tw > w - EDGE_M) break;
        if (x >= next) {
          x += CROSS_AISLE_M;
          next += CROSS_EVERY_M;
          continue;
        }
        if (unit(seed + at * 31 + 5, i + 1000) < keep)
          tools.push({
            x: x + tw / 2,
            z: z + TOOL_DEPTH_M / 2,
            w: tw,
            d: TOOL_DEPTH_M,
            h: 2.2 + unit(seed + at, i + 50) * 1.1,
            tone: unit(seed + at * 7, i + 90),
          });
        x += tw + GAP_M;
      }
    }
  }
  return { tools, rails };
}
