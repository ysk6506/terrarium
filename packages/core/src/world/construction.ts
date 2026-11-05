/**
 * What building costs (REQ-059): the walls, floors and fit-out that no catalogue model stands for, in million won
 * per square metre of floor. Equipment (UPS, chillers, racks, servers) is priced by its own model; these rates are
 * only the building around it, so nothing is counted twice.
 *
 * The rates are estimates from public totals, not quotes: JLL puts a data centre at about 11.3 million dollars per
 * megawatt in 2026 (about 150억 원 at 1,343 won to the dollar), of which the equipment is more than half, and
 * Samsung's Pyeongtaek P3 fab has about 700,000 ㎡ of permitted floor. docs/design-docs/real-prices.md shows the
 * working.
 */
import type { Catalog } from "../catalog";
import type { Entity } from "./blueprint";
import { footprint } from "./geometry";
import type { BlueprintIndex } from "./graph";
import {
  type BuildingPurpose,
  buildingPurposeOf,
  type RoomPurpose,
  roomPurposeOf,
} from "./purpose";
import { roomArea } from "./room-shape";

/** Shell and core of a building, per ㎡ of every floor. A fab's includes the sub-fab and its heavy frame. */
export const BUILD_RATE_M_PER_M2: Readonly<Record<BuildingPurpose, number>> = {
  data_center: 4.5,
  fab: 8,
  utility: 3,
  research: 5,
};

/** Fit-out of a room on top of the building's own rate, per ㎡: raised floor, fire suppression, cable trays, lighting. */
export const FIT_OUT_RATE_M_PER_M2: Readonly<Record<RoomPurpose, number>> = {
  data_hall: 1.2,
  network: 0.9,
  electrical: 0.6,
  mechanical: 0.5,
  battery: 0.8,
  noc: 1,
  cleanroom: 4,
};

/** Sealing an aisle (frame, doors, roof panels), per ㎡ of floor it covers: about 1,500 dollars a rack. */
export const CONTAINMENT_RATE_M_PER_M2 = 0.9;

/** Floor area of a thing: a room's is the sum of its pieces (ADR-0080). */
const area = (e: Entity, catalog: Catalog): number => {
  if (e.placement?.type === "area") return roomArea(e);
  const r = footprint(e, catalog);
  return r ? r.w * r.d : 0;
};

/**
 * What the structure of this entity cost: a floor is its building's footprint at the building's rate, a room its
 * fit-out, a containment its frame. Everything else has no structure of its own.
 */
export function structureCostM(index: BlueprintIndex, catalog: Catalog, entity: Entity): number {
  if (entity.kind === "floor") {
    const building = index.enclosing(entity.id, "building");
    return building
      ? area(building, catalog) * BUILD_RATE_M_PER_M2[buildingPurposeOf(building)]
      : 0;
  }
  if (entity.kind === "room")
    return area(entity, catalog) * FIT_OUT_RATE_M_PER_M2[roomPurposeOf(entity)];
  if (entity.kind === "containment") return area(entity, catalog) * CONTAINMENT_RATE_M_PER_M2;
  return 0;
}
