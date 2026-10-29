/**
 * Changing what is already built: moving, turning, resizing, renaming, swapping models, removing,
 * and cables. Same rule as edit.ts — blueprint in, new blueprint out, or a Korean reason why not.
 */
import type { Catalog } from "@terrarium/core/catalog";
import { withJosa } from "@terrarium/core/kernel";
import { contains, type Rect, type Rotation } from "@terrarium/core/spatial";
import {
  type Blueprint,
  BlueprintIndex,
  footprint,
  KIND_LABELS,
  LINK_RULES,
  type Link,
  type LinkKind,
  type Placement,
  type PropValue,
} from "@terrarium/core/world";
import {
  assertFree,
  type Edit,
  EditError,
  GRID,
  nextId,
  placementProblem,
  replaceEntity,
  type Spot,
  snapRect,
  TILE_M,
} from "./edit";
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
    const problem = placementProblem(bp, catalog, level, entity.modelId, spot, [id]);
    if (problem) throw new EditError(problem);
    return {
      blueprint: replaceEntity(bp, id, (e) => ({ ...e, placement: { ...p, x, y } })),
      select: [id],
    };
  }
  if (p?.type === "area") return resizeArea(bp, catalog, id, { x, y, w: p.w, d: p.d });
  throw new EditError(`${withJosa(entity.name, "은")} 옮길 수 없다`);
}

/** Turn a rack or piece of equipment by 90° in place. */
export function rotate(bp: Blueprint, catalog: Catalog, level: Level, id: string): Edit {
  const entity = new BlueprintIndex(bp).entity(id);
  const p = entity.placement;
  if (p?.type !== "spot") throw new EditError(`${withJosa(entity.name, "은")} 돌릴 수 없다`);
  const rotation = ((p.rotation + 90) % 360) as Rotation;
  const spot: Spot = { x: p.x, y: p.y, rotation };
  const problem = placementProblem(bp, catalog, level, entity.modelId, spot, [id]);
  if (problem) throw new EditError(`돌리면 ${problem}`);
  return {
    blueprint: replaceEntity(bp, id, (e) => ({ ...e, placement: { ...p, rotation } })),
    select: [id],
  };
}

/** Move or resize a building, room or containment; what is inside must still fit. */
export function resizeArea(bp: Blueprint, catalog: Catalog, id: string, rect: Rect): Edit {
  const index = new BlueprintIndex(bp);
  const entity = index.entity(id);
  if (entity.placement?.type !== "area")
    throw new EditError(`${withJosa(entity.name, "은")} 크기를 바꿀 수 없다`);
  const step = entity.kind === "building" ? GRID.site : TILE_M;
  const r = snapRect(rect, step, step);
  const parent = entity.parentId ? index.find(entity.parentId) : undefined;
  const area =
    entity.kind === "building"
      ? levelArea(index, catalog, { kind: "site" })
      : parent
        ? levelArea(
            index,
            catalog,
            parent.kind === "floor"
              ? { kind: "floor", id: parent.id }
              : { kind: "room", id: parent.id },
          )
        : r;
  const siblings = parent
    ? index.childrenOf(parent.id, entity.kind).filter((e) => e.id !== id)
    : [];
  assertFree(index, catalog, area, r, siblings, entity.name);
  if (entity.kind !== "containment") {
    const inner: Rect = { x: 0, y: 0, w: r.w, d: r.d };
    const outside = index.childrenOf(id).find((c) => {
      const cr = footprint(c, catalog);
      return cr !== undefined && !contains(inner, cr);
    });
    if (outside)
      throw new EditError(`${withJosa(outside.name, "이")} 밖으로 나가게 된다. 먼저 옮긴다`);
  }
  const placement: Placement = { type: "area", ...r };
  return { blueprint: replaceEntity(bp, id, (e) => ({ ...e, placement })), select: [id] };
}

export function rename(bp: Blueprint, id: string, name: string): Edit {
  const trimmed = name.trim();
  if (trimmed === "") throw new EditError("이름을 적는다");
  if (trimmed.length > 60) throw new EditError("이름은 60자까지다");
  return { blueprint: replaceEntity(bp, id, (e) => ({ ...e, name: trimmed })), select: [id] };
}

export function setProp(bp: Blueprint, id: string, key: string, value: PropValue): Edit {
  return {
    blueprint: replaceEntity(bp, id, (e) => ({ ...e, props: { ...e.props, [key]: value } })),
    select: [id],
  };
}

/** Swap a device's model for another of the same kind (same place). */
export function setModel(bp: Blueprint, catalog: Catalog, id: string, modelId: string): Edit {
  const entity = new BlueprintIndex(bp).entity(id);
  const model = catalog.get(modelId);
  if (model.kind !== entity.kind)
    throw new EditError(`${withJosa(model.name, "은")} ${KIND_LABELS[entity.kind]} 모델이 아니다`);
  return { blueprint: replaceEntity(bp, id, (e) => ({ ...e, modelId })), select: [id] };
}

/** Remove things with everything inside them and every cable to them. */
export function remove(bp: Blueprint, ids: readonly string[]): Edit {
  const index = new BlueprintIndex(bp);
  const gone = new Set<string>();
  for (const id of ids) {
    const entity = index.find(id);
    if (!entity) continue;
    if (entity.kind === "site") throw new EditError("사업장은 지울 수 없다");
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
  if (!a || !b) return "없는 장비다";
  if (from === to) return "자기 자신에게는 연결할 수 없다";
  const rule = LINK_RULES[kind];
  if (!rule.from.includes(a.kind) || !rule.to.includes(b.kind))
    return `${KIND_LABELS[a.kind]}에서 ${withJosa(KIND_LABELS[b.kind], "으로")}는 이 연결을 만들 수 없다`;
  if (index.allLinks().some((l) => l.kind === kind && l.from === from && l.to === to))
    return "이미 연결되어 있다";
  if (kind === "power" && index.upstream(to, "power").includes(from))
    return "전원이 돌아서 자기에게 오게 된다";
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
