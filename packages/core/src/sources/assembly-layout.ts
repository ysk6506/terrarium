/**
 * Where things stand on a site that has the shape of real land (REQ-048): the buildings a map shows
 * stand where the map shows them, the rest are spread over the free ground well in from the edge with
 * a road between them, and each building's plant yard stands beside it rather than under it. What
 * does not fit is stacked below the land (it grows) and reported. Pure numbers: the same input gives
 * the same layout.
 */
import {
  type Outline,
  outlineBounds,
  type PackedItem,
  packSpread,
  type Rect,
  rectInOutline,
  type SpreadItem,
} from "@terrarium/core/spatial";

export interface Size {
  readonly w: number;
  readonly d: number;
}

export interface Pt {
  readonly x: number;
  readonly y: number;
}

/** A building to place: its size and, when a map says so, where its centre should be. */
export interface BuildingSpot extends Size {
  readonly id: string;
  readonly at?: Pt;
}

export interface OutlineLayout {
  /** Top-left corner of each building. */
  readonly at: ReadonlyMap<string, Pt>;
  /** Top-left corner of the plant yard of each building that has one. */
  readonly yardAt: ReadonlyMap<string, Pt>;
  readonly commonAt?: Pt;
  readonly used: Size;
  /** How many things found no room on the land and were put below it. */
  readonly outside: number;
}

export const COMMON_ID = "~common";
const SITE_MARGIN_M = 20;
/** Clear ground kept between a building and the edge of the land, metres. */
const SETBACK_M = 40;
/** The road between two buildings, metres. */
const ROAD_M = 50;
/** Least clear space between a building put where a map shows it and its neighbours, metres. */
const SLOT_GAP_M = 8;
/** A yard keeps this far from what stands beside it, metres. */
const YARD_ROAD_M = 14;

interface Pass {
  readonly gap: number;
  readonly setback: number;
  readonly reach: number;
}

/** How roomy each try at placing the buildings is; later tries accept tighter ground and farther spots. */
const BUILDING_PASSES: readonly Pass[] = [
  { gap: ROAD_M, setback: SETBACK_M, reach: 300 },
  { gap: ROAD_M * 0.6, setback: SETBACK_M / 2, reach: 300 },
  { gap: ROAD_M, setback: SETBACK_M, reach: Number.POSITIVE_INFINITY },
  { gap: SITE_MARGIN_M, setback: 0, reach: Number.POSITIVE_INFINITY },
];

/** Yards stand close to their building if they can, anywhere on the land if they must. */
const YARD_PASSES: readonly Pass[] = [
  { gap: YARD_ROAD_M, setback: 12, reach: 260 },
  { gap: YARD_ROAD_M, setback: 12, reach: 700 },
  { gap: YARD_ROAD_M, setback: 12, reach: Number.POSITIVE_INFINITY },
  { gap: 8, setback: 0, reach: Number.POSITIVE_INFINITY },
];

const overlaps = (a: Rect, b: Rect, gap: number) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.d + gap && b.y < a.y + a.d + gap;

interface Stood {
  readonly at: Map<string, Pt>;
  readonly rects: Rect[];
  readonly rest: BuildingSpot[];
}

/** Buildings a map shows standing somewhere go there when the land holds them and the neighbours leave room. */
function standAtSlots(outline: Outline, buildings: readonly BuildingSpot[]): Stood {
  const out: Stood = { at: new Map(), rects: [], rest: [] };
  for (const b of buildings) {
    if (!b.at) {
      out.rest.push(b);
      continue;
    }
    const rect = {
      x: Math.round(b.at.x - b.w / 2),
      y: Math.round(b.at.y - b.d / 2),
      w: b.w,
      d: b.d,
    };
    if (!rectInOutline(rect, outline) || out.rects.some((r) => overlaps(rect, r, SLOT_GAP_M))) {
      out.rest.push(b);
      continue;
    }
    out.at.set(b.id, { x: rect.x, y: rect.y });
    out.rects.push(rect);
  }
  return out;
}

