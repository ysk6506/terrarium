/**
 * Where a piece of equipment stands in the 3D site (REQ-050). A tool call names an entity by id; the live
 * view puts a marker where that thing is. Equipment in a room is placed on its room's plan, a server by
 * its unit in the rack, a plant item by its yard; anything that has no place of its own (a VM, a
 * datastore) stands where the thing it belongs to stands.
 */
import type { Catalog } from "@terrarium/core/catalog";
import { type BlueprintIndex, type Entity, footprint } from "@terrarium/core/world";
import { floorsOf } from "../builder/levels";
import { planFrame, toSite } from "./frame";
import { RACK_BASE_M, unitMOf } from "./racks";
import type { SiteScene } from "./site";

/** A point in the site, and what it is in: the building and floor (counted from the lowest) it can be lifted with. */
export interface Spot {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The building whose floors part when it is opened. */
  readonly building?: string;
  /** Index of the floor in that building, lowest first. */
  readonly floor?: number;
}

const RACK_TOP_M = 2.4;
const EQUIPMENT_M = 1.4;
const YARD_ITEM_M = 3;
const SITE_MARK_M = 14;
const ROOM_MARK_M = 1.6;

/** The item of a plant yard with this id, as a spot. */
function inYard(site: SiteScene, id: string): Spot | undefined {
  for (const yard of site.yards) {
    const item = yard.items.find((i) => i.id === id);
    if (item) return { x: item.x, y: YARD_ITEM_M, z: item.z };
  }
  return undefined;
}

function floorNumber(index: BlueprintIndex, floorId: string): number | undefined {
  const building = index.enclosing(floorId, "building");
  const at = building ? floorsOf(index, building.id).findIndex((f) => f.id === floorId) : -1;
  return at < 0 ? undefined : at;
}

/** A thing placed on its room's plan: a rack, a cooling unit, a panel, or the room itself. */
function inRoom(
  index: BlueprintIndex,
  catalog: Catalog,
  site: SiteScene,
  roomId: string,
  id: string,
): Spot | undefined {
  const frame = planFrame(index, catalog, site, { kind: "room", id: roomId });
  const room = index.find(roomId);
  const floor = index.enclosing(roomId, "floor");
  const building = index.enclosing(roomId, "building");
  const here = id === roomId ? room : index.find(id);
  const rect = here && footprint(here, catalog);
  if (!frame || !rect || !floor || !building) return undefined;
  const at = toSite(frame, { x: rect.x + rect.w / 2, y: rect.y + rect.d / 2 });
  const height = id === roomId ? ROOM_MARK_M : here?.kind === "rack" ? RACK_TOP_M : EQUIPMENT_M;
  const lift = floorNumber(index, floor.id);
  return {
    x: at.x,
    y: frame.y + height,
    z: at.z,
    building: building.id,
    ...(lift === undefined ? {} : { floor: lift }),
  };
}

/** Mounted in a rack: the rack's place, at the height of its unit. */
function inRack(
  index: BlueprintIndex,
  catalog: Catalog,
  site: SiteScene,
  rackId: string,
  unit: number,
): Spot | undefined {
  const room = index.enclosing(rackId, "room");
  const rack = room && inRoom(index, catalog, site, room.id, rackId);
  const frame = room && planFrame(index, catalog, site, { kind: "room", id: room.id });
  if (!rack || !frame) return undefined;
  return {
    ...rack,
    y: frame.y + RACK_BASE_M + Math.max(0, unit - 0.5) * unitMOf(catalog, index.find(rackId)),
  };
}

function siteSpot(site: SiteScene): Spot {
  return {
    x: (site.cluster.x0 + site.cluster.x1) / 2,
    y: SITE_MARK_M,
    z: (site.cluster.z0 + site.cluster.z1) / 2,
  };
}

function ofBuilding(site: SiteScene, id: string): Spot | undefined {
  const b = site.buildings.find((x) => x.id === id);
  return b ? { x: b.x, y: b.height + 3, z: b.z } : undefined;
}

function ofFloor(
  index: BlueprintIndex,
  catalog: Catalog,
  site: SiteScene,
  floorId: string,
): Spot | undefined {
  const building = index.enclosing(floorId, "building");
  const frame = planFrame(index, catalog, site, { kind: "floor", id: floorId });
  const info = building && site.buildings.find((x) => x.id === building.id);
  if (!building || !frame || !info) return undefined;
  const lift = floorNumber(index, floorId);
  const at = toSite(frame, { x: info.w / 2, y: info.d / 2 });
  return {
    x: at.x,
    y: frame.y + info.floorH / 2,
    z: at.z,
    building: building.id,
    ...(lift === undefined ? {} : { floor: lift }),
  };
}

/** An entity inside a room: placed on the room's plan, or mounted in a rack by its unit. */
function ofRoomEntity(
  index: BlueprintIndex,
  catalog: Catalog,
  site: SiteScene,
  entity: Entity,
): Spot | undefined {
  const room = index.enclosing(entity.id, "room");
  const placement = entity.placement;
  if (placement?.type === "unit") {
    const rack = index.enclosing(entity.id, "rack");
    return rack ? inRack(index, catalog, site, rack.id, placement.u) : undefined;
  }
  if (room && (placement?.type === "spot" || placement?.type === "area"))
    return inRoom(index, catalog, site, room.id, entity.id);
  return undefined;
}

/** The place an entity has of its own, by what kind of thing it is. */
function ownSpot(
  index: BlueprintIndex,
  catalog: Catalog,
  site: SiteScene,
  entity: Entity,
): Spot | undefined {
  const yard = inYard(site, entity.id);
  if (yard) return yard;
  switch (entity.kind) {
    case "building":
      return ofBuilding(site, entity.id);
    case "floor":
      return ofFloor(index, catalog, site, entity.id);
    case "room":
      return inRoom(index, catalog, site, entity.id, entity.id);
    default:
      return ofRoomEntity(index, catalog, site, entity);
  }
}

/** Kinds that are somewhere or nowhere: they do not stand where their parent stands. */
const PLACED_KINDS: ReadonlySet<string> = new Set(["building", "floor", "room"]);

/** Where `id` stands in the site, or undefined when neither it nor anything it belongs to has a place. */
export function spotOf(
  index: BlueprintIndex,
  catalog: Catalog,
  site: SiteScene,
  id: string,
  depth = 0,
): Spot | undefined {
  const entity = index.find(id);
  if (!entity || depth > 8) return undefined;
  if (entity.kind === "site") return siteSpot(site);
  const own = ownSpot(index, catalog, site, entity);
  if (own || PLACED_KINDS.has(entity.kind) || entity.parentId === undefined) return own;
  return spotOf(index, catalog, site, entity.parentId, depth + 1);
}
