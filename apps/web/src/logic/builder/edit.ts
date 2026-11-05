/**
 * Building the world by hand (REQ-006): every change the builder makes is one of these pure
 * functions — blueprint in, new blueprint out, or a Korean reason why not. The 3D view and the panels
 * only call them, so everything the builder can do is tested here.
 */
import type { Catalog } from "@terrarium/core/catalog";
import { RACK_DEPTH_M, RACK_UNITS_DEFAULT, RACK_WIDTH_M, withJosa } from "@terrarium/core/kernel";
import {
  contains,
  overlaps,
  type Rect,
  type Rotation,
  rotated,
  snap as snapRaw,
} from "@terrarium/core/spatial";
import {
  BLUEPRINT_SCHEMA_VERSION,
  type Blueprint,
  BlueprintIndex,
  coveredBy,
  DEFAULT_FLOOR_HEIGHT_M,
  type Entity,
  type EntityKind,
  footprint,
  isFloorStandingKind,
  KIND_LABELS,
  type Link,
  type RoomPurpose,
  roomRects,
} from "@terrarium/core/world";
import { GRID, TILE_M } from "./grid";
import { floorsOf, type Level, levelArea, levelEntities, levelParent, levelShape } from "./levels";
import { roomFull, WIDEN_ROOM } from "./room-space";

export class EditError extends Error {}

export interface Edit {
  readonly blueprint: Blueprint;
  /** What to select afterwards (what was made or moved). */
  readonly select: readonly string[];
}

/** Snap to a grid step, kept to whole millimetres (0.6 × 6 is 3.6, not 3.5999999999999996). */
const mm = (v: number) => Math.round(v * 1000) / 1000;
export const snap = (value: number, step: number) => Math.round(snapRaw(value, step) * 1000) / 1000;

export { GRID, TILE_M };

const ID_PREFIX: Readonly<Partial<Record<EntityKind, string>>> = {
  building: "bld",
  floor: "fl",
  room: "room",
  containment: "cont",
  rack: "rack",
  server: "srv",
  switch: "sw",
  storage: "stor",
  pdu: "pdu",
  cooling_unit: "cu",
  power_panel: "panel",
  ups: "ups",
  vcenter: "vc",
  cluster: "cl",
  vm: "vm",
  datastore: "ds",
};

/** The next free id with the kind's prefix: rack-7 after rack-6. */
export function nextId(index: BlueprintIndex, kind: EntityKind | "link"): string {
  const prefix = kind === "link" ? "l" : (ID_PREFIX[kind] ?? kind);
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  let top = 0;
  for (const item of [...index.all(), ...index.allLinks()]) {
    const m = pattern.exec(item.id);
    if (m) top = Math.max(top, Number(m[1]));
  }
  return `${prefix}-${top + 1}`;
}

const NAME_BASE: Readonly<Partial<Record<EntityKind, string>>> = {
  building: "건물",
  rack: "랙",
  server: "서버",
  switch: "스위치",
  storage: "스토리지",
  pdu: "PDU",
  power_panel: "분전반",
  ups: "UPS",
};

/** "랙 7": the kind's word and the next number among its siblings of the same kind. */
export function nextName(
  index: BlueprintIndex,
  kind: EntityKind,
  parentId: string | undefined,
  base?: string,
): string {
  const word = base ?? NAME_BASE[kind] ?? KIND_LABELS[kind];
  const siblings = parentId ? index.childrenOf(parentId, kind) : index.ofKind(kind);
  const numbers = siblings.map((e) => Number(/(\d+)$/.exec(e.name)?.[1] ?? 0));
  return `${word} ${Math.max(0, ...numbers) + 1}`;
}

const ROOM_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

export function withEntities(
  bp: Blueprint,
  add: readonly Entity[],
  links: readonly Link[] = [],
): Blueprint {
  return { ...bp, entities: [...bp.entities, ...add], links: [...bp.links, ...links] };
}

