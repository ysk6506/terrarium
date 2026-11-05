/**
 * Changing what is already built: moving, turning, resizing, renaming, swapping models, removing,
 * and cables. Same rule as edit.ts — blueprint in, new blueprint out, or a Korean reason why not.
 */
import {
  type Catalog,
  type EquipmentModel,
  mountOfModel,
  RACK_STANDARD_LABELS,
} from "@terrarium/core/catalog";
import { withJosa } from "@terrarium/core/kernel";
import { contains, type Rect, type Rotation } from "@terrarium/core/spatial";
import {
  type Blueprint,
  BlueprintIndex,
  type Entity,
  footprint,
  KIND_LABELS,
  LINK_RULES,
  type Link,
  type LinkKind,
  type Placement,
  type PropValue,
  rackStandardOf,
} from "@terrarium/core/world";
import {
  assertFree,
  type Edit,
  EditError,
  footprintAt,
  GRID,
  groundTakers,
  nextId,
  placementProblem,
  replaceEntity,
  type Spot,
  snapRect,
  TILE_M,
} from "./edit";
import { landReason } from "./edit-site";
import { type Level, levelArea } from "./levels";

// ── moving, turning, renaming, removing ────────────────────────────────────────────────────

export function moveTo(
  bp: Blueprint,
  catalog: Catalog,
  level: Level,
  id: string,
  x: number,
  y: number,
): Edit {
  const index = new BlueprintIndex(bp);
  const entity = index.entity(id);
  const p = entity.placement;
  if (p?.type === "spot") {
    const spot: Spot = { x, y, rotation: p.rotation };
    standsAt(bp, catalog, level, entity, spot);
    return {
      blueprint: replaceEntity(bp, id, (e) => ({ ...e, placement: { ...p, x, y } })),
      select: [id],
    };
  }
  if (p?.type === "area") return resizeArea(bp, catalog, id, { x, y, w: p.w, d: p.d });
  throw new EditError(`${withJosa(entity.name, "은")} 옮길 수 없어요`);
}

/**
 * Whether an existing thing may stand at this spot: free of what else stands there and, at the site level
 * (plant beside the buildings), on land that is the owner's. Throws the reason otherwise.
 */
function standsAt(
  bp: Blueprint,
  catalog: Catalog,
  level: Level,
  entity: { readonly id: string; readonly modelId?: string | undefined },
  spot: Spot,
  lead = "",
): void {
  const problem = placementProblem(bp, catalog, level, entity.modelId, spot, [entity.id]);
  if (problem) throw new EditError(`${lead}${problem}`);
  if (level.kind !== "site") return;
  const reason = landReason(
    new BlueprintIndex(bp),
    catalog,
    footprintAt(catalog, entity.modelId, spot),
  );
  if (reason) throw new EditError(`${lead}${reason}`);
}

/** Turn a rack or piece of equipment by 90° in place. */
export function rotate(bp: Blueprint, catalog: Catalog, level: Level, id: string): Edit {
  const entity = new BlueprintIndex(bp).entity(id);
  const p = entity.placement;
  if (p?.type !== "spot") throw new EditError(`${withJosa(entity.name, "은")} 돌릴 수 없어요`);
  const rotation = ((p.rotation + 90) % 360) as Rotation;
  const spot: Spot = { x: p.x, y: p.y, rotation };
  standsAt(bp, catalog, level, entity, spot, "돌리면 ");
  return {
    blueprint: replaceEntity(bp, id, (e) => ({ ...e, placement: { ...p, rotation } })),
    select: [id],
  };
}

/**
 * What would stick out of `entity` if it were `r`: its rooms and equipment, or a building's, which stand on
 * its floors (a floor has no outline of its own, it is the building's).
 */
