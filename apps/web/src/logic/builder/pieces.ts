/**
 * Making a room larger or oddly shaped (REQ-075, ADR-0079, ADR-0080): resize the body, attach a rectangular
 * piece to any side, resize or take off a piece. Pure like the other edits: blueprint in, blueprint out, or the
 * reason why not. What it costs is counted from the floor area at the real rates (REQ-059).
 */
import type { Catalog } from "@terrarium/core/catalog";
import { withJosa } from "@terrarium/core/kernel";
import type { Rect } from "@terrarium/core/spatial";
import {
  type Blueprint,
  BlueprintIndex,
  type Entity,
  roomArea,
  roomRects,
  structureCostM,
} from "@terrarium/core/world";
import { type Edit, EditError, snap, TILE_M } from "./edit";
import { reshape, type Side } from "./reshape";

const mm = (v: number) => Math.round(v * 1000) / 1000;

function roomOf(bp: Blueprint, roomId: string): Entity {
  const room = new BlueprintIndex(bp).entity(roomId);
  if (room.kind !== "room" || room.placement?.type !== "area")
    throw new EditError(`${withJosa(room.name, "은")} 조각을 붙일 수 있는 방이 아니에요`);
  return room;
}

const tiles = (metres: number) => Math.max(TILE_M, snap(metres, TILE_M));

/** How big a new piece is: its length along the side it joins, and how far it reaches out from it. */
export interface PieceSize {
  readonly along: number;
  readonly out: number;
}

export interface PieceOptions {
  /** The rectangle it joins: 0 is the body, 1 is the first piece. */
  readonly to?: number;
  /** Where along that side it starts, metres from the side's start (left or top end). */
  readonly offset?: number;
}

/** The rectangle a piece of this size takes when attached to `base` on a side. */
export function pieceRect(base: Rect, side: Side, size: PieceSize, offset = 0): Rect {
  const along = tiles(size.along);
  const out = tiles(size.out);
  const at = snap(offset, TILE_M);
  switch (side) {
    case "left":
      return { x: mm(base.x - out), y: mm(base.y + at), w: out, d: along };
    case "right":
      return { x: mm(base.x + base.w), y: mm(base.y + at), w: out, d: along };
    case "top":
      return { x: mm(base.x + at), y: mm(base.y - out), w: along, d: out };
    case "bottom":
      return { x: mm(base.x + at), y: mm(base.y + base.d), w: along, d: out };
  }
}

/** Attach a piece to a side of the body (or of another piece): the room grows that way, as one space. */
export function addPiece(
  bp: Blueprint,
  catalog: Catalog,
  roomId: string,
  side: Side,
  size: PieceSize,
  options: PieceOptions = {},
): Edit {
  const room = roomOf(bp, roomId);
  const rects = roomRects(room);
  const base = rects[options.to ?? 0];
  if (!base) throw new EditError("붙일 곳을 찾을 수 없어요");
  return reshape(
    bp,
    catalog,
    roomId,
    [...rects, pieceRect(base, side, size, options.offset)],
    false,
  );
}

/** Resize or move one piece (`piece` counts from 0 for the first piece, not the body). */
export function resizePiece(
  bp: Blueprint,
  catalog: Catalog,
  roomId: string,
  piece: number,
  rect: Rect,
): Edit {
  const rects = roomRects(roomOf(bp, roomId));
  if (piece < 0 || piece + 1 >= rects.length) throw new EditError("그 조각을 찾을 수 없어요");
  return reshape(
    bp,
    catalog,
    roomId,
    rects.map((r, i) => (i === piece + 1 ? rect : r)),
    false,
  );
}

/** Take a piece off. Refused, naming the rack or equipment, when something stands on it. */
export function removePiece(bp: Blueprint, catalog: Catalog, roomId: string, piece: number): Edit {
  const rects = roomRects(roomOf(bp, roomId));
  if (piece < 0 || piece + 1 >= rects.length) throw new EditError("그 조각을 찾을 수 없어요");
  return reshape(
    bp,
    catalog,
    roomId,
    rects.filter((_, i) => i !== piece + 1),
    false,
  );
}

/** Resize the body (a room, building or containment) keeping everything inside where it stands in the world. */
export function resizeBody(bp: Blueprint, catalog: Catalog, id: string, rect: Rect): Edit {
  const entity = new BlueprintIndex(bp).entity(id);
  if (entity.placement?.type !== "area" || entity.kind === "parcel")
    throw new EditError(`${withJosa(entity.name, "은")} 크기를 바꿀 수 없어요`);
  return reshape(bp, catalog, id, [rect, ...roomRects(entity).slice(1)], true);
}

/** What the structure of a space and everything in it cost, million won (the walls, floors and fit-out). */
export function structureOfM(bp: Blueprint, catalog: Catalog, id: string): number {
  const index = new BlueprintIndex(bp);
  const entity = index.find(id);
  if (!entity) return 0;
  return [entity, ...index.descendants(id)].reduce(
    (sum, e) => sum + structureCostM(index, catalog, e),
    0,
  );
}

/** How much more (or less) the structure costs after an edit, million won. */
export function costDeltaM(
  before: Blueprint,
  after: Blueprint,
  catalog: Catalog,
  id: string,
): number {
  return structureOfM(after, catalog, id) - structureOfM(before, catalog, id);
}

/** Raised-floor tiles under a room: its area over one tile, whole tiles. */
export function tileCount(room: Entity): number {
  return Math.round(roomArea(room) / (TILE_M * TILE_M));
}