export function replaceEntity(bp: Blueprint, id: string, change: (e: Entity) => Entity): Blueprint {
  return { ...bp, entities: bp.entities.map((e) => (e.id === id ? change(e) : e)) };
}

// ── a new world ────────────────────────────────────────────────────────────────────────────

/** An empty site of the given land size: the first thing the builder shows. */
export function emptyWorld(
  id: string,
  name: string,
  land: { w: number; d: number },
  siteName = name,
): Blueprint {
  return {
    schemaVersion: BLUEPRINT_SCHEMA_VERSION,
    id,
    name,
    entities: [
      {
        id: "site-1",
        kind: "site",
        name: siteName,
        placement: { type: "land", ...land },
        props: {},
      },
    ],
    links: [],
    meta: { source: "builder" },
  };
}

// ── spaces ─────────────────────────────────────────────────────────────────────────────────

/** Snap a dragged rectangle to the level's grid, with a minimum size. */
export function snapRect(rect: Rect, step: number, min = step): Rect {
  const x = snap(Math.min(rect.x, rect.x + rect.w), step);
  const y = snap(Math.min(rect.y, rect.y + rect.d), step);
  const w = Math.max(min, snap(Math.abs(rect.w), step));
  const d = Math.max(min, snap(Math.abs(rect.d), step));
  return { x, y, w, d };
}

/** The floor a thing takes: its footprint, or every piece of a room made of pieces. */
export function floorRects(entity: Entity, catalog: Catalog): Rect[] {
  if (entity.kind === "room") return roomRects(entity);
  const r = footprint(entity, catalog);
  return r ? [r] : [];
}

/** `area` is the floor that is there to stand on: one rectangle, or the pieces of a room joined edge to edge. */
export function assertFree(
  _index: BlueprintIndex,
  catalog: Catalog,
  area: Rect | readonly Rect[],
  rect: Rect,
  others: readonly Entity[],
  what: string,
): void {
  if (!coveredBy(Array.isArray(area) ? area : [area as Rect], rect))
    throw new EditError(`${withJosa(what, "이")} 들어갈 자리를 벗어나요`);
  const hit = others.find((o) => floorRects(o, catalog).some((r) => overlaps(r, rect)));
  if (hit) throw new EditError(`${withJosa(hit.name, "과")} 겹쳐요`);
}

/** A floor on top of the building's highest one. */
export function addFloor(bp: Blueprint, buildingId: string): Edit {
  const index = new BlueprintIndex(bp);
  const floors = floorsOf(index, buildingId);
  const top = floors.at(-1)?.placement;
  const level = top?.type === "level" ? top.level + 1 : 1;
  const id = nextId(index, "floor");
  const floor: Entity = {
    id,
    kind: "floor",
    name: `${level}층`,
    parentId: buildingId,
    placement: { type: "level", level, height: DEFAULT_FLOOR_HEIGHT_M },
    props: {},
  };
  return { blueprint: withEntities(bp, [floor]), select: [id] };
}

/** The word a room is called by, per purpose: "통신실 A". A data hall stays "서버룸". */
export const ROOM_WORDS: Readonly<Record<RoomPurpose, string>> = {
  data_hall: "서버룸",
  network: "통신실",
  electrical: "전기실",
  mechanical: "기계실",
  battery: "배터리실",
  noc: "관제실",
  cleanroom: "클린룸",
};

export function addRoom(
  bp: Blueprint,
  catalog: Catalog,
  floorId: string,
  rect: Rect,
  purpose: RoomPurpose = "data_hall",
): Edit {
  const index = new BlueprintIndex(bp);
  const word = ROOM_WORDS[purpose];
  const r = snapRect(rect, GRID.floor, 3);
  const level: Level = { kind: "floor", id: floorId };
  assertFree(
    index,
    catalog,
    levelArea(index, catalog, level),
    r,
    index.childrenOf(floorId, "room"),
    word,
  );
  const used = new Set(index.ofKind("room").map((x) => x.name));
  const letter = [...ROOM_LETTERS].find((l) => !used.has(`${word} ${l}`)) ?? String(used.size + 1);
  const id = nextId(index, "room");
  const room: Entity = {
    id,
    kind: "room",
    name: `${word} ${letter}`,
    parentId: floorId,
    placement: { type: "area", ...r },
    props: purpose === "data_hall" ? {} : { purpose },
  };
  return { blueprint: withEntities(bp, [room]), select: [id] };
}

