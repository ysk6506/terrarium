/**
 * The six sites as shapes (REQ-048). Outlines are approximations drawn for relative proportion, not
 * survey data: each is a polygon scaled to a rough land area, and the sites sit on a notional map
 * (not to scale) in roughly the right directions from one another. To use a real outline, give
 * `outlineFromLonLat` the ring of a map export and replace the points here.
 */
import {
  normalizeOutline,
  type Outline,
  outlineArea,
  outlineBounds,
} from "@terrarium/core/spatial";
import type { SiteId } from "./spec";

export interface SiteShape {
  /** Corner points in any consistent unit; they are scaled to `areaM2`. */
  readonly raw: ReadonlyArray<readonly [number, number]>;
  /** Rough land area, m² (illustrative: 1 pyeong = 3.3 m²). */
  readonly areaM2: number;
  /** Place on the notional map of all sites: x grows east, y grows south, both 0..100. */
  readonly map: { readonly x: number; readonly y: number };
}

export const SITE_SHAPES: Readonly<Record<SiteId, SiteShape>> = {
  giheung: {
    raw: [
      [0, 380],
      [260, 120],
      [820, 0],
      [1500, 70],
      [2050, 300],
      [2150, 560],
      [1800, 640],
      [1250, 560],
      [760, 700],
      [330, 780],
      [40, 640],
    ],
    areaM2: 1_450_000,
    map: { x: 62, y: 22 },
  },
  hwaseong: {
    raw: [
      [0, 180],
      [520, 0],
      [1100, 60],
      [1400, 0],
      [1760, 230],
      [1700, 620],
      [1250, 760],
      [1280, 1100],
      [760, 1180],
      [380, 980],
      [60, 800],
    ],
    areaM2: 1_550_000,
    map: { x: 50, y: 38 },
  },
  pyeongtaek: {
    raw: [
      [0, 150],
      [1650, 0],
      [2250, 40],
      [2300, 520],
      [2000, 560],
      [2000, 1000],
      [2330, 1060],
      [2260, 1450],
      [1100, 1500],
      [0, 1380],
    ],
    areaM2: 2_870_000,
    map: { x: 44, y: 62 },
  },
  suwon: {
    raw: [
      [80, 0],
      [1200, 40],
      [1280, 420],
      [1180, 980],
      [760, 1100],
      [180, 1020],
      [0, 520],
    ],
    areaM2: 1_300_000,
    map: { x: 40, y: 10 },
  },
  cheonan: {
    raw: [
      [0, 140],
      [640, 0],
      [1010, 220],
      [980, 720],
      [540, 880],
      [150, 700],
    ],
    areaM2: 660_000,
    map: { x: 68, y: 82 },
  },
  onyang: {
    raw: [
      [0, 40],
      [430, 0],
      [520, 380],
      [400, 430],
      [420, 820],
      [120, 900],
      [0, 520],
    ],
    areaM2: 500_000,
    map: { x: 46, y: 92 },
  },
};

const round = (v: number) => Math.round(v);

/** The shape scaled so its area is `areaM2`, starting at (0, 0), in whole metres. */
export function shapeOutline(shape: SiteShape): Outline {
  const raw: Outline = shape.raw.map(([x, y]) => ({ x, y }));
  const factor = Math.sqrt(shape.areaM2 / outlineArea(raw));
  return normalizeOutline(raw, factor).map((p) => ({ x: round(p.x), y: round(p.y) }));
}

/** Width and depth of the box around an outline, metres. */
export function outlineLand(outline: Outline): { w: number; d: number } {
  const box = outlineBounds(outline);
  return { w: Math.ceil(box.w), d: Math.ceil(box.d) };
}
