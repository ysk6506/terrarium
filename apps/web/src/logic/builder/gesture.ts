/**
 * What a pointer gesture in the 3D view would do with the tool in hand: where the thing would go (the
 * ghost), whether it can, what the hint line says, and the edit to apply when the gesture ends. Pure,
 * so the builder's whole "point, drag, let go" behaviour is tested without a browser.
 */
import type { Catalog } from "@terrarium/core/catalog";
import { RACK_WIDTH_M, withJosa } from "@terrarium/core/kernel";
import type { Rect, Rotation } from "@terrarium/core/spatial";
import { type Blueprint, type BlueprintIndex, footprint, KIND_LABELS } from "@terrarium/core/world";
import { moveTo } from "./change";
import {
  addBuilding,
  addContainment,
  addRoom,
  type Edit,
  footprintAt,
  GRID,
  placeEquipment,
  placeRackRow,
  type Spot,
  snap,
  snapRect,
  snapSpot,
  TILE_M,
} from "./edit";
import type { Level } from "./levels";
import { HEIGHTS } from "./scene";

export type Tool =
  | { readonly kind: "select" }
  | { readonly kind: "building" }
  | { readonly kind: "room" }
  | { readonly kind: "containment"; readonly aisle: "cold" | "hot" }
  | { readonly kind: "rack" }
  | { readonly kind: "equipment"; readonly modelId: string };

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Plan {
  /** Where it would stand, in the level's frame. */
  readonly rect: Rect;
  readonly height: number;
  /** What the hint line says while pointing. */
  readonly label: string;
  /** Why it cannot go there; undefined when it can. */
  readonly problem?: string;
  readonly edit?: Edit;
}

export const gridOf = (level: Level) => GRID[level.kind];

/** The rectangle two pointer positions span, whichever way the drag went. */
export const rectBetween = (a: Point, b: Point): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(b.x - a.x),
  d: Math.abs(b.y - a.y),
});

const size = (r: Rect) => `${r.w} × ${r.d} m`;

/** What the pointer's hint says when a placement is refused: the edit's reason, in the pointer's words. */
const hintOf = (message: string) =>
  message === "이 자리가 들어갈 자리를 벗어난다" ? "여기는 놓을 수 있는 공간 밖이다" : message;

function attempt(rect: Rect, height: number, label: string, make: () => Edit): Plan {
  try {
    return { rect, height, label, edit: make() };
  } catch (err) {
    return { rect, height, label, problem: hintOf((err as Error).message) };
  }
}

/** Which tools a level offers (the rest are hidden there). */
export function toolFits(tool: Tool, level: Level): boolean {
  switch (tool.kind) {
    case "select":
      return true;
    case "building":
      return level.kind === "site";
    case "room":
      return level.kind === "floor";
    case "containment":
    case "rack":
      return level.kind === "room";
    case "equipment":
      return level.kind !== "site";
  }
}

const AREA_MIN = { building: 10, room: 3, containment: TILE_M * 2 } as const;

function areaPlan(
  bp: Blueprint,
  catalog: Catalog,
  level: Level,
  tool: Tool,
  from: Point,
  to: Point,
): Plan | undefined {
  if (tool.kind !== "building" && tool.kind !== "room" && tool.kind !== "containment")
    return undefined;
  const rect = snapRect(rectBetween(from, to), gridOf(level), AREA_MIN[tool.kind]);
  if (tool.kind === "building")
    return attempt(rect, 3, `건물 ${size(rect)}`, () => addBuilding(bp, catalog, rect));
  if (level.kind === "site") return undefined;
  if (tool.kind === "room")
    return attempt(rect, HEIGHTS.roomSlab, `서버룸 ${size(rect)}`, () =>
      addRoom(bp, catalog, level.id, rect),
    );
  const what = tool.aisle === "cold" ? "냉복도" : "열복도";
  return attempt(rect, HEIGHTS.containment, `${what} ${size(rect)}`, () =>
    addContainment(bp, catalog, level.id, rect, tool.aisle),
  );
}

/** A spot whose footprint is centred on the pointer, corner on a tile. */
function centred(
  catalog: Catalog,
  modelId: string | undefined,
  at: Point,
  rotation: Rotation,
  step: number,
): Spot {
  const r = footprintAt(catalog, modelId, { x: 0, y: 0, rotation });
  return snapSpot(at.x - r.w / 2, at.y - r.d / 2, rotation, step);
}