/** A cold or hot aisle around the racks under it; those racks move into it. */
export function addContainment(
  bp: Blueprint,
  catalog: Catalog,
  roomId: string,
  rect: Rect,
  aisle: "cold" | "hot",
): Edit {
  const index = new BlueprintIndex(bp);
  const r = snapRect(rect, GRID.room, TILE_M * 2);
  const level: Level = { kind: "room", id: roomId };
  assertFree(
    index,
    catalog,
    levelShape(index, catalog, level),
    r,
    index.childrenOf(roomId, "containment"),
    "컨테인먼트",
  );
  const id = nextId(index, "containment");
  const label = aisle === "cold" ? "냉복도" : "열복도";
  const containment: Entity = {
    id,
    kind: "containment",
    name: nextName(index, "containment", roomId, label),
    parentId: roomId,
    placement: { type: "area", ...r },
    props: { aisle },
  };
  const inside = new Set(
    index
      .childrenOf(roomId, "rack")
      .filter((rack) => {
        const fr = footprint(rack, catalog);
        return fr !== undefined && contains(r, fr);
      })
      .map((rack) => rack.id),
  );
  const moved = {
    ...bp,
    entities: bp.entities.map((e) => (inside.has(e.id) ? { ...e, parentId: id } : e)),
  };
  return { blueprint: withEntities(moved, [containment]), select: [id] };
}

// ── things standing on the floor ───────────────────────────────────────────────────────────

/** Plant that stands on the ground beside the buildings. */
export const PLANT_KINDS = new Set(["chiller", "generator", "power_panel"]);

/** What takes ground at the site level: the buildings and the plant beside them (none of it may overlap). */
export function groundTakers(index: BlueprintIndex, siteId: string, except?: string): Entity[] {
  return [
    ...index.childrenOf(siteId, "building"),
    ...index.childrenOf(siteId).filter((e) => PLANT_KINDS.has(e.kind)),
  ].filter((e) => e.id !== except);
}

/** Things that take floor space at a level (they must not overlap). */
function floorItems(index: BlueprintIndex, level: Level): Entity[] {
  if (level.kind === "site") {
    const site = index.ofKind("site")[0];
    return site ? groundTakers(index, site.id) : [];
  }
  return levelEntities(index, level).filter(
    (e) => e.kind === "rack" || isFloorStandingKind(e.kind),
  );
}

export interface Spot {
  readonly x: number;
  readonly y: number;
  readonly rotation: Rotation;
}

/** The footprint a new thing would take at a spot (size from its model; racks are standard). */
export function footprintAt(catalog: Catalog, modelId: string | undefined, spot: Spot): Rect {
  let size = { w: RACK_WIDTH_M, d: RACK_DEPTH_M };
  if (modelId) {
    const model = catalog.get(modelId);
    if ("footprint" in model) size = model.footprint;
  }
  const r = rotated(size.w, size.d, spot.rotation);
  return { x: spot.x, y: spot.y, w: r.w, d: r.d };
}

/** Snap a pointer position so the thing's corner sits on a tile. */
export const snapSpot = (
  x: number,
  y: number,
  rotation: Rotation,
  step: number = TILE_M,
): Spot => ({
  x: snap(x, step),
  y: snap(y, step),
  rotation,
});

/** Why something cannot stand here, or undefined when it can. */
export function placementProblem(
  bp: Blueprint,
  catalog: Catalog,
  level: Level,
  modelId: string | undefined,
  spot: Spot,
  ignore: readonly string[] = [],
): string | undefined {
  const index = new BlueprintIndex(bp);
  try {
    const others = floorItems(index, level).filter((e) => !ignore.includes(e.id));
    assertFree(
      index,
      catalog,
      levelShape(index, catalog, level),
      footprintAt(catalog, modelId, spot),
      others,
      "이 자리",
    );
    return undefined;
  } catch (err) {
    return (err as Error).message;
  }
}