/** Spread the items over the free ground, easing the spacing for those that find no room at first. */
function spreadInPasses(
  items: readonly SpreadItem[],
  outline: Outline,
  standing: readonly Rect[],
  passes: readonly Pass[],
): { placed: PackedItem[]; unplaced: string[] } {
  const placed: PackedItem[] = [];
  let left = items;
  for (const pass of passes) {
    if (left.length === 0) break;
    const got = packSpread(left, outline, { ...pass, taken: [...standing, ...placed] });
    placed.push(...got.placed);
    left = left.filter((i) => got.unplaced.includes(i.id));
  }
  return { placed, unplaced: left.map((i) => i.id) };
}

const yardKey = (id: string) => `${id}~yard`;
const centreOf = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.d / 2 });

/** Stack what found no room below the land, left to right; returns the grown extent. */
function stackBelow(
  items: ReadonlyMap<string, Size>,
  ids: readonly string[],
  at: Map<string, Pt>,
  used: Size,
): Size {
  let x = SITE_MARGIN_M;
  let usedW = used.w;
  for (const id of ids) {
    at.set(id, { x, y: used.d + SITE_MARGIN_M });
    x += (items.get(id) as Size).w + SITE_MARGIN_M;
    usedW = Math.max(usedW, x);
  }
  const deepest = Math.max(...ids.map((id) => (items.get(id) as Size).d));
  return { w: usedW, d: used.d + SITE_MARGIN_M + deepest };
}

export function outlineLayout(
  outline: Outline,
  buildings: readonly BuildingSpot[],
  yards: ReadonlyMap<string, Size>,
  common: Size | undefined,
  reserved: readonly Rect[] = [],
): OutlineLayout {
  const box = outlineBounds(outline);
  const stood = standAtSlots(outline, buildings);
  const near = (b: BuildingSpot): SpreadItem =>
    b.at ? { id: b.id, w: b.w, d: b.d, near: b.at } : { id: b.id, w: b.w, d: b.d };
  const spread = spreadInPasses(
    stood.rest.map(near),
    outline,
    [...stood.rects, ...reserved],
    BUILDING_PASSES,
  );
  const at = new Map<string, Pt>([
    ...stood.at,
    ...spread.placed.map((p): [string, Pt] => [p.id, { x: p.x, y: p.y }]),
  ]);
  const rects = buildings
    .filter((b) => at.has(b.id))
    .map((b) => ({ ...(at.get(b.id) as Pt), w: b.w, d: b.d }));

  const sizes = new Map<string, Size>(buildings.map((b) => [b.id, b]));
  const yardItems: SpreadItem[] = [];
  for (const b of buildings) {
    const yard = yards.get(b.id);
    const spot = at.get(b.id);
    if (!yard || !spot) continue;
    sizes.set(yardKey(b.id), yard);
    yardItems.push({ id: yardKey(b.id), ...yard, near: centreOf({ ...spot, w: b.w, d: b.d }) });
  }
  if (common) {
    sizes.set(COMMON_ID, common);
    yardItems.push({ id: COMMON_ID, ...common });
  }
  const yardsAt = spreadInPasses(yardItems, outline, [...rects, ...reserved], YARD_PASSES);
  const where = new Map<string, Pt>(yardsAt.placed.map((p) => [p.id, { x: p.x, y: p.y }]));

  const lost = [...spread.unplaced, ...yardsAt.unplaced];
  const land = { w: box.x + box.w, d: box.y + box.d };
  const lostAt = new Map<string, Pt>();
  const used = lost.length > 0 ? stackBelow(sizes, lost, lostAt, land) : land;
  for (const id of spread.unplaced) at.set(id, lostAt.get(id) as Pt);
  const yardAt = new Map<string, Pt>();
  for (const b of buildings) {
    const spot = where.get(yardKey(b.id)) ?? lostAt.get(yardKey(b.id));
    if (spot) yardAt.set(b.id, spot);
  }
  const commonAt = where.get(COMMON_ID) ?? lostAt.get(COMMON_ID);
  return {
    at,
    yardAt,
    ...(commonAt ? { commonAt } : {}),
    used,
    outside: lost.length,
  };
}
