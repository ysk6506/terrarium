/**
 * Whether a room still has room (REQ-075, ADR-0079): is there any place left on its floor where one more rack
 * would stand. When there is none the builder offers "서버룸 넓히기" instead of a bare refusal.
 */
import type { Catalog } from "@terrarium/core/catalog";
import { RACK_DEPTH_M, RACK_WIDTH_M } from "@terrarium/core/kernel";
import type { Rect } from "@terrarium/core/spatial";
import {
  type Blueprint,
  BlueprintIndex,
  footprint,
  isFloorStandingKind,
  roomBounds,
  roomLocalRects,
} from "@terrarium/core/world";
import { TILE_M } from "./grid";

const cache = new WeakMap<Blueprint, Map<string, boolean>>();

/** The word the builder uses for the way on when a room has no space left. */
export const WIDEN_ROOM = "서버룸 넓히기";

/** True when no free spot of a rack's size (either way round) is left on the room's floor. */
export function roomFull(bp: Blueprint, catalog: Catalog, roomId: string): boolean {
  const known = cache.get(bp)?.get(roomId);
  if (known !== undefined) return known;
  const full = scan(bp, catalog, roomId);
  const byRoom = cache.get(bp) ?? new Map<string, boolean>();
  byRoom.set(roomId, full);
  cache.set(bp, byRoom);
  return full;
}

function scan(bp: Blueprint, catalog: Catalog, roomId: string): boolean {
  const index = new BlueprintIndex(bp);
  const room = index.find(roomId);
  if (!room || room.placement?.type !== "area") return false;
  const rects = roomLocalRects(room);
  const bounds = roomBounds(rects) as Rect;
  const cols = Math.ceil(bounds.w / TILE_M - 1e-9);
  const rows = Math.ceil(bounds.d / TILE_M - 1e-9);
  const cell = (i: number, j: number) => ({
    x: bounds.x + (i + 0.5) * TILE_M,
    y: bounds.y + (j + 0.5) * TILE_M,
  });
  const free = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const c = cell(i, j);
      if (rects.some((r) => c.x > r.x && c.x < r.x + r.w && c.y > r.y && c.y < r.y + r.d))
        free[j * cols + i] = 1;
    }
  const standing = index
    .descendants(roomId)
    .filter((e) => e.kind === "rack" || isFloorStandingKind(e.kind));
  for (const e of standing) {
    const f = footprint(e, catalog);
    if (f) block(free, cols, rows, bounds, f);
  }
  const w = Math.round(RACK_WIDTH_M / TILE_M);
  const d = Math.round(RACK_DEPTH_M / TILE_M);
  return !(fits(free, cols, rows, w, d) || fits(free, cols, rows, d, w));
}

function block(free: Uint8Array, cols: number, rows: number, bounds: Rect, r: Rect): void {
  const i0 = Math.max(0, Math.floor((r.x - bounds.x) / TILE_M + 1e-9));
  const i1 = Math.min(cols, Math.ceil((r.x + r.w - bounds.x) / TILE_M - 1e-9));
  const j0 = Math.max(0, Math.floor((r.y - bounds.y) / TILE_M + 1e-9));
  const j1 = Math.min(rows, Math.ceil((r.y + r.d - bounds.y) / TILE_M - 1e-9));
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) free[j * cols + i] = 0;
}

function fits(free: Uint8Array, cols: number, rows: number, w: number, d: number): boolean {
  for (let j = 0; j + d <= rows; j++)
    for (let i = 0; i + w <= cols; i++) {
      let ok = true;
      for (let b = 0; b < d && ok; b++)
        for (let a = 0; a < w; a++)
          if (!free[(j + b) * cols + i + a]) {
            ok = false;
            break;
          }
      if (ok) return true;
    }
  return false;
}
