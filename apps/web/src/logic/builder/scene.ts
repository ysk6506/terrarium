/**
 * What the 3D view draws for a level, as plain numbers (REQ-006, REQ-036). Everything of one look goes
 * into one instance group — one draw call — so a room with 2,000 racks costs as many draw calls as a
 * room with two. The view only copies these arrays into instanced meshes.
 *
 * Frame: x and z are the level's plan (metres, x right, z = plan y), y is up.
 */
import type { Catalog } from "@terrarium/core/catalog";
import type { Rect } from "@terrarium/core/spatial";
import { type BlueprintIndex, type Entity, footprint } from "@terrarium/core/world";
import { floorsOf, type Level, levelArea, levelEntities } from "./levels";
import { elevation } from "./rack";

export type GroupKey =
  | "building"
  | "parcel"
  | "room"
  | "containment-cold"
  | "containment-hot"
  | "rack"
  | "cooling_unit"
  | "power_panel"
  | "ups";

export interface InstanceGroup {
  readonly key: GroupKey;
  /** Per instance: centre x, y, z and size x, y, z. */
  readonly boxes: Float32Array;
  /** Per instance: r, g, b in 0..1. */
  readonly colors: Float32Array;
  readonly ids: readonly string[];
  readonly opacity: number;
}

export interface SceneLabel {
  readonly id: string;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Scene {
  readonly area: Rect;
  readonly groups: readonly InstanceGroup[];
  readonly labels: readonly SceneLabel[];
  /** Entity id → where it is drawn (for selection outlines and focusing the camera). */
  readonly where: ReadonlyMap<string, { readonly group: GroupKey; readonly index: number }>;
}

/** What the view adds on top of the plain world. */
export interface Overlay {
  /** Inlet temperature per rack (°C), after "돌려 보기". */
  readonly heat?: ReadonlyMap<string, number>;
  /** Entities with an active critical alarm. */
  readonly alarmed?: ReadonlySet<string>;
}

type Rgb = readonly [number, number, number];

export const hex = (h: string): Rgb => {
  const n = Number.parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export const COLORS = {
  building: hex("#9FB3AB"),
  parcel: hex("#FF5A1F"),
  room: hex("#D6E0DB"),
  cold: hex("#3A86C9"),
  hot: hex("#C9821A"),
  rackEmpty: hex("#8A9A95"),
  rackFull: hex("#24332F"),
  cooling: hex("#5E9FB8"),
  panel: hex("#6B7B86"),
  ups: hex("#46525C"),
  critical: hex("#C43D2B"),
} as const;

/** The thermal scale: cold air, comfortable, warm, too hot (°C → colour). */
export const HEAT_STOPS: ReadonlyArray<readonly [number, Rgb]> = [
  [18, hex("#3A86C9")],
  [24, hex("#A9B6B1")],
  [28, hex("#C9821A")],
  [32, hex("#C43D2B")],
];

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.min(1, Math.max(0, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

export function heatColor(c: number): Rgb {
  const first = HEAT_STOPS[0] as (typeof HEAT_STOPS)[number];
  if (c <= first[0]) return first[1];
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const [t1, c1] = HEAT_STOPS[i] as (typeof HEAT_STOPS)[number];
    const [t0, c0] = HEAT_STOPS[i - 1] as (typeof HEAT_STOPS)[number];
    if (c <= t1) return mix(c0, c1, (c - t0) / (t1 - t0));
  }
  return (HEAT_STOPS.at(-1) as (typeof HEAT_STOPS)[number])[1];
}

export const HEIGHTS = { rack: 2.0, equipment: 1.9, containment: 2.3, roomSlab: 0.25 } as const;

class GroupBuilder {
  readonly boxes: number[] = [];
  readonly colors: number[] = [];
  readonly ids: string[] = [];

  add(id: string, rect: Rect, y0: number, height: number, color: Rgb): number {
    this.boxes.push(
      rect.x + rect.w / 2,
      y0 + height / 2,
      rect.y + rect.d / 2,
      rect.w,
      height,
      rect.d,
    );
    this.colors.push(...color);
    this.ids.push(id);
    return this.ids.length - 1;
  }
}

const OPACITY: Readonly<Record<GroupKey, number>> = {
  building: 1,
  parcel: 0.3,
  room: 1,
  "containment-cold": 0.18,
  "containment-hot": 0.18,
  rack: 1,
  cooling_unit: 1,
  power_panel: 1,
  ups: 1,
};

interface Ctx {
  readonly index: BlueprintIndex;
  readonly catalog: Catalog;
  readonly overlay: Overlay;
  readonly groups: Map<GroupKey, GroupBuilder>;
  readonly labels: SceneLabel[];
  readonly where: Map<string, { group: GroupKey; index: number }>;
}

/** How a thing is drawn: its height above the floor and its colour. */
interface Look {
  readonly height: number;
  readonly color: Rgb;
}

function put(ctx: Ctx, key: GroupKey, e: Entity, rect: Rect, look: Look): void {
  const g = ctx.groups.get(key) ?? new GroupBuilder();
  ctx.groups.set(key, g);
  const tinted = ctx.overlay.alarmed?.has(e.id) ? COLORS.critical : look.color;
  ctx.where.set(e.id, { group: key, index: g.add(e.id, rect, 0, look.height, tinted) });
}

function rackColor(ctx: Ctx, rack: Entity): Rgb {
  const heat = ctx.overlay.heat?.get(rack.id);
  if (heat !== undefined) return heatColor(heat);
  const ev = elevation(ctx.index, ctx.catalog, rack.id);
  return mix(COLORS.rackEmpty, COLORS.rackFull, 1 - ev.freeUnits / ev.units);
}

const EQUIPMENT: Readonly<Partial<Record<Entity["kind"], [GroupKey, Rgb]>>> = {
  cooling_unit: ["cooling_unit", COLORS.cooling],
  power_panel: ["power_panel", COLORS.panel],
  ups: ["ups", COLORS.ups],
};

function drawThing(ctx: Ctx, e: Entity): void {
  const rect = footprint(e, ctx.catalog);
  if (!rect) return;
  if (e.kind === "building") {
    const floors = Math.max(1, floorsOf(ctx.index, e.id).length);
    put(ctx, "building", e, rect, { height: floors * 4.5, color: COLORS.building });
    ctx.labels.push({
      id: e.id,
      text: e.name,
      x: rect.x + rect.w / 2,
      y: floors * 4.5 + 1,
      z: rect.y + rect.d / 2,
    });
  } else if (e.kind === "parcel") {
    put(ctx, "parcel", e, rect, { height: HEIGHTS.roomSlab, color: COLORS.parcel });
  } else if (e.kind === "room") {
    put(ctx, "room", e, rect, { height: HEIGHTS.roomSlab, color: COLORS.room });
    ctx.labels.push({
      id: e.id,
      text: e.name,
      x: rect.x + rect.w / 2,
      y: 0.6,
      z: rect.y + rect.d / 2,
    });
  } else if (e.kind === "containment") {
    const hot = e.props.aisle === "hot";
    put(ctx, hot ? "containment-hot" : "containment-cold", e, rect, {
      height: HEIGHTS.containment,
      color: hot ? COLORS.hot : COLORS.cold,
    });
  } else if (e.kind === "rack") {
    put(ctx, "rack", e, rect, { height: HEIGHTS.rack, color: rackColor(ctx, e) });
  } else {
    const look = EQUIPMENT[e.kind];
    if (look) put(ctx, look[0], e, rect, { height: HEIGHTS.equipment, color: look[1] });
  }
}

export function sceneOf(
  index: BlueprintIndex,
  catalog: Catalog,
  level: Level,
  overlay: Overlay = {},
): Scene {
  const ctx: Ctx = { index, catalog, overlay, groups: new Map(), labels: [], where: new Map() };
  for (const e of levelEntities(index, level)) drawThing(ctx, e);
  const groups = [...ctx.groups].map(([key, g]) => ({
    key,
    boxes: Float32Array.from(g.boxes),
    colors: Float32Array.from(g.colors),
    ids: g.ids,
    opacity: OPACITY[key],
  }));
  return { area: levelArea(index, catalog, level), groups, labels: ctx.labels, where: ctx.where };
}
