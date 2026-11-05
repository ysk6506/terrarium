/**
 * The handles a selected room or building shows on its plan (REQ-075, ADR-0079, ADR-0080): a square in the
 * middle of every exposed side to drag the side (resize), and for a room a small plus just outside it to drag a new
 * piece out. Pure geometry in the level's plan frame; the view only draws them and reports where the pointer is.
 */
import type { Catalog } from "@terrarium/core/catalog";
import type { Rect } from "@terrarium/core/spatial";
import {
  type Blueprint,
  BlueprintIndex,
  type Entity,
  isSizeLocked,
  roomArea,
  roomRects,
} from "@terrarium/core/world";
import { count, won } from "../format";
import type { Edit } from "./edit";
import { snap } from "./edit";
import { moreRacksText } from "./floor-notes";
import type { Plan, Point, Where } from "./gesture";
import { GRID, TILE_M } from "./grid";
import type { Level } from "./levels";
import { addPiece, costDeltaM, pieceRect, resizeBody, resizePiece } from "./pieces";
import { Refusal, type Side } from "./reshape";
import { HEIGHTS } from "./scene";

export interface Handle {
  readonly key: string;
  readonly kind: "edge" | "attach";
  /** The room or building it belongs to. */
  readonly target: string;
  /** Which rectangle of the shape: 0 is the body, 1 the first piece. */
  readonly rect: number;
  readonly side: Side;
  /** Where it sits on the plan. */
  readonly at: Point;
  /** The exposed stretch of the side, metres from the side's left or top end, and how long it is. */
  readonly offset: number;
  readonly length: number;
}

const EPS = 1e-6;

/** Where the plan's corner is in the space's parent frame: handles are given in the plan, shapes in the parent. */
export function frameOffset(index: BlueprintIndex, level: Level, target: Entity): Point {
  const body = roomRects(target)[0];
  const local =
    (level.kind === "room" && level.id === target.id) ||
    (level.kind === "floor" &&
      target.kind === "building" &&
      index.enclosing(level.id, "building")?.id === target.id);
  return local && body ? { x: body.x, y: body.y } : { x: 0, y: 0 };
}

/** Whether a level can show handles for this entity: a room on its floor or inside itself, a building on the site or inside itself. */
export function handlesFit(
  index: BlueprintIndex,
  level: Level,
  target: Entity | undefined,
): boolean {
  if (!target || target.placement?.type !== "area") return false;
  if (target.kind === "room")
    return (
      (level.kind === "floor" && target.parentId === level.id) ||
      (level.kind === "room" && level.id === target.id)
    );
  // A building of real size is moved, never resized: it has no handles (REQ-076).
  if (target.kind === "building")
    return (
      !isSizeLocked(target) &&
      (level.kind === "site" ||
        (level.kind === "floor" && index.enclosing(level.id, "building")?.id === target.id))
    );
  return false;
}

/** How big a handle is drawn, metres: a hand's width for a room, more for a building. */
export function handleSize(target: Entity): number {
  const rects = roomRects(target);
  const w = Math.max(...rects.map((r) => Math.max(r.w, r.d)));
  return Math.min(3.5, Math.max(0.6, w / 22));
}

interface Line {
  /** Coordinate across the side, then the stretch along it. */
  readonly at: number;
  readonly from: number;
  readonly to: number;
}

function lineOf(r: Rect, side: Side): Line {
  switch (side) {
    case "left":
      return { at: r.x, from: r.y, to: r.y + r.d };
    case "right":
      return { at: r.x + r.w, from: r.y, to: r.y + r.d };
    case "top":
      return { at: r.y, from: r.x, to: r.x + r.w };
    case "bottom":
      return { at: r.y + r.d, from: r.x, to: r.x + r.w };
  }
}

const OPPOSITE: Readonly<Record<Side, Side>> = {
  left: "right",
  right: "left",
  top: "bottom",
  bottom: "top",
};

/** The longest stretch of a side no other rectangle covers, if there is one. */
function exposed(
  rects: readonly Rect[],
  i: number,
  side: Side,
): readonly [number, number] | undefined {
  const mine = lineOf(rects[i] as Rect, side);
  let free: Array<[number, number]> = [[mine.from, mine.to]];
  for (const [j, other] of rects.entries()) {
    if (j === i) continue;
    const theirs = lineOf(other, OPPOSITE[side]);
    if (Math.abs(theirs.at - mine.at) > EPS) continue;
    free = free.flatMap(([a, b]) => {
      const lo = Math.max(a, theirs.from);
      const hi = Math.min(b, theirs.to);
      if (hi - lo <= EPS) return [[a, b] as [number, number]];
      return [
        ...(lo - a > EPS ? [[a, lo] as [number, number]] : []),
        ...(b - hi > EPS ? [[hi, b] as [number, number]] : []),
      ];
    });
  }
  free.sort((p, q) => q[1] - q[0] - (p[1] - p[0]));
  const best = free[0];
  return best && best[1] - best[0] >= TILE_M - EPS ? best : undefined;
}

