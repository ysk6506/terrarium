/** Which building, floor and room a focus of the 3D view is in, read from the world's index. */
import type { BlueprintIndex } from "@terrarium/core/world";
import { builder, type world3d } from "../../logic";

type Focus = world3d.Focus;

/** The room a focus is, or the room a rack is in. */
export function roomOf(index: BlueprintIndex | undefined, focus: Focus): string | undefined {
  if (focus.kind === "room") return focus.id;
  return focus.kind === "rack" ? index?.enclosing(focus.id, "room")?.id : undefined;
}

/** The building a focus is inside, if it is inside one. */
export function buildingOf(index: BlueprintIndex | undefined, focus: Focus): string | undefined {
  if (focus.kind === "site" || !index) return undefined;
  if (focus.kind === "building") return focus.id;
  return index.enclosing(focus.id, "building")?.id;
}

/** The floor a focus is on, if it is on one: a floor itself, or the floor of a room or rack. */
export function floorOf(index: BlueprintIndex | undefined, focus: Focus): string | undefined {
  if (focus.kind === "floor") return focus.id;
  const room = roomOf(index, focus);
  return room ? index?.enclosing(room, "floor")?.id : undefined;
}

/** The place of a floor among the floors of its building, counted from the bottom. */
export function floorIndexOf(
  index: BlueprintIndex | undefined,
  floorId: string,
): number | undefined {
  const building = index?.enclosing(floorId, "building");
  if (!building || !index) return undefined;
  const i = builder.floorsOf(index, building.id).findIndex((f) => f.id === floorId);
  return i < 0 ? undefined : i;
}
