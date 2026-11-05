/**
 * A building cut open (REQ-006, REQ-043): its floors one above the other, the rooms on each floor with
 * what stands in them. The building's frame has its corner at (0, 0); each room sits at its own offset.
 */
import type { Catalog } from "@terrarium/core/catalog";
import type { Rect } from "@terrarium/core/spatial";
import { type BlueprintIndex, DEFAULT_FLOOR_HEIGHT_M, floorSpace } from "@terrarium/core/world";
import { floorsOf } from "../builder/levels";
import { floorY } from "./camera";
import { boxOf } from "./plan";
import { type RoomScene, roomScene } from "./room";

export interface PlacedRoom {
  readonly id: string;
  readonly name: string;
  /** Room corner in the building frame. */
  readonly x: number;
  readonly z: number;
  readonly scene: RoomScene;
}

export interface FloorScene {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  /** Height of the floor's slab above the ground floor's, metres. */
  readonly y: number;
  readonly height: number;
  readonly rooms: readonly PlacedRoom[];
  /** The floor no room covers, in the building's frame: where a room may still grow (REQ-076). */
  readonly bare: readonly Rect[];
}

export interface BuildingScene {
  readonly id: string;
  readonly name: string;
  readonly w: number;
  readonly d: number;
  readonly floors: readonly FloorScene[];
  readonly height: number;
}

export function buildingScene(
  index: BlueprintIndex,
  catalog: Catalog,
  buildingId: string,
): BuildingScene | undefined {
  const building = index.find(buildingId);
  if (!building || building.kind !== "building") return undefined;
  const box = boxOf(building, catalog);
  if (!box) return undefined;
  const floors: FloorScene[] = floorsOf(index, building.id).map((floor) => {
    const p = floor.placement;
    const level = p?.type === "level" ? p.level : 1;
    const height = p?.type === "level" ? p.height : DEFAULT_FLOOR_HEIGHT_M;
    const rooms = index.childrenOf(floor.id, "room").flatMap((room) => {
      const at = boxOf(room, catalog);
      const scene = roomScene(index, catalog, room.id);
      if (!at || !scene) return [];
      return [{ id: room.id, name: room.name, x: at.x - at.w / 2, z: at.z - at.d / 2, scene }];
    });
    const bare = floorSpace(index, catalog, floor.id)?.bare ?? [];
    return {
      id: floor.id,
      name: floor.name,
      level,
      y: floorY(index, floor.id),
      height,
      rooms,
      bare,
    };
  });
  const top = floors.at(-1);
  return {
    id: building.id,
    name: building.name,
    w: box.w,
    d: box.d,
    floors,
    height: top ? top.y + top.height : 0,
  };
}
