/** Floor-standing equipment and plant as the 3D view draws it: where it stands, how tall, what it looks like. */
import type { Catalog, ModelLook } from "@terrarium/core/catalog";
import type { Entity } from "@terrarium/core/world";
import { type Box, boxOf } from "./plan";

export interface EquipBox extends Box {
  readonly modelId: string;
  /** crah, inrow, cdu, ups, switchgear, ats, transformer, panel, busway, chiller, dry_cooler, cooling_tower, generator */
  readonly style: string;
  readonly look: ModelLook;
  /** Height of the body, metres. */
  readonly h: number;
  /** Base height above the view's floor, metres. */
  readonly oy: number;
  /** kW (kVA for UPS), 0 when the model has no rating. */
  readonly capacity: number;
  /** Takes chilled or facility water. */
  readonly wet: boolean;
}

const HEIGHT_M: Readonly<Record<string, number>> = {
  crah: 2.4,
  inrow: 2.0,
  cdu: 2.1,
  ups: 2.1,
  switchgear: 2.3,
  ats: 2.1,
  transformer: 2.4,
  panel: 2.0,
  busway: 0.3,
  chiller: 3.2,
  dry_cooler: 2.6,
  cooling_tower: 7.5,
  generator: 3.2,
};

/** An overhead busway hangs above the aisles, not on the floor. */
const BUSWAY_BASE_M = 3.3;

/** The style of a modelled floor-standing or plant entity, from its model. */
export function styleOf(catalog: Catalog, entity: Entity): string {
  if (!entity.modelId || !catalog.has(entity.modelId)) return entity.kind;
  const model = catalog.get(entity.modelId);
  if (model.kind === "cooling_unit") return model.style;
  if (model.kind === "chiller") return model.plant;
  if (model.kind === "power_panel") return model.style;
  return model.kind;
}

export function equipOf(
  catalog: Catalog,
  entity: Entity,
  ox = 0,
  oy = 0,
  oz = 0,
): EquipBox | undefined {
  const box = boxOf(entity, catalog, ox, oz);
  if (!box || !entity.modelId || !catalog.has(entity.modelId)) return undefined;
  const model = catalog.get(entity.modelId);
  const style = styleOf(catalog, entity);
  const capacity =
    "capacityKw" in model ? model.capacityKw : model.kind === "power_panel" ? model.capacityA : 0;
  const wet =
    model.kind === "cdu" ||
    model.kind === "chiller" ||
    (model.kind === "cooling_unit" && model.chilledWater);
  return {
    ...box,
    modelId: model.id,
    style,
    look: model.look,
    h: HEIGHT_M[style] ?? 2.0,
    oy: oy + (style === "busway" ? BUSWAY_BASE_M : 0),
    capacity,
    wet,
  };
}
