/**
 * What the builder says about the floor of a storey (REQ-076, ADR-0081): how much bare floor is left, which other
 * storeys still have some, how many racks a room's new floor takes, and the refusal when a room has no bare floor
 * left to grow into. Counting is `core.world.floorSpace`; this is how it is put into words.
 */
import type { Catalog } from "@terrarium/core/catalog";
import {
  type Blueprint,
  BlueprintIndex,
  buildingFloorSpaces,
  type FloorSpace,
  floorSpace,
  isSizeLocked,
  racksThatFit,
  roomArea,
  roomiestOtherFloor,
} from "@terrarium/core/world";
import { count } from "../format";
import { EditError } from "./edit-error";
import { Refusal } from "./refusal";

/** Square metres as people say them: "320 m²". */
export const squareMetres = (m2: number): string => `${count(Math.round(m2))} m²`;

/**
 * The refusal for a room that cannot grow into the bare floor of its storey: the building to widen (a building drawn by
 * hand), or, in a building of real size, the other floor to go to. A room that has met a wall while the floor still has
 * bare floor elsewhere is told so instead, since the floor is not full.
 */
export function floorFullRefusal(
  index: BlueprintIndex,
  catalog: Catalog,
  floorId: string,
  atWall = false,
): EditError {
  const building = index.enclosing(floorId, "building");
  if (!building) return new EditError("이 층은 꽉 찼어요");
  if (!isSizeLocked(building))
    return new Refusal("건물이 꽉 찼어요. 건물을 넓혀요", {
      kind: "widen-building",
      entityId: building.id,
    });
  const here = floorSpace(index, catalog, floorId);
  if (atWall && here && racksThatFit(here.freeM2) > 0)
    return new EditError(
      `건물 벽에 닿았어요. 이 층 빈 바닥 ${squareMetres(here.freeM2)}는 다른 쪽에 있어요`,
    );
  const other = roomiestOtherFloor(index, catalog, building.id, floorId);
  return other
    ? new Refusal(`이 층은 꽉 찼어요. ${other.name}에 ${squareMetres(other.freeM2)} 비어 있어요`, {
        kind: "other-floor",
        entityId: other.floorId,
      })
    : new EditError("이 층은 꽉 찼어요. 이 건물의 다른 층에도 빈 바닥이 없어요");
}

/**
 * Throws when the change leaves the floor with more rooms than its bare floor holds (and more than before: a floor
 * that was already over can still lose rooms). The floor is where the rooms stand, wherever the change was made.
 */
export function assertFloorRoom(
  before: Blueprint,
  after: Blueprint,
  catalog: Catalog,
  floorId: string | undefined,
): void {
  if (!floorId) return;
  const now = new BlueprintIndex(after);
  const over = floorSpace(now, catalog, floorId)?.overM2 ?? 0;
  if (over <= 1e-6) return;
  const was = floorSpace(new BlueprintIndex(before), catalog, floorId)?.overM2 ?? 0;
  if (over > was + 1e-6) throw floorFullRefusal(now, catalog, floorId);
}

export interface FloorNote {
  /** The building keeps the size of the real one. */
  readonly locked: boolean;
  readonly floor?: FloorSpace;
  /** Every other storey that has bare floor left, roomiest first. */
  readonly others: readonly FloorSpace[];
  readonly othersM2: number;
}

/** The numbers for a building and the storey being looked at (all storeys alike when none is given). */
export function floorNote(
  index: BlueprintIndex,
  catalog: Catalog,
  buildingId: string,
  floorId?: string,
): FloorNote | undefined {
  const building = index.find(buildingId);
  if (building?.kind !== "building") return undefined;
  const all = buildingFloorSpaces(index, catalog, buildingId);
  const floor = all.find((f) => f.floorId === floorId);
  const others = all
    .filter((f) => f.floorId !== floor?.floorId && f.freeM2 >= 1)
    .sort((a, b) => b.freeM2 - a.freeM2);
  return {
    locked: isSizeLocked(building),
    ...(floor ? { floor } : {}),
    others,
    othersM2: others.reduce((n, f) => n + f.freeM2, 0),
  };
}

/** "이 건물은 실제 크기예요 · 이 층 빈 바닥 N m² · 다른 층 M m²" (the first part only for a building of real size). */
export function floorNoteText(note: FloorNote): string {
  return [
    note.locked ? "이 건물은 실제 크기예요" : undefined,
    note.floor ? `이 층 빈 바닥 ${squareMetres(note.floor.freeM2)}` : undefined,
    note.others.length > 0
      ? `${note.floor ? "다른 층" : "층마다 합쳐 빈 바닥"} ${squareMetres(note.othersM2)}`
      : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" · ");
}

/** "랙 12대가 더 들어가요" for floor added to a room, or undefined when it would not take a rack. */
export function moreRacksText(addedM2: number): string | undefined {
  const racks = racksThatFit(addedM2);
  return racks > 0 ? `랙 ${count(racks)}대가 더 들어가요` : undefined;
}

/** What the racks more a room takes after an edit come to: the new floor of the room over the 2.6 m² a rack needs. */
export function racksGainText(
  before: Blueprint,
  after: Blueprint,
  roomId: string,
): string | undefined {
  const area = (bp: Blueprint) => {
    const room = new BlueprintIndex(bp).find(roomId);
    return room ? roomArea(room) : 0;
  };
  return moreRacksText(area(after) - area(before));
}