/** The room or containment a rack at this spot belongs in. */
function rackParent(index: BlueprintIndex, catalog: Catalog, roomId: string, rect: Rect): string {
  const containment = index.childrenOf(roomId, "containment").find((c) => {
    const r = footprint(c, catalog);
    return r !== undefined && contains(r, rect);
  });
  return containment?.id ?? roomId;
}

export function placeRack(bp: Blueprint, catalog: Catalog, roomId: string, spot: Spot): Edit {
  return placeRackRow(bp, catalog, roomId, spot, 1);
}

/** `count` racks side by side, starting at the spot, along the rack's width. */
export function placeRackRow(
  bp: Blueprint,
  catalog: Catalog,
  roomId: string,
  spot: Spot,
  count: number,
): Edit {
  if (count < 1 || count > 60) throw new EditError("한 줄에 랙은 1~60개예요");
  let blueprint = bp;
  const made: string[] = [];
  const alongX = spot.rotation === 0 || spot.rotation === 180;
  for (let i = 0; i < count; i++) {
    const at: Spot = alongX
      ? { ...spot, x: mm(spot.x + i * RACK_WIDTH_M) }
      : { ...spot, y: mm(spot.y + i * RACK_WIDTH_M) };
    const problem = placementProblem(
      blueprint,
      catalog,
      { kind: "room", id: roomId },
      undefined,
      at,
    );
    if (problem) {
      const lead = count > 1 ? `${i + 1}번째 랙: ${problem}` : problem;
      throw new EditError(
        roomFull(blueprint, catalog, roomId)
          ? `${lead}. 서버룸이 꽉 찼어요. "${WIDEN_ROOM}"로 넓혀요`
          : lead,
      );
    }
    const index = new BlueprintIndex(blueprint);
    const rect = footprintAt(catalog, undefined, at);
    const id = nextId(index, "rack");
    const rack: Entity = {
      id,
      kind: "rack",
      name: nextName(index, "rack", undefined),
      parentId: rackParent(index, catalog, roomId, rect),
      placement: { type: "spot", ...at },
      props: { units: RACK_UNITS_DEFAULT },
    };
    blueprint = withEntities(blueprint, [rack]);
    made.push(id);
  }
  return { blueprint, select: made };
}

const EQUIPMENT_NAMES: Readonly<Record<string, string>> = {
  crah: "항온항습기",
  inrow: "인로우 냉방기",
};

/** A cooling unit, power panel or UPS, in a room or (panels and UPS) on a floor. */
export function placeEquipment(
  bp: Blueprint,
  catalog: Catalog,
  level: Level,
  modelId: string,
  spot: Spot,
): Edit {
  if (level.kind === "site") throw new EditError("설비는 건물 안에 둬요");
  const model = catalog.get(modelId);
  if (!isFloorStandingKind(model.kind))
    throw new EditError(`${withJosa(model.name, "은")} 바닥에 세우는 설비가 아니에요`);
  if (level.kind === "floor" && model.kind === "cooling_unit")
    throw new EditError("냉방기는 서버룸 안에 둬요");
  const problem = placementProblem(bp, catalog, level, modelId, spot);
  if (problem) throw new EditError(problem);
  const index = new BlueprintIndex(bp);
  const parent = levelParent(index, level) as Entity;
  const id = nextId(index, model.kind);
  const base =
    model.kind === "cooling_unit" && "style" in model ? EQUIPMENT_NAMES[model.style] : undefined;
  const entity: Entity = {
    id,
    kind: model.kind,
    name: nextName(index, model.kind, undefined, base),
    parentId: parent.id,
    modelId,
    placement: { type: "spot", ...spot },
    props: {},
  };
  return { blueprint: withEntities(bp, [entity]), select: [id] };
}
