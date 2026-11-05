/**
 * What a site draws against what its grid connection gives (REQ-076, ADR-0081). A site carries the capacity of
 * its connection in `powerCapacityMW`; the racks and equipment in it add up to a design load, and a build that
 * would take the load past the capacity is refused. The design load is the nameplate curve of every machine at
 * the utilisation worlds are sized for (the generator sizes the power chain the same way), plus the fans and pumps
 * of the cooling equipment. Chillers and generators are sized from the load, so they are not added on top. The
 * server rooms inside a fab or a research tower take their power from that building's own supply, not from the
 * data-centre connection, so they are not counted.
 */
import type { Catalog, EquipmentModel } from "@terrarium/core/catalog";
import { clamp } from "@terrarium/core/kernel";
import type { Entity } from "./blueprint";
import { bulkOf, bulkPowerW } from "./bulk";
import type { BlueprintIndex } from "./graph";
import { buildingPurposeOf } from "./purpose";

/** The utilisation the design load is counted at; the same 0.6 the generator sizes cooling and power for. */
export const DESIGN_UTIL = 0.6;

export interface PowerCapacity {
  /** Megawatts the grid connection gives. */
  readonly mw: number;
  /** True when no public figure is known and the number is a guess from the site's size. */
  readonly estimated: boolean;
}

/** The capacity a site carries, or undefined for a site without one (a world drawn by hand). */
export function powerCapacityOf(site: Entity | undefined): PowerCapacity | undefined {
  const mw = Number(site?.props.powerCapacityMW);
  if (!site || !Number.isFinite(mw) || mw <= 0) return undefined;
  return { mw, estimated: site.props.powerCapacityEstimated === true };
}

function modelOf(catalog: Catalog, e: Entity): EquipmentModel | undefined {
  return e.modelId && catalog.has(e.modelId) ? catalog.get(e.modelId) : undefined;
}

/** What one entity draws at the design load, W: a machine by its power curve, cooling equipment by its fans and pumps. */
export function designDrawW(e: Entity, catalog: Catalog, util: number = DESIGN_UTIL): number {
  if (e.kind === "rack") {
    const bulk = bulkOf(e);
    const model = bulk ? modelOf(catalog, { ...e, modelId: bulk.modelId }) : undefined;
    return bulk && model?.kind === "server" ? bulkPowerW(bulk, model, util) : 0;
  }
  const model = modelOf(catalog, e);
  if (!model) return 0;
  switch (model.kind) {
    case "server":
      return model.idlePowerW + (model.maxPowerW - model.idlePowerW) * clamp(util, 0, 1);
    case "switch":
    case "storage":
      return model.powerW;
    case "cooling_unit":
      return model.fanPowerW;
    case "cdu":
      return model.pumpPowerW * Math.max(1, model.pumps - 1);
    default:
      return 0;
  }
}

/** Whether the connection feeds this entity: everything except what stands in a fab or a research tower. */
function onConnection(index: BlueprintIndex, e: Entity): boolean {
  const building = index.enclosing(e.id, "building");
  if (!building) return true;
  const purpose = buildingPurposeOf(building);
  return purpose !== "fab" && purpose !== "research";
}

/** Everything the site's data-centre buildings and yard draw at the design load, W. */
export function siteDrawW(
  index: BlueprintIndex,
  catalog: Catalog,
  util: number = DESIGN_UTIL,
): number {
  let total = 0;
  for (const e of index.all()) {
    const w = designDrawW(e, catalog, util);
    if (w > 0 && onConnection(index, e)) total += w;
  }
  return total;
}
