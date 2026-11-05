/**
 * Where a builder level's flat plan stands in the 3D site (REQ-006, REQ-036). The builder edits a site, a
 * floor or a room as a flat plan with its own corner at (0, 0); the 3D view shows the whole site. This
 * module is the bridge: it says where the plan's corner is in the site, how it is turned and how high
 * its floor lies, converts a point either way, and says which focus a level is.
 */
import type { Catalog } from "@terrarium/core/catalog";
import { type BlueprintIndex, footprint, roomPurposeOf } from "@terrarium/core/world";
import type { Level } from "../builder/levels";
import { type Focus, floorY } from "./camera";
import type { Pt } from "./plan";
import { RAISED_FLOOR_M } from "./room";
import type { BuildingInfo, SiteScene } from "./site";

/** The plan's corner (0, 0) in the site, the height of its floor, and the turn of its axes (radians about y). */
export interface PlanFrame {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rot: number;
}

/** A point on a plan: x to the right, y toward the viewer. */
export interface PlanPt {
  readonly x: number;
  readonly y: number;
}

/** The slab of a room that is not a raised-floor hall. */
const SLAB_M = 0.12;

const SITE_FRAME: PlanFrame = { x: 0, y: 0, z: 0, rot: 0 };

/** Turn an offset about the vertical axis the way three.js turns `rotation.y`. */
function turn(x: number, z: number, rot: number): Pt {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { x: x * c + z * s, z: -x * s + z * c };
}

/** The site position of a point given in a building's own frame (corner at 0, 0). */
function inBuilding(b: BuildingInfo, x: number, z: number): Pt {
  const t = turn(x - b.w / 2, z - b.d / 2, b.rot);
  return { x: b.x + t.x, z: b.z + t.z };
}

/** The focus a builder level looks at; `wide` backs the camera out to the whole land (to see what is for sale). */
export function focusOfLevel(level: Level, wide = false): Focus {
  if (level.kind === "site") return wide ? { kind: "site", whole: true } : { kind: "site" };
  return { kind: level.kind, id: level.id };
}

/** The frame of a level's plan; undefined when the level names something that is not there. */
export function planFrame(
  index: BlueprintIndex,
  catalog: Catalog,
  site: SiteScene,
  level: Level,
): PlanFrame | undefined {
  if (level.kind === "site") return SITE_FRAME;
  const floor = level.kind === "floor" ? index.find(level.id) : index.enclosing(level.id, "floor");
  const building = floor && index.enclosing(floor.id, "building");
  const info = building && site.buildings.find((b) => b.id === building.id);
  if (!floor || !info) return undefined;
  const y = floorY(index, floor.id);
  if (level.kind === "floor") return { ...inBuilding(info, 0, 0), y, rot: info.rot };
  const room = index.find(level.id);
  const rect = room && footprint(room, catalog);
  if (!room || !rect) return undefined;
  const lift = roomPurposeOf(room) === "data_hall" ? RAISED_FLOOR_M : SLAB_M;
  return { ...inBuilding(info, rect.x, rect.y), y: y + lift, rot: info.rot };
}

/** A plan point as a position in the site. */
export function toSite(frame: PlanFrame, p: PlanPt): Pt {
  const t = turn(p.x, p.y, frame.rot);
  return { x: frame.x + t.x, z: frame.z + t.z };
}

/** A position in the site as a point on the plan (the reverse of `toSite`). */
export function toPlan(frame: PlanFrame, p: Pt): PlanPt {
  const t = turn(p.x - frame.x, p.z - frame.z, -frame.rot);
  return { x: t.x, y: t.z };
}
