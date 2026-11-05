/**
 * Changing the shape of a space (REQ-075, ADR-0079, ADR-0080): a room, a building or a containment is moved or
 * resized, and a room also grows pieces. Every such change goes through `reshape`, which says yes only when what
 * is inside still stands inside, nothing overlaps and the room is still one joined space.
 */
import type { Catalog } from "@terrarium/core/catalog";
import { withJosa } from "@terrarium/core/kernel";
import type { Rect } from "@terrarium/core/spatial";
import {
  type Blueprint,
  BlueprintIndex,
  coveredBy,
  type Entity,
  footprint,
  insideRoomLocal,
  isSizeLocked,
  type Placement,
  roomRects,
  shapeProblem,
} from "@terrarium/core/world";
import {
  assertFree,
  type Edit,
  EditError,
  GRID,
  groundTakers,
  replaceEntity,
  snapRect,
  TILE_M,
} from "./edit";
import { landReason } from "./edit-site";
import { assertFloorRoom, floorFullRefusal } from "./floor-notes";
import { type Level, levelArea } from "./levels";
import { Refusal } from "./refusal";

export type Side = "left" | "right" | "top" | "bottom";
export const SIDES: readonly Side[] = ["left", "right", "top", "bottom"];
export const SIDE_LABELS: Readonly<Record<Side, string>> = {
  left: "왼쪽",
  right: "오른쪽",
  top: "위쪽",
  bottom: "아래쪽",
};

export { Refusal };

/** A space's rectangles as `reshape` takes them: the body first, then the pieces. */
export type Shape = readonly Rect[];

const mm = (v: number) => Math.round(v * 1000) / 1000;
const round = (r: Rect): Rect => ({ x: mm(r.x), y: mm(r.y), w: mm(r.w), d: mm(r.d) });

export function placementOfShape(shape: Shape): Placement {
  const [body, ...pieces] = shape as [Rect, ...Rect[]];
  return { type: "area", ...body, ...(pieces.length > 0 ? { pieces } : {}) };
}

/** The ground an area stands in and what else stands there: the site and its buildings and plant, a floor or a room. */
function surroundings(
  index: BlueprintIndex,
  catalog: Catalog,
  entity: Entity,
  fallback: Rect,
): { readonly area: Rect; readonly siblings: readonly Entity[] } {
  const parent = entity.parentId ? index.find(entity.parentId) : undefined;
  if (entity.kind === "building")
    return {
      area: levelArea(index, catalog, { kind: "site" }),
      siblings: parent ? groundTakers(index, parent.id, entity.id) : [],
    };
  if (!parent) return { area: fallback, siblings: [] };
  const level: Level =
    parent.kind === "floor" ? { kind: "floor", id: parent.id } : { kind: "room", id: parent.id };
  return {
    area: levelArea(index, catalog, level),
    siblings: index.childrenOf(parent.id, entity.kind).filter((e) => e.id !== entity.id),
  };
}

/** What lies in the space's own frame: its rooms and equipment, or a building's, which stand on its floors. */
function contentsOf(index: BlueprintIndex, entity: Entity): Entity[] {
  const holders = entity.kind === "building" ? index.childrenOf(entity.id, "floor") : [entity];
  return holders.flatMap((h) => index.childrenOf(h.id));
}

/** The first thing that would stick out of the space as it now is, or undefined. */
function spilledOut(index: BlueprintIndex, catalog: Catalog, entity: Entity): Entity | undefined {
  const body = footprint(entity, catalog) as Rect;
  const inner: Rect = { x: 0, y: 0, w: body.w, d: body.d };
  return contentsOf(index, entity).find((c) => {
    const cr = footprint(c, catalog);
    if (cr === undefined) return false;
    return entity.kind === "room" ? !insideRoomLocal(entity, cr) : !coveredBy([inner], cr);
  });
}

/** Move what is drawn in the space's frame so it stays where it stands when the frame's corner moves. */
function shifted(
  bp: Blueprint,
  index: BlueprintIndex,
  entity: Entity,
  dx: number,
  dy: number,
): Blueprint {
  if (dx === 0 && dy === 0) return bp;
  const inFrame = new Set<string>();
  for (const c of contentsOf(index, entity)) {
    inFrame.add(c.id);
    if (c.kind === "containment") for (const r of index.childrenOf(c.id)) inFrame.add(r.id);
  }
  return {
    ...bp,
    entities: bp.entities.map((e) => {
      const p = e.placement;
      if (!inFrame.has(e.id) || (p?.type !== "area" && p?.type !== "spot")) return e;
      const pieces =
        p.type === "area" && p.pieces
          ? { pieces: p.pieces.map((r) => ({ ...r, x: mm(r.x + dx), y: mm(r.y + dy) })) }
          : {};
      return { ...e, placement: { ...p, x: mm(p.x + dx), y: mm(p.y + dy), ...pieces } };
    }),
  };
}

