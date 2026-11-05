/**
 * The rooms of a data-centre building of real size that no hall or plant fills (REQ-076, ADR-0081): the lobby
 * and loading bay and a storeroom on the ground storey, and on every server storey a storeroom and a mechanical
 * room, which stays empty until someone puts the cooling plant of a hall there. Each stands where the floor plan
 * puts it.
 */
import type { BuildingPlan } from "./campus-plan";
import { emitRoom } from "./campus-support";
import type { CampusCtx } from "./campus-types";

export function emitLockedRooms(
  ctx: CampusCtx,
  building: BuildingPlan,
  withMechanical: ReadonlySet<string>,
): void {
  const ground = `${building.id}-f1`;
  emitRoom(ctx, ground, { id: `${ground}-lobby`, name: "로비·하역장", purpose: "lobby" });
  emitRoom(ctx, ground, { id: `${ground}-sto`, name: "1F 창고", purpose: "storage" });
  for (const level of building.levels) {
    const floorId = `${building.id}-f${level}`;
    emitRoom(ctx, floorId, { id: `${floorId}-sto`, name: `${level}F 창고`, purpose: "storage" });
    if (!withMechanical.has(floorId))
      emitRoom(ctx, floorId, {
        id: `${floorId}-mech`,
        name: `${level}F 기계실`,
        purpose: "mechanical",
      });
  }
}