/** A rack where the pointer is, or a row of them from where the drag began to where it is. */
function rackPlan(
  bp: Blueprint,
  catalog: Catalog,
  level: Level,
  rotation: Rotation,
  from: Point,
  to?: Point,
): Plan | undefined {
  if (level.kind !== "room") return undefined;
  const start = centred(catalog, undefined, from, rotation, TILE_M);
  const alongX = rotation === 0 || rotation === 180;
  const delta = to ? (alongX ? to.x - from.x : to.y - from.y) : 0;
  const count = Math.min(60, Math.floor(Math.abs(delta) / RACK_WIDTH_M + 0.5) + 1);
  const back = delta < 0 ? (count - 1) * RACK_WIDTH_M : 0;
  const spot: Spot = alongX
    ? { ...start, x: snap(start.x - back, 0.001) }
    : { ...start, y: snap(start.y - back, 0.001) };
  const one = footprintAt(catalog, undefined, spot);
  const rect = alongX
    ? { ...one, w: snap(one.w * count, 0.001) }
    : { ...one, d: snap(one.d * count, 0.001) };
  const label = count === 1 ? "랙 하나" : `랙 ${count}개를 한 줄로`;
  return attempt(rect, HEIGHTS.rack, label, () => placeRackRow(bp, catalog, level.id, spot, count));
}

function equipmentPlan(
  bp: Blueprint,
  catalog: Catalog,
  level: Level,
  modelId: string,
  rotation: Rotation,
  at: Point,
): Plan | undefined {
  if (level.kind === "site") return undefined;
  const spot = centred(catalog, modelId, at, rotation, TILE_M);
  const rect = footprintAt(catalog, modelId, spot);
  return attempt(rect, HEIGHTS.equipment, catalog.get(modelId).name, () =>
    placeEquipment(bp, catalog, level, modelId, spot),
  );
}

/** Where a gesture happens: the world as it is and the level being looked at. */
export interface Where {
  readonly bp: Blueprint;
  readonly index: BlueprintIndex;
  readonly catalog: Catalog;
  readonly level: Level;
}

/**
 * What the tool would do: pointing (`to` undefined) or dragging from `from` to `to`.
 * Undefined when the gesture means nothing for this tool (pointing with an area tool, say).
 */
export function planFor(
  where: Where,
  tool: Tool,
  rotation: Rotation,
  from: Point,
  to?: Point,
): Plan | undefined {
  const { bp, catalog, level } = where;
  if (!toolFits(tool, level)) return undefined;
  if (tool.kind === "rack") return rackPlan(bp, catalog, level, rotation, from, to);
  if (tool.kind === "equipment")
    return equipmentPlan(bp, catalog, level, tool.modelId, rotation, to ?? from);
  return to ? areaPlan(bp, catalog, level, tool, from, to) : undefined;
}

const LIFTED: Partial<Record<string, number>> = {
  rack: HEIGHTS.rack,
  containment: HEIGHTS.containment,
  building: 3,
  room: HEIGHTS.roomSlab,
};

/** Dragging something already built: where it would land, and the move. */
export function movePlan(where: Where, id: string, from: Point, to: Point): Plan | undefined {
  const { bp, index, catalog, level } = where;
  const entity = index.find(id);
  const rect = entity ? footprint(entity, catalog) : undefined;
  if (!entity || !rect || entity.placement?.type === "unit") return undefined;
  const step = entity.kind === "building" ? GRID.site : TILE_M;
  const x = snap(rect.x + (to.x - from.x), step);
  const y = snap(rect.y + (to.y - from.y), step);
  const height = LIFTED[entity.kind] ?? HEIGHTS.equipment;
  return attempt({ ...rect, x, y }, height, `${withJosa(entity.name, "을")} 옮긴다`, () =>
    moveTo(bp, catalog, level, id, x, y),
  );
}

/** The hint line while just pointing, before any gesture. */
export function pointingHint(tool: Tool, hit: string | undefined, index: BlueprintIndex): string {
  switch (tool.kind) {
    case "select": {
      const thing = hit ? index.find(hit) : undefined;
      if (!thing) return "끌면 화면이 움직인다. 놓을 것을 왼쪽에서 고른다";
      const enter = thing.kind === "building" || thing.kind === "room";
      return `${thing.name} (${KIND_LABELS[thing.kind]}): 누르면 고르고, 끌면 옮긴다${enter ? ", 두 번 누르면 들어간다" : ""}`;
    }
    case "building":
      return "땅 위를 끌어서 건물 자리를 잡는다";
    case "room":
      return "건물 안을 끌어서 서버룸을 만든다";
    case "containment":
      return "랙 줄 사이의 복도를 끌어서 감싼다";
    case "rack":
      return "누르면 랙 하나, 끌면 한 줄. R로 돌린다";
    case "equipment":
      return "누른 곳에 놓는다. R로 돌린다";
  }
}

/** Turn the tool's rotation by 90°, as R does. */
export const nextRotation = (r: Rotation): Rotation => ((r + 90) % 360) as Rotation;