function shapeMessage(name: string, kind: "empty" | "overlap" | "detached" | "hole"): string {
  switch (kind) {
    case "empty":
      return `${name}의 조각이 너무 작아요`;
    case "overlap":
      return `${name}의 조각이 서로 겹쳐요`;
    case "detached":
      return `${name}의 조각이 방에서 떨어져요. 변이 맞닿게 붙여야 해요`;
    case "hole":
      return `${name}의 조각이 빈 자리를 둘러싸요`;
  }
}

/** The rectangles of the space, each kept to the grid. */
function snapShape(entity: Entity, shape: Shape): Rect[] {
  const step = entity.kind === "building" ? GRID.site : TILE_M;
  return shape.map((r) => round(snapRect(r, step, step)));
}

/** Throw the reason a shape cannot stand where it is asked to. */
function assertStands(index: BlueprintIndex, catalog: Catalog, entity: Entity, rects: Shape): void {
  if (entity.kind === "room") {
    const problem = shapeProblem(rects);
    if (problem) throw new EditError(shapeMessage(entity.name, problem.kind));
  }
  const body = rects[0] as Rect;
  const { area, siblings } = surroundings(index, catalog, entity, body);
  for (const r of rects) {
    try {
      assertFree(index, catalog, area, r, siblings, entity.name);
    } catch (err) {
      throw asWallRefusal(index, catalog, entity, err);
    }
  }
  if (entity.kind === "building") assertOwnLand(index, catalog, entity, body);
}

/** A room that went past its building's walls is told about the floor (REQ-076); any other refusal stays as it was. */
function asWallRefusal(
  index: BlueprintIndex,
  catalog: Catalog,
  entity: Entity,
  err: unknown,
): unknown {
  const floor = entity.kind === "room" ? entity.parentId : undefined;
  const building = floor ? index.enclosing(floor, "building") : undefined;
  return floor && building && (err as Error).message.endsWith("벗어나요")
    ? floorFullRefusal(index, catalog, floor, true)
    : err;
}

/** A building stands on land that is the owner's: land for sale gets the way to buy it. */
function assertOwnLand(
  index: BlueprintIndex,
  catalog: Catalog,
  building: Entity,
  body: Rect,
): void {
  const reason = landReason(index, catalog, body);
  if (!reason) return;
  if (reason.includes("아직 사지 않은"))
    throw new Refusal(reason, { kind: "buy-land", entityId: building.id });
  throw new EditError(reason);
}

/**
 * Give a building, room or containment a new shape. `keepWorld` keeps what stands inside where it stands in the
 * world when the body's corner moves (resizing from the left or top edge); without it the contents travel with
 * the corner (moving the whole space).
 */
export function reshape(
  bp: Blueprint,
  catalog: Catalog,
  id: string,
  shape: Shape,
  keepWorld: boolean,
): Edit {
  const index = new BlueprintIndex(bp);
  const entity = index.entity(id);
  const old = footprint(entity, catalog) as Rect;
  const rects = snapShape(entity, shape);
  const body = rects[0] as Rect;
  // A building of real size can be moved, never made bigger or smaller (REQ-076).
  if (isSizeLocked(entity) && (body.w !== old.w || body.d !== old.d))
    throw new EditError(
      `${withJosa(entity.name, "은")} 실제 크기라 바꿀 수 없어요. 방은 층의 빈 바닥 안에서 넓혀요`,
    );
  assertStands(index, catalog, entity, rects);
  const moved = keepWorld ? shifted(bp, index, entity, old.x - body.x, old.y - body.y) : bp;
  const next = replaceEntity(moved, id, (e) => ({ ...e, placement: placementOfShape(rects) }));
  if (entity.kind === "room") assertFloorRoom(bp, next, catalog, entity.parentId);
  const nextIndex = new BlueprintIndex(next);
  if (entity.kind !== "containment") {
    const outside = spilledOut(nextIndex, catalog, nextIndex.entity(id));
    if (outside)
      throw new EditError(`${withJosa(outside.name, "이")} 밖으로 나가게 돼요. 먼저 옮겨 주세요`);
  }
  return { blueprint: next, select: [id] };
}

/** The shape an area-placed thing has now: body first, then its pieces. */
export const shapeOf = (entity: Entity): Rect[] => roomRects(entity);
