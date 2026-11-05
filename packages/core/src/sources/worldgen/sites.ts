/**
 * The six sites as shapes (REQ-048, REQ-057). Giheung, Hwaseong and Pyeongtaek were traced from the
 * outlines the owner drew on satellite maps (corners in metres at the maps' scale bar, rounded to 5 m).
 * Where each building stands, and what it is called, is read from the maps and layout pictures the
 * owner gave: Hwaseong's lines (12/13, S4, 15, 16, 17, S3, V1), the offices between them, the utility
 * building UT3, the substation, the HPC centre on its lawn and the DSR towers in the north-east corner;
 * Pyeongtaek's P1 to P6 with the complex buildings, offices, green buildings, water works, the logistics
 * centre and the 154 kV substation. All of it is approximate (centres to about 20 m, sizes to about 15 %).
 * Giheung's fabs carry the names the news gives its lines; which blue roof is which is a reading.
 * Suwon, Cheonan and Onyang are still approximations drawn for relative proportion, scaled to a rough
 * land area. The sites sit on a notional map (not to scale) in roughly the right directions from one
 * another. To use another real outline, give `outlineFromLonLat` the ring of a map export and replace
 * the points here.
 */
import {
  normalizeOutline,
  type Outline,
  outlineArea,
  outlineBounds,
  type PlotKind,
} from "@terrarium/core/spatial";
import type { SiteId } from "./spec";

/** A building's place on the land: its centre and size in metres, in the outline's frame. */
export interface SiteSlot {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly d: number;
  /** What the map calls the building ("17라인", "P1 FAB"); a campus names the building after it. */
  readonly name?: string;
}

/** A building of the campus that the world does not model but the map shows: an office, the plant, a substation. */
export interface SitePlace extends SiteSlot {
  readonly kind: PlotKind;
  readonly name: string;
}

export interface SiteShape {
  /** Corner points; in metres when `areaM2` is left out, otherwise in any consistent unit scaled to `areaM2`. */
  readonly raw: ReadonlyArray<readonly [number, number]>;
  /** Rough land area, m² (illustrative: 1 pyeong = 3.3 m²); left out when `raw` is already in metres. */
  readonly areaM2?: number;
  /** Place on the notional map of all sites: x grows east, y grows south, both 0..100. */
  readonly map: { readonly x: number; readonly y: number };
  /** Where fabs stand (the blue roofs on the map), in the order a campus fills them, corners in the outline's frame. */
  readonly fabs?: readonly SiteSlot[];
  /** Where data-centre buildings stand, in the order a campus fills them. */
  readonly dcs?: readonly SiteSlot[];
  /** Where research towers (the DSR towers) stand, in the order a campus fills them. */
  readonly labs?: readonly SiteSlot[];
  /** The other buildings the map shows, drawn where they stand and kept clear of everything else. */
  readonly places?: readonly SitePlace[];
}