const point = (side: Side, at: number, along: number, off: Point): Point =>
  side === "left" || side === "right"
    ? { x: at - off.x, y: along - off.y }
    : { x: along - off.x, y: at - off.y };

/** All handles of a room or building at a level (empty when the level cannot show them). */
export function handlesFor(
  index: BlueprintIndex,
  level: Level,
  target: Entity | undefined,
): Handle[] {
  if (!target || !handlesFit(index, level, target)) return [];
  const rects = roomRects(target);
  const off = frameOffset(index, level, target);
  const reach = handleSize(target) * 1.7;
  const out: Handle[] = [];
  for (const [i, r] of rects.entries())
    for (const side of ["left", "right", "top", "bottom"] as const) {
      const stretch = exposed(rects, i, side);
      if (!stretch) continue;
      const line = lineOf(r, side);
      const mid = (stretch[0] + stretch[1]) / 2;
      const base = {
        target: target.id,
        rect: i,
        side,
        offset: mm(stretch[0] - line.from),
        length: mm(stretch[1] - stretch[0]),
      };
      out.push({ ...base, key: `${i}:${side}`, kind: "edge", at: point(side, line.at, mid, off) });
      if (target.kind !== "room") continue;
      const push = side === "left" || side === "top" ? -reach : reach;
      out.push({
        ...base,
        key: `${i}:${side}+`,
        kind: "attach",
        at: point(side, line.at + push, mid, off),
      });
    }
  return out;
}

/** The handle under a plan point, nearest first; edge handles win over plus handles when both are in reach. */
export function handleAt(handles: readonly Handle[], p: Point, reach: number): Handle | undefined {
  let best: Handle | undefined;
  let bestD = Number.POSITIVE_INFINITY;
  for (const h of handles) {
    const d = Math.hypot(h.at.x - p.x, h.at.y - p.y);
    if (d <= reach && d < bestD) {
      best = h;
      bestD = d;
    }
  }
  return best;
}

// ── dragging a handle ──────────────────────────────────────────────────────────────────────

const step = (target: Entity) => (target.kind === "building" ? GRID.site : TILE_M);
const mm = (v: number) => Math.round(v * 1000) / 1000;

/** The rectangle after dragging `side` of `r` by (dx, dy) on the plan, kept to the grid and at least one step wide. */
export function draggedRect(r: Rect, side: Side, dx: number, dy: number, unit: number): Rect {
  const sideways = side === "left" || side === "right";
  const edge = sideways ? (side === "left" ? r.x : r.x + r.w) : side === "top" ? r.y : r.y + r.d;
  const moved = snap(edge + (sideways ? dx : dy), unit);
  switch (side) {
    case "left": {
      const x = Math.min(moved, r.x + r.w - unit);
      return { ...r, x: mm(x), w: mm(r.x + r.w - x) };
    }
    case "right":
      return { ...r, w: mm(Math.max(unit, moved - r.x)) };
    case "top": {
      const y = Math.min(moved, r.y + r.d - unit);
      return { ...r, y: mm(y), d: mm(r.y + r.d - y) };
    }
    case "bottom":
      return { ...r, d: mm(Math.max(unit, moved - r.y)) };
  }
}

/** A refused edit as a plan's problem, with the way on that the refusal carries. */
const refused = (err: unknown): Pick<Plan, "problem" | "way"> => ({
  problem: (err as Error).message,
  ...(err instanceof Refusal ? { way: err.way } : {}),
});

const meters = (r: Rect) => `${mm(r.w)} × ${mm(r.d)} m`;

function costText(delta: number): string {
  if (Math.abs(delta) < 0.005) return "건설비 그대로";
  return `건설비 ${delta > 0 ? "+" : "−"}${won(Math.abs(delta))}`;
}

/** What the hint line says about a size while it is dragged: the size, the tiles (or square metres) and the cost. */
function sizeLabel(
  bp: Blueprint,
  after: Blueprint,
  catalog: Catalog,
  target: Entity,
  shown: Rect,
  piece = false,
): string {
  const next = new BlueprintIndex(after).entity(target.id);
  const delta = costDeltaM(bp, after, catalog, target.id);
  const amount =
    target.kind === "room"
      ? `방 전체 ${count(Math.round(roomArea(next)))} m²`
      : `${count(Math.round(shown.w * shown.d))} m²`;
  const racks =
    target.kind === "room" ? moreRacksText(roomArea(next) - roomArea(target)) : undefined;
  return [`${piece ? "" : `${meters(shown)} · `}${amount}`, costText(delta), racks]
    .filter((part) => part !== undefined)
    .join(" · ");
}