function spilledOut(
  index: BlueprintIndex,
  catalog: Catalog,
  entity: { readonly id: string; readonly kind: string },
  r: Rect,
) {
  const inner: Rect = { x: 0, y: 0, w: r.w, d: r.d };
  const holders = entity.kind === "building" ? index.childrenOf(entity.id, "floor") : [entity];
  return holders
    .flatMap((h) => index.childrenOf(h.id))
    .find((c) => {
      const cr = footprint(c, catalog);
      return cr !== undefined && !contains(inner, cr);
    });
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

/** Move or resize a building, room or containment; what is inside must still fit. */
export function resizeArea(bp: Blueprint, catalog: Catalog, id: string, rect: Rect): Edit {
  const index = new BlueprintIndex(bp);
  const entity = index.entity(id);
  if (entity.placement?.type !== "area" || entity.kind === "parcel")
    throw new EditError(`${withJosa(entity.name, "은")} 옮기거나 크기를 바꿀 수 없어요`);
  const step = entity.kind === "building" ? GRID.site : TILE_M;
  const r = snapRect(rect, step, step);
  const { area, siblings } = surroundings(index, catalog, entity, r);
  assertFree(index, catalog, area, r, siblings, entity.name);
  if (entity.kind === "building") {
    const reason = landReason(index, catalog, r);
    if (reason) throw new EditError(reason);
  }
  if (entity.kind !== "containment") {
    const outside = spilledOut(index, catalog, entity, r);
    if (outside)
      throw new EditError(`${withJosa(outside.name, "이")} 밖으로 나가게 돼요. 먼저 옮겨 주세요`);
  }
  const placement: Placement = { type: "area", ...r };
  return { blueprint: replaceEntity(bp, id, (e) => ({ ...e, placement })), select: [id] };
}

export function rename(bp: Blueprint, id: string, name: string): Edit {
  const trimmed = name.trim();
  if (trimmed === "") throw new EditError("이름을 적어 주세요");
  if (trimmed.length > 60) throw new EditError("이름은 60자까지예요");
  return { blueprint: replaceEntity(bp, id, (e) => ({ ...e, name: trimmed })), select: [id] };
}

export function setProp(bp: Blueprint, id: string, key: string, value: PropValue): Edit {
  return {
    blueprint: replaceEntity(bp, id, (e) => ({ ...e, props: { ...e.props, [key]: value } })),
    select: [id],
  };
}

/** Why a swap would put a device in a rack of the other standard (or fill a rack with the wrong kind), or undefined. */
function standardProblem(
  index: BlueprintIndex,
  catalog: Catalog,
  entity: Entity,
  model: EquipmentModel,
): string | undefined {
  if (entity.kind === "rack") {
    const has = rackStandardOf(entity, catalog);
    const next = model.kind === "rack" ? (model.standard ?? "eia310") : has;
    if (next === has || index.childrenOf(entity.id).length === 0) return undefined;
    return `${entity.name}에 달린 장비가 ${RACK_STANDARD_LABELS[has]}용이라 ${RACK_STANDARD_LABELS[next]} 랙으로 바꿀 수 없어요. 먼저 장비를 빼 주세요`;
  }
  const parent = entity.parentId ? index.find(entity.parentId) : undefined;
  if (parent?.kind !== "rack") return undefined;
  const wants = mountOfModel(model);
  const has = rackStandardOf(parent, catalog);
  return wants === has
    ? undefined
    : `${withJosa(model.name, "은")} ${RACK_STANDARD_LABELS[wants]}용이라 ${RACK_STANDARD_LABELS[has]} 랙에는 달 수 없어요`;
}

/** Swap a device's model for another of the same kind (same place). */
export function setModel(bp: Blueprint, catalog: Catalog, id: string, modelId: string): Edit {
  const index = new BlueprintIndex(bp);
  const entity = index.entity(id);
  const model = catalog.get(modelId);
  if (model.kind !== entity.kind)
    throw new EditError(
      `${withJosa(model.name, "은")} ${KIND_LABELS[entity.kind]} 모델이 아니에요`,
    );
  const problem = standardProblem(index, catalog, entity, model);
  if (problem) throw new EditError(problem);
  // Units of the two rack standards are not the same size, so a rack that changes standard takes its new height.
  const retall =
    model.kind === "rack" && (model.standard ?? "eia310") !== rackStandardOf(entity, catalog);
  return {
    blueprint: replaceEntity(bp, id, (e) => ({
      ...e,
      modelId,
      ...(retall ? { props: { ...e.props, units: model.uHeight } } : {}),
    })),
    select: [id],
  };
}

/** Remove things with everything inside them and every cable to them. */
export function remove(bp: Blueprint, ids: readonly string[]): Edit {
  const index = new BlueprintIndex(bp);
  const gone = new Set<string>();
  for (const id of ids) {
    const entity = index.find(id);
    if (!entity) continue;
    if (entity.kind === "site") throw new EditError("사업장은 지울 수 없어요");
    gone.add(id);
    for (const d of index.descendants(id)) gone.add(d.id);
  }
  return {
    blueprint: {
      ...bp,
      entities: bp.entities.filter((e) => !gone.has(e.id)),
      links: bp.links.filter((l) => !gone.has(l.from) && !gone.has(l.to)),
    },
    select: [],
  };
}

// ── cables ─────────────────────────────────────────────────────────────────────────────────

/** Why `from` cannot depend on `to` by this kind of link, or undefined. */
export function linkProblem(
  index: BlueprintIndex,
  kind: LinkKind,
  from: string,
  to: string,
): string | undefined {
  const a = index.find(from);
  const b = index.find(to);
  if (!a || !b) return "없는 장비예요";
  if (from === to) return "자기 자신에게는 연결할 수 없어요";
  const rule = LINK_RULES[kind];
  if (!rule.from.includes(a.kind) || !rule.to.includes(b.kind))
    return `${KIND_LABELS[a.kind]}에서 ${withJosa(KIND_LABELS[b.kind], "으로")}는 이 연결을 만들 수 없어요`;
  if (index.allLinks().some((l) => l.kind === kind && l.from === from && l.to === to))
    return "이미 연결되어 있어요";
  if (kind === "power" && index.upstream(to, "power").includes(from))
    return "전원이 돌아서 자기에게 오게 돼요";
  return undefined;
}

export function link(
  bp: Blueprint,
  kind: LinkKind,
  from: string,
  to: string,
  props: Record<string, PropValue> = {},
): Edit {
  const index = new BlueprintIndex(bp);
  const problem = linkProblem(index, kind, from, to);
  if (problem) throw new EditError(problem);
  const added: Link = { id: nextId(index, "link"), kind, from, to, props };
  return { blueprint: { ...bp, links: [...bp.links, added] }, select: [from] };
}

export function unlink(bp: Blueprint, linkId: string): Edit {
  const found = bp.links.find((l) => l.id === linkId);
  return {
    blueprint: { ...bp, links: bp.links.filter((l) => l.id !== linkId) },
    select: found ? [found.from] : [],
  };
}
