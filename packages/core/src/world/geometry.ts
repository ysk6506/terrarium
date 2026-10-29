/** Physical size and absolute position of entities (metres). */
import type { Catalog } from "@terrarium/core/catalog";
import { RACK_DEPTH_M, RACK_UNITS_DEFAULT, RACK_WIDTH_M, U_HEIGHT_M } from "@terrarium/core/kernel";
import { type Rect, rotated } from "@terrarium/core/spatial";
import type { Entity } from "./blueprint";
import type { BlueprintIndex } from "./graph";

export const DEFAULT_FLOOR_HEIGHT_M = 4.5;

/** Footprint in the parent's coordinates, for entities that stand on a floor or area. */
export function footprint(entity: Entity, catalog: Catalog): Rect | undefined {
  const p = entity.placement;
  if (p?.type === "area") return { x: p.x, y: p.y, w: p.w, d: p.d };
  if (p?.type === "land") return { x: 0, y: 0, w: p.w, d: p.d };
  if (p?.type !== "spot") return undefined;
  let size = { w: RACK_WIDTH_M, d: RACK_DEPTH_M };
  if (entity.modelId && catalog.has(entity.modelId)) {
    const model = catalog.get(entity.modelId);
    if ("footprint" in model) size = model.footprint;
  }
  const r = rotated(size.w, size.d, p.rotation);
  return { x: p.x, y: p.y, w: r.w, d: r.d };
}

/** Height in rack units for rack-mounted equipment (vertical PDUs take 0U). */
export function heightU(entity: Entity, catalog: Catalog): number {
  if (!entity.modelId || !catalog.has(entity.modelId)) return 1;
  const model = catalog.get(entity.modelId);
  return "uHeight" in model ? model.uHeight : 0;
}

/**
 * Rack units a rack (or immersion tank) offers: what the user set, else what its model is built with,
 * else the standard 42U.
 */
export function rackUnits(rack: Entity, catalog: Catalog): number {
  const set = Number(rack.props.units);
  if (Number.isFinite(set) && set > 0) return set;
  if (rack.modelId && catalog.has(rack.modelId)) {
    const model = catalog.get(rack.modelId);
    if (model.kind === "rack") return model.uHeight;
  }
  return RACK_UNITS_DEFAULT;
}

export interface Position3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Absolute position of an entity's centre in the site frame: site (0,0) -> building -> floor level ->
 * room -> rack/equipment spot -> rack unit. Virtual entities have no position.
 */
export function absolutePosition(
  index: BlueprintIndex,
  catalog: Catalog,
  id: string,
): Position3 | undefined {
  const entity = index.entity(id);
  if (!entity.placement) return undefined;
  const chain = [entity, ...index.ancestors(id)].reverse();
  let x = 0;
  let y = 0;
  let z = 0;
  let center = { x: 0, y: 0, z: 0 };
  for (const node of chain) {
    const p = node.placement;
    // Racks and equipment in a containment use room coordinates, so a containment adds no offset.
    if (!p || (node.kind === "containment" && node !== entity)) continue;
    if (p.type === "level") {
      // Level 1 is the ground floor (z = 0); level 0 / -1 are basements below it.
      z += (p.level >= 1 ? p.level - 1 : p.level) * p.height;
      center = { x, y, z };
    } else if (p.type === "unit") {
      z += (p.u - 1) * U_HEIGHT_M;
      center = { x: center.x, y: center.y, z: z + (heightU(node, catalog) * U_HEIGHT_M) / 2 };
    } else {
      const rect = footprint(node, catalog) as Rect;
      if (p.type !== "land") {
        x += rect.x;
        y += rect.y;
      }
      center = { x: x + rect.w / 2, y: y + rect.d / 2, z };
    }
  }
  return center;
}
