/**
 * How much bare floor a storey has left (REQ-076, ADR-0081). A building on a real site has the size of the
 * real building, so a room may grow only into the floor nothing else uses: the storey's floor, less the
 * cleanroom bays, the other rooms and the core (lifts, stairs, corridors). Pure numbers over the blueprint, so
 * the generator, the builder and the tests all count the same way.
 */
import type { Catalog } from "@terrarium/core/catalog";
import type { Rect } from "@terrarium/core/spatial";
import type { Entity } from "./blueprint";
import { footprint } from "./geometry";
import type { BlueprintIndex } from "./graph";
import { roomPurposeOf } from "./purpose";
import { roomArea, roomRects } from "./room-shape";

/**
 * The part of every storey the core takes: lifts, stairs, shafts, toilets and the corridors that join them.
 * Office and data-centre floors give 10 to 15 % to it (a rule of thumb, not a survey); 12 % is the middle.
 */
export const CORE_SHARE = 0.12;

/** Floor one rack takes with its share of the aisles, m². A rule of thumb for air-cooled halls (25 to 30 sq ft a rack), not a measurement. */
export const RACK_AREA_M2 = 2.6;

/** The share of a server storey that server rooms may use ("white space"): 55 to 60 % of the floor. */
export const WHITE_FLOOR_SHARE = { low: 0.55, high: 0.6 } as const;

/** How many racks this much floor takes at the rule's density, whole racks. */
export const racksThatFit = (areaM2: number): number =>
  Math.max(0, Math.floor(areaM2 / RACK_AREA_M2 + 1e-9));

/** A building on a real site keeps its real size (set by the generator that read it off a map). */
export const isSizeLocked = (building: Pick<Entity, "kind" | "props"> | undefined): boolean =>
  building?.kind === "building" && building.props.sizeLocked === true;

export interface FloorSpace {
  readonly floorId: string;
  readonly name: string;
  /** The building's footprint, m². */
  readonly floorM2: number;
  /** Cleanroom bays, m². */
  readonly bayM2: number;
  /** Every other room, m². */
  readonly roomsM2: number;
  readonly coreM2: number;
  /** What a room may still take, m²; never below 0. */
  readonly freeM2: number;
  /** How far the rooms and bays are past what the floor allows, m²; 0 when they fit. */
  readonly overM2: number;
  /** The floor not covered by any room, as rectangles in the building's frame (for drawing). */
  readonly bare: readonly Rect[];
}

const EPS = 1e-6;

const sortedUnique = (values: number[]): number[] => {
  const out: number[] = [];
  for (const v of [...values].sort((a, b) => a - b))
    if (out.length === 0 || v - (out.at(-1) as number) > EPS) out.push(v);
  return out;
};

const inside = (r: Rect, x: number, y: number) =>
  x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.d;

/** The part of `floor` that none of `taken` covers, as few rectangles as a plain grid walk gives. */
export function bareRects(floor: Rect, taken: readonly Rect[]): Rect[] {
  const near = taken.filter(
    (t) =>
      t.x < floor.x + floor.w &&
      t.x + t.w > floor.x &&
      t.y < floor.y + floor.d &&
      t.y + t.d > floor.y,
  );
  const xs = sortedUnique([
    floor.x,
    floor.x + floor.w,
    ...near.flatMap((r) => [r.x, r.x + r.w]),
  ]).filter((x) => x >= floor.x - EPS && x <= floor.x + floor.w + EPS);
  const ys = sortedUnique([
    floor.y,
    floor.y + floor.d,
    ...near.flatMap((r) => [r.y, r.y + r.d]),
  ]).filter((y) => y >= floor.y - EPS && y <= floor.y + floor.d + EPS);
  const open: Rect[] = [];
  for (let j = 0; j + 1 < ys.length; j++) {
    const y0 = ys[j] as number;
    const y1 = ys[j + 1] as number;
    let run: { x0: number; x1: number } | undefined;
    const flush = () => {
      if (run) open.push({ x: run.x0, y: y0, w: run.x1 - run.x0, d: y1 - y0 });
      run = undefined;
    };
    for (let i = 0; i + 1 < xs.length; i++) {
      const x0 = xs[i] as number;
      const x1 = xs[i + 1] as number;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      if (near.some((r) => inside(r, cx, cy))) flush();
      else if (run) run.x1 = x1;
      else run = { x0, x1 };
    }
    flush();
  }
  return mergeDown(open);
}

/** Join rectangles that sit directly above one another with the same width. */
function mergeDown(rects: readonly Rect[]): Rect[] {
  const out: Rect[] = [];
  for (const r of rects) {
    const at = out.findIndex(
      (o) =>
        Math.abs(o.x - r.x) < EPS && Math.abs(o.w - r.w) < EPS && Math.abs(o.y + o.d - r.y) < EPS,
    );
    if (at >= 0) out[at] = { ...(out[at] as Rect), d: (out[at] as Rect).d + r.d };
    else out.push({ ...r });
  }
  return out;
}

/** The floor's numbers, or undefined when it is not a floor of a building with a size. */
export function floorSpace(
  index: BlueprintIndex,
  catalog: Catalog,
  floorId: string,
): FloorSpace | undefined {
  const floor = index.find(floorId);
  const building = floor?.kind === "floor" ? index.enclosing(floorId, "building") : undefined;
  const box = building ? footprint(building, catalog) : undefined;
  if (!floor || !box) return undefined;
  const rooms = index.childrenOf(floorId, "room");
  const bayM2 = sum(rooms.filter((r) => roomPurposeOf(r) === "cleanroom"));
  const roomsM2 = sum(rooms.filter((r) => roomPurposeOf(r) !== "cleanroom"));
  const floorM2 = box.w * box.d;
  const coreM2 = floorM2 * CORE_SHARE;
  const left = floorM2 - bayM2 - roomsM2 - coreM2;
  return {
    floorId,
    name: floor.name,
    floorM2,
    bayM2,
    roomsM2,
    coreM2,
    freeM2: Math.max(0, left),
    overM2: Math.max(0, -left),
    bare: bareRects(
      { x: 0, y: 0, w: box.w, d: box.d },
      rooms.flatMap((r) => roomRects(r)),
    ),
  };
}

const sum = (rooms: readonly Entity[]) => rooms.reduce((n, r) => n + roomArea(r), 0);

/** Every floor of a building with its numbers, lowest first. */
export function buildingFloorSpaces(
  index: BlueprintIndex,
  catalog: Catalog,
  buildingId: string,
): FloorSpace[] {
  const level = (e: Entity) => (e.placement?.type === "level" ? e.placement.level : 0);
  return [...index.childrenOf(buildingId, "floor")]
    .sort((a, b) => level(a) - level(b))
    .flatMap((f) => floorSpace(index, catalog, f.id) ?? []);
}

/** The floor of the building, other than `except`, with the most bare floor left, if it has any. */
export function roomiestOtherFloor(
  index: BlueprintIndex,
  catalog: Catalog,
  buildingId: string,
  except: string,
): FloorSpace | undefined {
  const others = buildingFloorSpaces(index, catalog, buildingId).filter(
    (f) => f.floorId !== except && f.freeM2 >= 1,
  );
  return others.sort((a, b) => b.freeM2 - a.freeM2)[0];
}
