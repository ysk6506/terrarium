/**
 * Where the camera looks (REQ-006): a focus (the site, a building, a room, a rack) becomes a box in
 * the site's frame, and a box becomes a camera pose that fits it. Pure numbers, so it is testable
 * without a browser.
 */
import type { Catalog } from "@terrarium/core/catalog";
import {
  type BlueprintIndex,
  DEFAULT_FLOOR_HEIGHT_M,
  footprint,
  roomBounds,
  roomRects,
} from "@terrarium/core/world";
import { boxOf } from "./plan";
import { ROOM_HEIGHT_M } from "./room";
import type { SiteScene } from "./site";

export type Focus =
  | { readonly kind: "site"; readonly whole?: boolean }
  | { readonly kind: "building"; readonly id: string }
  | { readonly kind: "floor"; readonly id: string }
  | { readonly kind: "room"; readonly id: string }
  | { readonly kind: "rack"; readonly id: string };

export const sameFocus = (a: Focus, b: Focus): boolean =>
  a.kind === b.kind &&
  (a.kind === "site" ? a.whole === (b as typeof a).whole : a.id === (b as { id: string }).id);

/** A box in the site's frame, metres. */
export interface Box3 {
  readonly x0: number;
  readonly y0: number;
  readonly z0: number;
  readonly x1: number;
  readonly y1: number;
  readonly z1: number;
}

export interface Pose {
  readonly target: readonly [number, number, number];
  readonly distance: number;
  /** Turn about the vertical axis, radians; 0 looks from +z toward -z. */
  readonly yaw: number;
  /** Angle above the horizon, radians. */
  readonly pitch: number;
}

export interface Lens {
  readonly fov: number;
  readonly aspect: number;
}

const deg = (d: number) => (d * Math.PI) / 180;

/** The way each kind of focus is usually looked at: from the south-west, a little above. */
export const DEFAULT_ANGLES: Readonly<Record<Focus["kind"], { yaw: number; pitch: number }>> = {
  site: { yaw: deg(-38), pitch: deg(30) },
  building: { yaw: deg(-38), pitch: deg(34) },
  floor: { yaw: deg(-36), pitch: deg(40) },
  room: { yaw: deg(-34), pitch: deg(38) },
  rack: { yaw: deg(-26), pitch: deg(13) },
};

/** How far apart the floors of an opened building are drawn, metres, so each can be seen into. */
export const EXPLODE_M = 6;

/** A tight fit would touch the edges; this much air is left around the focus. */
const MARGIN: Readonly<Record<Focus["kind"], number>> = {
  site: 1.12,
  building: 1.18,
  floor: 1.12,
  room: 1.1,
  rack: 1.4,
};

/** Distance at which the whole box is in view from the given angle. */
export function fitDistance(box: Box3, pose: Pick<Pose, "yaw" | "pitch">, lens: Lens): number {
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const cz = (box.z0 + box.z1) / 2;
  const toCamera = [
    Math.sin(pose.yaw) * Math.cos(pose.pitch),
    Math.sin(pose.pitch),
    Math.cos(pose.yaw) * Math.cos(pose.pitch),
  ] as const;
  const forward = [-toCamera[0], -toCamera[1], -toCamera[2]] as const;
  // right = forward x up(0,1,0), normalised; up' = right x forward
  const rx = -forward[2];
  const rz = forward[0];
  const rl = Math.hypot(rx, rz) || 1;
  const right = [rx / rl, 0, rz / rl] as const;
  const up = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ] as const;
  const tanV = Math.tan(lens.fov / 2);
  const tanH = tanV * lens.aspect;
  let need = 0;
  for (const x of [box.x0, box.x1])
    for (const y of [box.y0, box.y1])
      for (const z of [box.z0, box.z1]) {
        const d = [x - cx, y - cy, z - cz] as const;
        const px = Math.abs(d[0] * right[0] + d[1] * right[1] + d[2] * right[2]);
        const py = Math.abs(d[0] * up[0] + d[1] * up[1] + d[2] * up[2]);
        const depth = d[0] * forward[0] + d[1] * forward[1] + d[2] * forward[2];
        need = Math.max(need, px / tanH - depth, py / tanV - depth);
      }
  return Math.max(need, 1);
}

/** A pose that frames the box from the focus kind's usual angle. */
export function poseFor(box: Box3, kind: Focus["kind"], lens: Lens): Pose {
  const angle = DEFAULT_ANGLES[kind];
  return {
    target: [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, (box.z0 + box.z1) / 2],
    distance: fitDistance(box, angle, lens) * MARGIN[kind],
    ...angle,
  };
}

/** Where a camera with this pose stands. */
export function positionOf(pose: Pose): [number, number, number] {
  const [x, y, z] = pose.target;
  return [
    x + pose.distance * Math.sin(pose.yaw) * Math.cos(pose.pitch),
    y + pose.distance * Math.sin(pose.pitch),
    z + pose.distance * Math.cos(pose.yaw) * Math.cos(pose.pitch),
  ];
}

/** Height of a floor's slab above the ground floor's (level 1), metres: the same rule as core's absolute position. */
export function floorY(index: BlueprintIndex, floorId: string): number {
  const p = index.find(floorId)?.placement;
  if (p?.type !== "level") return 0;
  return (p.level >= 1 ? p.level - 1 : p.level) * p.height;
}

