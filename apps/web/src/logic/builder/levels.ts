/**
 * Where the builder is looking (REQ-006): the site with its buildings, one floor of a building with its
 * rooms, or one room with its racks and equipment. Each level has its own flat frame in metres:
 *
 *   site   the land            (buildings stand on it)
 *   floor  the building's plan (rooms, and panels/UPS standing on the floor)
 *   room   the room's plan     (racks, containments, cooling, panels, UPS)
 */
import type { Catalog } from "@terrarium/core/catalog";
import type { Rect } from "@terrarium/core/spatial";
import { type BlueprintIndex, type Entity, footprint } from "@terrarium/core/world";

export type Level =
  | { readonly kind: "site" }
  | { readonly kind: "floor"; readonly id: string }
  | { readonly kind: "room"; readonly id: string };

export const sameLevel = (a: Level, b: Level) =>
  a.kind === b.kind && (a.kind === "site" || a.id === (b as { id: string }).id);

export const siteOf = (index: BlueprintIndex) => index.ofKind("site")[0];

/** Floors of a building, lowest first. */
export function floorsOf(index: BlueprintIndex, buildingId: string): Entity[] {
  const levelNo = (e: Entity) => (e.placement?.type === "level" ? e.placement.level : 0);
  return [...index.childrenOf(buildingId, "floor")].sort((a, b) => levelNo(a) - levelNo(b));
}

/** The level an entity is seen and edited on. */
export function levelOf(index: BlueprintIndex, id: string): Level {
  const entity = index.find(id);
  if (!entity) return { kind: "site" };
  if (entity.kind === "room") return { kind: "room", id };
  if (entity.kind === "floor") return { kind: "floor", id };
  if (entity.kind === "building") {
    const first = floorsOf(index, id)[0];
    return first ? { kind: "floor", id: first.id } : { kind: "site" };
  }
  const room = index.enclosing(id, "room");
  if (room) return { kind: "room", id: room.id };
  const floor = index.enclosing(id, "floor");
  return floor ? { kind: "floor", id: floor.id } : { kind: "site" };
}

/** Where to open a world: its first room, else its first floor, else the site. */
export function startLevel(index: BlueprintIndex): Level {
  const room = index.ofKind("room")[0];
  if (room) return { kind: "room", id: room.id };
  const floor = index.ofKind("floor")[0];
  return floor ? { kind: "floor", id: floor.id } : { kind: "site" };
}

export interface Crumb {
  readonly label: string;
  readonly level: Level;
}

/** 사업장 › 건물 › 층 › 서버룸, each a way back up. */
export function crumbs(index: BlueprintIndex, level: Level): Crumb[] {
  const site = siteOf(index);
  const out: Crumb[] = [{ label: site?.name ?? "사업장", level: { kind: "site" } }];
  if (level.kind === "site") return out;
  const floor = level.kind === "floor" ? index.find(level.id) : index.enclosing(level.id, "floor");
  const building = floor ? index.enclosing(floor.id, "building") : undefined;
  if (building && floor)
    out.push({ label: `${building.name} ${floor.name}`, level: { kind: "floor", id: floor.id } });
  if (level.kind === "room") out.push({ label: index.find(level.id)?.name ?? level.id, level });
  return out;
}

/** What is drawn at a level: its spaces and the things standing in them. */
export function levelEntities(index: BlueprintIndex, level: Level): Entity[] {
  if (level.kind === "site") {
    const site = siteOf(index);
    return site ? [...index.childrenOf(site.id, "building")] : [];
  }
  if (level.kind === "floor") return index.childrenOf(level.id).filter((e) => e.kind !== "floor");
  const direct = index.childrenOf(level.id);
  const inContainment = direct
    .filter((e) => e.kind === "containment")
    .flatMap((c) => index.childrenOf(c.id));
  return [...direct, ...inContainment];
}

/** The level's own area in its frame (origin at 0,0). */
export function levelArea(index: BlueprintIndex, catalog: Catalog, level: Level): Rect {
  if (level.kind === "site") {
    const site = siteOf(index);
    const p = site?.placement;
    return p?.type === "land" ? { x: 0, y: 0, w: p.w, d: p.d } : { x: 0, y: 0, w: 200, d: 200 };
  }
  const space =
    level.kind === "floor" ? index.enclosing(level.id, "building") : index.find(level.id);
  const rect = space ? footprint(space, catalog) : undefined;
  return rect ? { x: 0, y: 0, w: rect.w, d: rect.d } : { x: 0, y: 0, w: 20, d: 20 };
}

/** The entity a level is about (the room, the floor, the site), whose children new things join. */
export function levelParent(index: BlueprintIndex, level: Level): Entity | undefined {
  return level.kind === "site" ? siteOf(index) : index.find(level.id);
}
