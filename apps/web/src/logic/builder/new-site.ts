/**
 * A new site (REQ-048): its shape, the land beside it that is for sale, and the blueprint that holds them. The
 * shape can be a preset's, a plain rectangle, or one drawn point by point; whatever it is, it must be a shape the
 * world can hold, and the reason it is not says what to change.
 */
import {
  encodeOutline,
  normalizeOutline,
  type Outline,
  outlineArea,
  outlineBounds,
  type Point,
} from "@terrarium/core/spatial";
import { type Blueprint, type Entity, landMarket, parcelPriceM } from "@terrarium/core/world";
import { emptyWorld } from "./edit";

/** What a site may be: big enough to build on, small enough to draw and to simulate. */
export const SITE_LIMITS = {
  minM2: 10_000,
  maxM2: 4_000_000,
  minSideM: 50,
  maxSideM: 3_000,
} as const;

/** The grid the shape is drawn on, metres. */
export const SITE_GRID_M = 10;

export const rectangleOutline = (w: number, d: number): Outline => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: d },
  { x: 0, y: d },
];

const cross = (o: Point, a: Point, b: Point) =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Whether `r`, which lies on the line through `p` and `q`, lies between them. */
const between = (p: Point, q: Point, r: Point) =>
  Math.min(p.x, q.x) <= r.x &&
  r.x <= Math.max(p.x, q.x) &&
  Math.min(p.y, q.y) <= r.y &&
  r.y <= Math.max(p.y, q.y);

/** Whether the two segments touch or cross each other. */
function touches(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  if (Math.sign(d1) * Math.sign(d2) < 0 && Math.sign(d3) * Math.sign(d4) < 0) return true;
  const lies = (side: number, p: Point, q: Point, r: Point) => side === 0 && between(p, q, r);
  return lies(d1, a, b, c) || lies(d2, a, b, d) || lies(d3, c, d, a) || lies(d4, c, d, b);
}

/** Whether any two edges that do not meet at a corner touch each other. */
function crossesItself(points: readonly Point[]): boolean {
  const n = points.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const a = points[i] as Point;
      const b = points[(i + 1) % n] as Point;
      const c = points[j] as Point;
      const d = points[(j + 1) % n] as Point;
      if (touches(a, b, c, d)) return true;
    }
  return false;
}

const group = (n: number) => n.toLocaleString("ko-KR");

/** Why this shape cannot be a site, or undefined when it can. */
export function outlineProblem(points: readonly Point[]): string | undefined {
  if (points.length < 3) return "점을 3개 이상 찍어 주세요";
  if (crossesItself(points))
    return "선이 서로 가로질러요. 마지막 점을 지우고 꼬이지 않게 다시 찍어 주세요";
  const box = outlineBounds(points);
  const area = outlineArea(points);
  if (area < SITE_LIMITS.minM2)
    return `너무 작아요. 넓이가 ${group(SITE_LIMITS.minM2)}㎡ 이상이어야 건물을 지을 수 있어요`;
  if (area > SITE_LIMITS.maxM2)
    return `너무 넓어요. ${group(SITE_LIMITS.maxM2)}㎡까지 만들 수 있어요`;
  if (box.w < SITE_LIMITS.minSideM || box.d < SITE_LIMITS.minSideM)
    return `너무 좁아요. 가로와 세로가 모두 ${SITE_LIMITS.minSideM} m 이상이어야 해요`;
  if (box.w > SITE_LIMITS.maxSideM || box.d > SITE_LIMITS.maxSideM)
    return `너무 길어요. 가로와 세로는 ${group(SITE_LIMITS.maxSideM)} m까지예요`;
  return undefined;
}

export interface ParcelSpec {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly d: number;
}

const round10 = (n: number) => Math.round(n / 10) * 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Land for sale beside a site `w` × `d`: a strip to the east and one to the south, each in two pieces. */
export function forSaleParcels(w: number, d: number): ParcelSpec[] {
  const east = clamp(round10(w * 0.25), 50, 600);
  const south = clamp(round10(d * 0.25), 50, 600);
  const out: ParcelSpec[] = [];
  for (let i = 0; i < 2; i++) {
    out.push({ name: `동쪽 확장 부지 ${i + 1}`, x: w, y: (d / 2) * i, w: east, d: d / 2 });
    out.push({ name: `남쪽 확장 부지 ${i + 1}`, x: (w / 2) * i, y: d, w: w / 2, d: south });
  }
  return out;
}

export interface SiteSpec {
  readonly name: string;
  readonly siteName: string;
  readonly outline: Outline;
  /** Put land for sale beside the site. */
  readonly forSale: boolean;
  /** Whose land prices to use (a campus preset's id, or "general"); ordinary factory land when left out. */
  readonly market?: string;
}

/** A world with nothing but the site: its shape, and any land for sale beside it. */
export function newSite(spec: SiteSpec): Blueprint {
  const problem = outlineProblem(spec.outline);
  if (problem) throw new Error(problem);
  const shape = normalizeOutline(spec.outline);
  const box = outlineBounds(shape);
  const w = Math.ceil(box.w);
  const d = Math.ceil(box.d);
  const market = landMarket(spec.market);
  const parcels = spec.forSale ? forSaleParcels(w, d) : [];
  const land = parcels.reduce(
    (acc, p) => ({ w: Math.max(acc.w, p.x + p.w), d: Math.max(acc.d, p.y + p.d) }),
    { w, d },
  );
  const base = emptyWorld("new", spec.name, land, spec.siteName);
  const site = base.entities[0] as Entity;
  const entities: Entity[] = [
    {
      ...site,
      props: { outline: encodeOutline(shape), landMarket: market.id, landPriceM: market.perM2M },
    },
    ...parcels.map(
      (p, i): Entity => ({
        id: `parcel-${i + 1}`,
        kind: "parcel",
        name: p.name,
        parentId: site.id,
        placement: { type: "area", x: p.x, y: p.y, w: p.w, d: p.d },
        props: {
          owned: false,
          areaM2: Math.round(p.w * p.d),
          priceM: parcelPriceM(p.w, p.d, market.perM2M),
        },
      }),
    ),
  ];
  return { ...base, entities };
}

/** What the land for sale beside a site `w` × `d` comes to: how many pieces, and what they cost together (million won). */
export function forSaleTotal(
  w: number,
  d: number,
  market?: string,
): { count: number; priceM: number } {
  const parcels = forSaleParcels(w, d);
  const perM2M = landMarket(market).perM2M;
  return {
    count: parcels.length,
    priceM: parcels.reduce((s, p) => s + parcelPriceM(p.w, p.d, perM2M), 0),
  };
}

export { outlineArea, outlineBounds };