function buildingBox(index: BlueprintIndex, catalog: Catalog, id: string): Box3 | undefined {
  const b = index.find(id);
  const box = b && boxOf(b, catalog);
  if (!b || !box) return undefined;
  const floors = index.childrenOf(b.id, "floor");
  const height = floors.reduce(
    (n, f) => n + (f.placement?.type === "level" ? f.placement.height : DEFAULT_FLOOR_HEIGHT_M),
    0,
  );
  return {
    x0: box.x - box.w / 2,
    y0: 0,
    z0: box.z - box.d / 2,
    x1: box.x + box.w / 2,
    y1: Math.max(height, DEFAULT_FLOOR_HEIGHT_M) + Math.max(0, floors.length - 1) * EXPLODE_M + 3,
    z1: box.z + box.d / 2,
  };
}

/** One floor of a building: the building's footprint at the height of that floor. */
function floorBox(index: BlueprintIndex, catalog: Catalog, id: string): Box3 | undefined {
  const floor = index.find(id);
  const building = floor && floor.kind === "floor" && index.enclosing(floor.id, "building");
  const outer = building && buildingBox(index, catalog, building.id);
  if (!floor || !outer) return undefined;
  const y = floorY(index, floor.id);
  const height =
    floor.placement?.type === "level" ? floor.placement.height : DEFAULT_FLOOR_HEIGHT_M;
  return { ...outer, y0: y, y1: y + height };
}

/** Where the room's own frame starts (its body's corner) in the site's frame, and the height of its floor slab. */
function roomCorner(
  index: BlueprintIndex,
  catalog: Catalog,
  id: string,
): { readonly x: number; readonly y: number; readonly z: number } | undefined {
  const room = index.find(id);
  const floor = room && index.enclosing(room.id, "floor");
  const building = floor && index.enclosing(floor.id, "building");
  const rect = room && footprint(room, catalog);
  const outer = building && buildingBox(index, catalog, building.id);
  if (!floor || !outer || !rect) return undefined;
  return { x: outer.x0 + rect.x, y: floorY(index, floor.id), z: outer.z0 + rect.y };
}

function roomBox(index: BlueprintIndex, catalog: Catalog, id: string): Box3 | undefined {
  const room = index.find(id);
  const floor = room && index.enclosing(room.id, "floor");
  const building = floor && index.enclosing(floor.id, "building");
  // Every piece of the room counts: the box round the whole floor.
  const rect = room && roomBounds(roomRects(room));
  const outer = building && buildingBox(index, catalog, building.id);
  if (!room || !floor || !outer || !rect) return undefined;
  const y = floorY(index, floor.id);
  return {
    x0: outer.x0 + rect.x,
    y0: y,
    z0: outer.z0 + rect.y,
    x1: outer.x0 + rect.x + rect.w,
    y1: y + ROOM_HEIGHT_M,
    z1: outer.z0 + rect.y + rect.d,
  };
}

/** The box a focus covers, in the site's frame. */
export function focusBox(
  index: BlueprintIndex,
  catalog: Catalog,
  site: SiteScene,
  focus: Focus,
): Box3 | undefined {
  if (focus.kind === "site") {
    const b = focus.whole ? site.bounds : site.cluster;
    return { x0: b.x0, y0: 0, z0: b.z0, x1: b.x1, y1: 30, z1: b.z1 };
  }
  if (focus.kind === "building") return buildingBox(index, catalog, focus.id);
  if (focus.kind === "floor") return floorBox(index, catalog, focus.id);
  if (focus.kind === "room") return roomBox(index, catalog, focus.id);
  const rack = index.find(focus.id);
  const room = rack && index.enclosing(rack.id, "room");
  const outer = room && roomCorner(index, catalog, room.id);
  const rect = rack && footprint(rack, catalog);
  if (!rack || !outer || !rect) return undefined;
  return {
    x0: outer.x + rect.x - 0.9,
    y0: outer.y + 0.6,
    z0: outer.z + rect.y - 0.3,
    x1: outer.x + rect.x + rect.w + 0.9,
    y1: outer.y + 0.6 + 2.3,
    z1: outer.z + rect.y + rect.d + 0.3,
  };
}

/** What a thing's own focus is: the level it belongs to, for jumping from a search hit or an alarm. */
export function focusOf(index: BlueprintIndex, id: string): Focus {
  const e = index.find(id);
  if (!e) return { kind: "site" };
  if (e.kind === "building") return { kind: "building", id };
  if (e.kind === "floor") return { kind: "building", id: e.parentId ?? id };
  if (e.kind === "room") return { kind: "room", id };
  if (e.kind === "rack") return { kind: "rack", id };
  const rack = index.enclosing(id, "rack");
  if (rack) return { kind: "rack", id: rack.id };
  const room = index.enclosing(id, "room");
  if (room) return { kind: "room", id: room.id };
  const building = index.enclosing(id, "building");
  return building ? { kind: "building", id: building.id } : { kind: "site" };
}

export interface Crumb {
  readonly label: string;
  readonly focus: Focus;
}

/** 사업장 › 건물 › 층 › 서버룸 › 랙, each a way back up. */
export function crumbsOf(index: BlueprintIndex, focus: Focus): Crumb[] {
  const site = index.ofKind("site")[0];
  const out: Crumb[] = [{ label: site?.name ?? "사업장", focus: { kind: "site" } }];
  if (focus.kind === "site") return out;
  const entity = index.find(focus.id);
  if (!entity) return out;
  const building =
    index.enclosing(entity.id, "building") ?? (entity.kind === "building" ? entity : undefined);
  if (building) out.push({ label: building.name, focus: { kind: "building", id: building.id } });
  if (entity.kind === "floor") out.push({ label: entity.name, focus });
  const room = index.enclosing(entity.id, "room");
  if (room) {
    const floor = index.enclosing(room.id, "floor");
    out.push({
      label: floor ? `${floor.name} ${room.name}` : room.name,
      focus: { kind: "room", id: room.id },
    });
  }
  if (entity.kind === "rack") out.push({ label: entity.name, focus });
  return out;
}