export const SITE_SHAPES: Readonly<Record<SiteId, SiteShape>> = {
  giheung: {
    raw: [
      [1585, 1200],
      [1600, 765],
      [1540, 685],
      [1505, 535],
      [1365, 350],
      [1320, 135],
      [1195, 0],
      [1090, 20],
      [785, 190],
      [355, 150],
      [330, 190],
      [340, 445],
      [260, 655],
      [190, 705],
      [40, 710],
      [0, 755],
      [50, 845],
      [375, 970],
      [605, 980],
      [785, 1030],
      [1125, 1335],
      [1330, 1345],
      [1525, 1270],
    ],
    map: { x: 62, y: 22 },
    // The names are the lines the news gives Giheung (S1 is the 12-inch foundry line, 6 the 8-inch one, NRD-K
    // the research fab); which blue roof carries which name is a reading of the biggest first.
    fabs: [
      { x: 1223, y: 870, w: 220, d: 170, name: "S1라인" },
      { x: 1030, y: 725, w: 130, d: 110, name: "6라인" },
      { x: 540, y: 310, w: 170, d: 120, name: "NRD-K" },
    ],
  },
  hwaseong: {
    raw: [
      [1000, 0],
      [935, 15],
      [755, 170],
      [550, 285],
      [345, 345],
      [225, 340],
      [115, 410],
      [0, 550],
      [15, 635],
      [95, 775],
      [140, 1000],
      [130, 1230],
      [180, 1350],
      [280, 1420],
      [415, 1625],
      [595, 1655],
      [885, 1805],
      [955, 1810],
      [1200, 1720],
      [1485, 1515],
      [1640, 1330],
      [1410, 755],
      [1285, 765],
      [955, 920],
      [860, 860],
      [850, 470],
      [1135, 165],
      [1095, 40],
    ],
    map: { x: 50, y: 38 },
    // Read off the Newsroom render, the satellite picture with the line names and the owner's marks; the
    // slots are the blue roofs of the owner's map. The order is the order a campus builds them.
    fabs: [
      { x: 1077, y: 1176, w: 230, d: 157, name: "17라인" },
      { x: 1160, y: 1420, w: 314, d: 146, name: "V1" },
      { x: 1285, y: 1130, w: 170, d: 125, name: "S3" },
      { x: 745, y: 1200, w: 120, d: 250, name: "15라인" },
      { x: 680, y: 1465, w: 360, d: 130, name: "16라인" },
      { x: 326, y: 612, w: 190, d: 110, name: "12·13라인" },
      { x: 412, y: 834, w: 210, d: 120, name: "S4" },
    ],
    // The HPC centre stands on the lawn lot in front of V1 (eleven floors, about 6,800 m² on the ground).
    dcs: [{ x: 1090, y: 1600, w: 150, d: 110, name: "HPC센터" }],
    // The three DSR towers (A, B, C), about 3,900 m² a floor each, in the north-east corner of the campus.
    labs: [
      { x: 745, y: 240, w: 66, d: 60 },
      { x: 850, y: 240, w: 66, d: 60 },
      { x: 955, y: 240, w: 66, d: 60 },
    ],
    places: [
      { kind: "office", name: "MR2", x: 690, y: 910, w: 150, d: 145 },
      { kind: "utility", name: "UT3", x: 1300, y: 905, w: 210, d: 100 },
      { kind: "substation", name: "변전소", x: 1400, y: 1470, w: 110, d: 90 },
      { kind: "office", name: "사무동 A", x: 848, y: 1310, w: 50, d: 100 },
      { kind: "office", name: "사무동 B", x: 950, y: 1330, w: 50, d: 110 },
    ],
  },
  pyeongtaek: {
    raw: [
      [2095, 510],
      [1815, 215],
      [1445, 0],
      [1095, 265],
      [740, 660],
      [60, 980],
      [10, 1120],
      [0, 2090],
      [70, 2140],
      [560, 2100],
      [1700, 2105],
      [2155, 2070],
      [2460, 1985],
      [2495, 1845],
      [2445, 1635],
      [2455, 1535],
      [2375, 1315],
      [2285, 805],
    ],
    map: { x: 44, y: 62 },
    // Read off the layout drawing (배치도) and the owner's map: the east block runs P1 to P4 from north to
    // south with the complex buildings between, the west block is P6 and P5 (not built yet), the water and
    // power works line the south edge. The order is the order a campus builds them.
    fabs: [
      { x: 1530, y: 565, w: 560, d: 200, name: "P1 FAB" },
      { x: 1705, y: 988, w: 531, d: 214, name: "P2 FAB" },
      { x: 1760, y: 1262, w: 640, d: 210, name: "P3 FAB" },
      { x: 1760, y: 1665, w: 640, d: 190, name: "P4 FAB" },
      { x: 695, y: 1688, w: 630, d: 225, name: "P5 FAB" },
      { x: 695, y: 1262, w: 630, d: 225, name: "P6 FAB" },
    ],
    places: [
      { kind: "utility", name: "정수장 1", x: 1497, y: 165, w: 180, d: 130 },
      { kind: "office", name: "기술 2동", x: 1524, y: 371, w: 130, d: 100 },
      { kind: "office", name: "사무 1동", x: 1181, y: 648, w: 110, d: 100 },
      { kind: "utility", name: "P1 GC$", x: 1694, y: 773, w: 508, d: 95 },
      { kind: "utility", name: "P2 EUV동", x: 1326, y: 940, w: 165, d: 167 },
      { kind: "office", name: "사무 2동", x: 1352, y: 1105, w: 120, d: 70 },
      { kind: "construction", name: "사무 3동", x: 1352, y: 1313, w: 120, d: 200 },
      { kind: "lot", name: "사무 4동", x: 1352, y: 1617, w: 120, d: 170 },
      { kind: "utility", name: "3·4기 복합동", x: 1780, y: 1470, w: 640, d: 110 },
      { kind: "utility", name: "5·6기 복합동", x: 695, y: 1460, w: 620, d: 100 },
      { kind: "utility", name: "그린동", x: 2230, y: 953, w: 130, d: 170 },
      { kind: "utility", name: "그린동", x: 2230, y: 1244, w: 130, d: 170 },
      { kind: "utility", name: "그린동", x: 2230, y: 1465, w: 130, d: 170 },
      { kind: "utility", name: "그린동", x: 2230, y: 1681, w: 130, d: 170 },
      { kind: "warehouse", name: "평택물류센터", x: 245, y: 1225, w: 190, d: 340 },
      { kind: "utility", name: "그린동", x: 255, y: 1660, w: 180, d: 220 },
      { kind: "tanks", name: "정수장 3", x: 254, y: 1480, w: 180, d: 80 },
      { kind: "office", name: "사무동", x: 1075, y: 1485, w: 90, d: 150 },
      { kind: "office", name: "사무동", x: 1075, y: 1690, w: 90, d: 150 },
      { kind: "construction", name: "사무 6동", x: 930, y: 970, w: 240, d: 180 },
      { kind: "office", name: "삼성어린이집", x: 851, y: 745, w: 70, d: 60 },
      { kind: "office", name: "삼성물산 사무실", x: 574, y: 1036, w: 120, d: 70 },
      { kind: "tanks", name: "폐수처리장", x: 495, y: 1960, w: 700, d: 200 },
      { kind: "utility", name: "린데코리아", x: 1025, y: 1955, w: 325, d: 190 },
      { kind: "substation", name: "고덕변전소", x: 1565, y: 1940, w: 620, d: 190 },
    ],
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

/** The shape starting at (0, 0), in whole metres: scaled to `areaM2` when it has one, as it is otherwise. */
export function shapeOutline(shape: SiteShape): Outline {
  const raw: Outline = shape.raw.map(([x, y]) => ({ x, y }));
  const factor = shape.areaM2 === undefined ? 1 : Math.sqrt(shape.areaM2 / outlineArea(raw));
  return normalizeOutline(raw, factor).map((p) => ({ x: round(p.x), y: round(p.y) }));
}

/** Width and depth of the box around an outline, metres. */
export function outlineLand(outline: Outline): { w: number; d: number } {
  const box = outlineBounds(outline);
  return { w: Math.ceil(box.w), d: Math.ceil(box.d) };
}