/** What happens if a handle is dragged from `from` to `to` on the plan: the ghost, the words, and the edit. */
export function handlePlan(where: Where, handle: Handle, from: Point, to: Point): Plan | undefined {
  const { bp, index, catalog, level } = where;
  const target = index.find(handle.target);
  if (!target) return undefined;
  const rects = roomRects(target);
  const base = rects[handle.rect] as Rect;
  const off = frameOffset(index, level, target);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const unit = step(target);
  const show = (r: Rect): Rect => ({ ...r, x: mm(r.x - off.x), y: mm(r.y - off.y) });
  if (handle.kind === "attach") return attachPlan(where, target, handle, base, { dx, dy }, show);
  const next = draggedRect(base, handle.side, dx, dy, unit);
  const height = target.kind === "building" ? 3 : HEIGHTS.roomSlab;
  const make = (r: Rect) =>
    handle.rect === 0
      ? resizeBody(bp, catalog, target.id, r)
      : resizePiece(bp, catalog, target.id, handle.rect - 1, r);
  try {
    const edit = make(next);
    const label = sizeLabel(bp, edit.blueprint, catalog, target, next);
    return { rect: show(next), height, label, edit };
  } catch (err) {
    const stopped =
      target.kind === "room"
        ? stopAtLimit(make, base, { dx, dy, unit, side: handle.side }, err)
        : undefined;
    if (stopped) {
      const label = `${sizeLabel(bp, stopped.edit.blueprint, catalog, target, stopped.rect)} · 여기가 끝이에요`;
      return {
        rect: show(stopped.rect),
        height,
        label,
        edit: stopped.edit,
        stopped: {
          message: (stopped.reason as Error).message,
          ...(stopped.reason instanceof Refusal ? { way: stopped.reason.way } : {}),
        },
      };
    }
    return { rect: show(next), height, label: "", ...refused(err) };
  }
}

/** A refusal that comes of there being no floor left: a full floor or another room in the way. */
const outOfRoom = (err: unknown) =>
  err instanceof Refusal ||
  (err as Error).message.includes("겹쳐요") ||
  (err as Error).message.startsWith("건물 벽에 닿았어요");

/**
 * Where a drag that asks for too much floor comes to rest (REQ-076): the largest size, in steps of the grid, the edit
 * still allows. The handle stops there instead of turning red, and the reason is that of the very next step, which is
 * what stopped it (a wall, a neighbour, or no bare floor left).
 */
function stopAtLimit(
  make: (r: Rect) => Edit,
  base: Rect,
  drag: { readonly dx: number; readonly dy: number; readonly unit: number; readonly side: Side },
  err: unknown,
): { readonly rect: Rect; readonly edit: Edit; readonly reason: unknown } | undefined {
  if (!outOfRoom(err)) return undefined;
  const steps = Math.ceil(Math.max(Math.abs(drag.dx), Math.abs(drag.dy)) / drag.unit);
  const at = (k: number): Rect =>
    draggedRect(base, drag.side, (drag.dx * k) / steps, (drag.dy * k) / steps, drag.unit);
  let lo = 0;
  let hi = steps - 1;
  let bestK = -1;
  let edit: Edit | undefined;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    try {
      edit = make(at(mid));
      bestK = mid;
      lo = mid + 1;
    } catch {
      hi = mid - 1;
    }
  }
  const rect = at(bestK);
  if (!edit || (rect.w === base.w && rect.d === base.d)) return undefined;
  let reason: unknown = err;
  try {
    make(at(bestK + 1));
  } catch (next) {
    reason = next;
  }
  return { rect, edit, reason };
}

function attachPlan(
  where: Where,
  target: Entity,
  handle: Handle,
  base: Rect,
  d: { readonly dx: number; readonly dy: number },
  show: (r: Rect) => Rect,
): Plan | undefined {
  const { bp, catalog } = where;
  const sideways = handle.side === "left" || handle.side === "right";
  const pull = sideways ? d.dx : d.dy;
  const out = handle.side === "right" || handle.side === "bottom" ? pull : -pull;
  if (out < TILE_M * 0.5)
    return { rect: show(base), height: 0, label: "바깥으로 끌면 조각이 붙어요" };
  const size = { along: handle.length, out };
  const rect = pieceRect(base, handle.side, size, handle.offset);
  try {
    const edit = addPiece(bp, catalog, target.id, handle.side, size, {
      to: handle.rect,
      offset: handle.offset,
    });
    const label = `조각 ${meters(rect)} · ${sizeLabel(bp, edit.blueprint, catalog, target, rect, true)}`;
    return { rect: show(rect), height: HEIGHTS.roomSlab, label, edit };
  } catch (err) {
    return {
      rect: show(rect),
      height: HEIGHTS.roomSlab,
      label: "",
      problem: (err as Error).message,
    };
  }
}

/** Which rectangle of a room a plan point lies on: undefined for the body, 0 for the first piece, and so on. */
export function pieceAt(
  index: BlueprintIndex,
  level: Level,
  room: Entity,
  at: Point,
): number | undefined {
  const off = frameOffset(index, level, room);
  const found = roomRects(room).findIndex(
    (r) =>
      at.x + off.x >= r.x &&
      at.x + off.x <= r.x + r.w &&
      at.y + off.y >= r.y &&
      at.y + off.y <= r.y + r.d,
  );
  return found > 0 ? found - 1 : undefined;
}
