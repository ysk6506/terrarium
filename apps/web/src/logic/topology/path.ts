/**
 * Which containers to open to look at something (REQ-078): the way down from the site to the place it stands in,
 * one step wider than the thing itself, so that what is around it is drawn too. A room is looked at from its floor,
 * so the room stands as a tile of its own and its racks fold under it; a rack or a server is looked at the same way,
 * from the floor of its room. A building opens to its site, a floor to its building.
 */
import { chainOf } from "@terrarium/core/topology";
import type { BlueprintIndex } from "@terrarium/core/world";

export function pathFor(index: BlueprintIndex, id: string | undefined): string[] {
  if (!id || !index.has(id)) return [];
  const chain = chainOf(index, id);
  const room = chain.findIndex((c) => index.find(c)?.kind === "room");
  return room >= 0 ? chain.slice(0, room) : [...chain];
}

/** The path cut back to one of its containers (a step on the way back out), or nothing at all. */
export function cutTo(path: readonly string[], id: string | undefined): string[] {
  if (id === undefined) return [];
  const at = path.indexOf(id);
  return at < 0 ? [...path] : path.slice(0, at + 1);
}
