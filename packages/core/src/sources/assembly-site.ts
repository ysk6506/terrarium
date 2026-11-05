/**
 * The site (ADR-0008, REQ-043): buildings packed on the land, the yard where plant stands (generators,
 * chillers, transformers), and the parcels the owner holds or could buy. Nothing here knows where the
 * description came from.
 */
import type { Catalog } from "@terrarium/core/catalog";
import {
  encodeOutline,
  encodeReserved,
  type Outline,
  packShelves,
  type ReservedPlot,
} from "@terrarium/core/spatial";
import { type Entity, parcelPriceM } from "@terrarium/core/world";
import { type BuildingSpot, outlineLayout } from "./assembly-layout";
import type { Props, YardSpec } from "./assembly-types";

const SITE_MARGIN_M = 20;
const YARD_GAP_M = 8;
/** A yard of hundreds of items (the plant of a hall of thousands of racks) stands closer together, metres. */
const DENSE_YARD_GAP_M = 3;
const DENSE_YARD_ITEMS = 150;
const gapOf = (items: number): number => (items > DENSE_YARD_ITEMS ? DENSE_YARD_GAP_M : YARD_GAP_M);
/** Smallest piece of land worth putting up for sale, metres. */
const MIN_PARCEL_M = 70;
/** Longest side of a parcel for sale, metres. */
const MAX_PARCEL_M = 320;
/** Margin between the land in use and the edge of a parcel, metres. */
const PARCEL_EDGE_M = 4;

export interface SitePlan {
  readonly id: string;
  readonly name: string;
  readonly land?: { w: number; d: number };
  readonly props: Props;
  /** Draw up parcels: the land in use is owned, the rest of the preset land is for sale. */
  readonly parcels: boolean;
  /** The shape of the land (REQ-048), from (0, 0); buildings stand inside it. Rectangular land when omitted. */
  readonly outline?: Outline;
  /**
   * Ground the map shows a building on that this world does not build. Other buildings keep off it,
   * and the site keeps the list so what is drawn around the buildings can leave it alone.
   */
  readonly reserved?: readonly ReservedPlot[];
}

export interface BuildingPlan {
  readonly id: string;
  readonly siteId: string;
  readonly name: string;
  readonly props: Props;
  /** Where the building's centre should stand, when a map says so. */
  readonly at?: { readonly x: number; readonly y: number };
  /** The size of the building when it is fixed (a real building read off a map), instead of what its rooms need. */
  readonly size?: { readonly w: number; readonly d: number };
}

export interface YardEntry {
  readonly siteId: string;
  readonly group: string;
  readonly spec: YardSpec;
  /** Stands beside this building; without one it stands in the common yard below all buildings. */
  readonly building?: string;
}

interface Size {
  readonly w: number;
  readonly d: number;
}

interface YardBlock {
  readonly items: ReadonlyArray<{ entry: YardEntry; x: number; y: number }>;
  readonly w: number;
  readonly d: number;
}

/**
 * How wide a building's yard is laid out: as wide as the building, unless that would make a strip more
 * than one and a half times as deep as it is wide (the plant of a very big hall), which no ground holds.
 */
function yardWidth(catalog: Catalog, entries: readonly YardEntry[], floor: number): number {
  const gap = gapOf(entries.length);
  const area = entries.reduce((sum, e) => {
    const s = sizeOf(catalog, e.spec.modelId);
    return sum + (s.w + gap) * (s.d + gap);
  }, 0);
  return area / floor > 1.5 * floor ? Math.ceil(Math.sqrt(area * 1.6)) : floor;
}

/** Yard equipment in groups, each group a block of shelves; the blocks are packed side by side. */
function packYard(catalog: Catalog, entries: readonly YardEntry[], maxWidth: number): YardBlock {
  const gap = gapOf(entries.length);
  const groups = [...new Set(entries.map((e) => e.group))];
  const blocks = groups.map((group) => {
    const items = entries.filter((e) => e.group === group);
    const packed = packShelves(
      items.map((e) => ({ id: e.spec.id, ...sizeOf(catalog, e.spec.modelId) })),
      maxWidth,
      gap,
    );
    const w = Math.max(...packed.map((p) => p.x + p.w)) + gap;
    const d = Math.max(...packed.map((p) => p.y + p.d)) + gap;
    return { group, items, packed, w, d };
  });
  const origin = packShelves(
    blocks.map((b) => ({ id: b.group, w: b.w, d: b.d })),
    maxWidth,
    gap,
  );
  const items: Array<{ entry: YardEntry; x: number; y: number }> = [];
  for (const block of blocks) {
    const at = origin.find((o) => o.id === block.group) as (typeof origin)[number];
    for (const entry of block.items) {
      const p = block.packed.find((x) => x.id === entry.spec.id) as (typeof block.packed)[number];
      items.push({ entry, x: at.x + p.x, y: at.y + p.y });
    }
  }
  return {
    items,
    w: Math.max(0, ...origin.map((o) => o.x + o.w)),
    d: Math.max(0, ...origin.map((o) => o.y + o.d)),
  };
}

function yardEntities(block: YardBlock, x: number, y: number): Entity[] {
  return block.items.map(({ entry, x: dx, y: dy }) => ({
    id: entry.spec.id,
    kind: entry.spec.kind,
    name: entry.spec.name,
    parentId: entry.siteId,
    modelId: entry.spec.modelId,
    placement: { type: "spot" as const, x: x + dx, y: y + dy, rotation: 0 as const },
    props: { ...(entry.spec.props ?? {}), yard: entry.group },
  }));
}

function sizeOf(catalog: Catalog, modelId: string): Size {
  const model = catalog.get(modelId);
  return "footprint" in model ? model.footprint : { w: 2, d: 2 };
}

/** The land in use is the owner's; what is left of the preset land is divided into parcels for sale. */
function parcelEntities(site: SitePlan, land: Size, used: Size): Entity[] {
  const shaped = site.outline !== undefined;
  const owned = {
    x: PARCEL_EDGE_M,
    y: PARCEL_EDGE_M,
    w: used.w - 2 * PARCEL_EDGE_M,
    d: used.d - 2 * PARCEL_EDGE_M,
  };
  const make = (
    key: string,
    name: string,
    r: { x: number; y: number; w: number; d: number },
    own: boolean,
  ): Entity => ({
    id: `${site.id}-pcl-${key}`,
    kind: "parcel",
    name,
    parentId: site.id,
    placement: { type: "area", x: r.x, y: r.y, w: r.w, d: r.d },
    props: own
      ? {}
      : {
          owned: false,
          areaM2: Math.round(r.w * r.d),
          priceM: parcelPriceM(r.w, r.d, Number(site.props.landPriceM) || undefined),
        },
  });
  // Land inside a site's own shape is the owner's without a parcel; only land bought later becomes one.
  const out = shaped ? [] : [make("main", "본 부지", owned, true)];
  const eastX = owned.x + owned.w;
  const southY = owned.y + owned.d;
  const east = {
    x: eastX,
    y: PARCEL_EDGE_M,
    w: land.w - PARCEL_EDGE_M - eastX,
    d: land.d - 2 * PARCEL_EDGE_M,
  };
  const south = { x: PARCEL_EDGE_M, y: southY, w: owned.w, d: land.d - PARCEL_EDGE_M - southY };
  let n = 0;
  for (const [label, strip, along] of [
    ["동쪽", east, "d"],
    ["남쪽", south, "w"],
  ] as const) {
    if (strip.w < MIN_PARCEL_M || strip.d < MIN_PARCEL_M) continue;
    const pieces = Math.min(3, Math.ceil(strip[along] / MAX_PARCEL_M));
    const each = strip[along] / pieces;
    for (let i = 0; i < pieces; i++) {
      const piece =
        along === "d"
          ? { ...strip, y: strip.y + i * each, d: each }
          : { ...strip, x: strip.x + i * each, w: each };
      out.push(make(String(++n), `${label} 확장 부지 ${i + 1}`, piece, false));
    }
  }
  return out;
}

/** Where things stand on one site: buildings (with the plant beside them), the common yard, and the land used. */
interface SiteLayout {
  readonly at: ReadonlyMap<string, { x: number; y: number }>;
  /** Where each building's own plant yard stands; below the building when not given. */
  readonly yardAt?: ReadonlyMap<string, { x: number; y: number }>;
  readonly commonAt?: { x: number; y: number };
  readonly used: Size;
}

interface Cluster {
  readonly id: string;
  readonly w: number;
  readonly d: number;
}

/** Clusters packed in rows on rectangular land: the original layout. */
function shelfLayout(
  clusters: readonly Cluster[],
  common: YardBlock | undefined,
  wantW: number,
): SiteLayout {
  const packed = packShelves(clusters, Math.max(wantW - SITE_MARGIN_M, 50), SITE_MARGIN_M);
  let usedW = Math.max(0, ...packed.map((p) => p.x + p.w)) + SITE_MARGIN_M;
  let usedD = Math.max(0, ...packed.map((p) => p.y + p.d)) + SITE_MARGIN_M;
  let commonAt: { x: number; y: number } | undefined;
  if (common) {
    commonAt = { x: SITE_MARGIN_M, y: usedD };
    usedW = Math.max(usedW, common.w + 2 * SITE_MARGIN_M);
    usedD += common.d + SITE_MARGIN_M;
  }
  return {
    at: new Map(packed.map((p) => [p.id, { x: p.x, y: p.y }])),
    ...(commonAt ? { commonAt } : {}),
    used: { w: usedW, d: usedD },
  };
}

/** Extra land around a shaped site that can be bought, metres. */
function forSalePad(used: Size): number {
  return Math.min(300, Math.max(100, 0.2 * Math.min(used.w, used.d)));
}

interface SiteParts {
  readonly own: readonly BuildingPlan[];
  /** The plant standing beside each building. */
  readonly beside: ReadonlyMap<string, YardBlock>;
  readonly clusters: readonly Cluster[];
  /** Plant that belongs to no building. */
  readonly common: YardBlock | undefined;
}

/** What a site holds: its buildings, each with the plant beside it as one cluster, and the common yard. */
function siteParts(
  catalog: Catalog,
  site: SitePlan,
  all: {
    buildings: readonly BuildingPlan[];
    sizes: ReadonlyMap<string, Size>;
    yard: readonly YardEntry[];
  },
): SiteParts {
  const own = all.buildings.filter((b) => b.siteId === site.id);
  const entries = all.yard.filter((y) => y.siteId === site.id);
  const beside = new Map(
    own.flatMap((b) => {
      const mine = entries.filter((e) => e.building === b.id);
      const width = Math.max((all.sizes.get(b.id) as Size).w, 60);
      return mine.length > 0
        ? [[b.id, packYard(catalog, mine, yardWidth(catalog, mine, width))] as const]
        : [];
    }),
  );
  const clusters = own.map((b): Cluster => {
    const size = all.sizes.get(b.id) as Size;
    const plant = beside.get(b.id);
    return {
      id: b.id,
      ...(plant
        ? { w: Math.max(size.w, plant.w), d: size.d + YARD_GAP_M + plant.d }
        : { w: size.w, d: size.d }),
    };
  });
  const common = entries.filter((e) => !e.building || !own.some((b) => b.id === e.building));
  return {
    own,
    beside,
    clusters,
    common: common.length > 0 ? packYard(catalog, common, 140) : undefined,
  };
}

/** The land of a site: what it was given, grown to hold what is on it, plus land to buy around a shape. */
function landOf(site: SitePlan, used: Size): Size {
  const pad = site.outline && site.parcels ? forSalePad(used) : 0;
  return {
    w: Math.max(site.land?.w ?? 0, used.w + pad),
    d: Math.max(site.land?.d ?? 0, used.d + pad),
  };
}

function siteEntity(site: SitePlan, land: Size): Entity {
  const props: Record<string, string | number | boolean> = { ...site.props };
  if (site.outline) props.outline = encodeOutline(site.outline);
  if (site.reserved) props.reserved = encodeReserved(site.reserved);
  return {
    id: site.id,
    kind: "site",
    name: site.name,
    placement: { type: "land", ...land },
    props,
  };
}

function buildingEntity(
  site: SitePlan,
  b: BuildingPlan,
  at: { x: number; y: number },
  size: Size,
): Entity {
  return {
    id: b.id,
    kind: "building",
    name: b.name,
    parentId: site.id,
    placement: { type: "area", x: at.x, y: at.y, w: size.w, d: size.d },
    props: b.props,
  };
}

/** The plant beside each building, and the common yard, at the places the layout gave them. */
function plantEntities(
  parts: SiteParts,
  layout: SiteLayout,
  sizes: ReadonlyMap<string, Size>,
): Entity[] {
  const out: Entity[] = [];
  for (const b of parts.own) {
    const plant = parts.beside.get(b.id);
    const p = layout.at.get(b.id) as { x: number; y: number };
    const own = layout.yardAt?.get(b.id) ?? {
      x: p.x,
      y: p.y + (sizes.get(b.id) as Size).d + YARD_GAP_M,
    };
    if (plant) out.push(...yardEntities(plant, own.x, own.y));
  }
  if (parts.common && layout.commonAt)
    out.push(...yardEntities(parts.common, layout.commonAt.x, layout.commonAt.y));
  return out;
}

/** Land with a shape: buildings where the map puts them or spread over it, yards beside their buildings. */
function shapedLayout(
  site: SitePlan,
  parts: SiteParts,
  sizes: ReadonlyMap<string, Size>,
  notes: string[],
): SiteLayout {
  const buildings = parts.own.map(
    (b): BuildingSpot => ({
      id: b.id,
      ...(sizes.get(b.id) as Size),
      ...(b.at ? { at: b.at } : {}),
    }),
  );
  const yards = new Map([...parts.beside].map(([id, block]) => [id, { w: block.w, d: block.d }]));
  const layout = outlineLayout(
    site.outline as Outline,
    buildings,
    yards,
    parts.common ? { w: parts.common.w, d: parts.common.d } : undefined,
    site.reserved ?? [],
  );
  if (layout.outside > 0)
    notes.push(
      `${site.name}: 부지 모양 안에 ${layout.outside}곳이 들어가지 않아 부지 밖에 두었어요`,
    );
  return layout;
}

export function siteEntities(
  catalog: Catalog,
  sites: readonly SitePlan[],
  buildings: readonly BuildingPlan[],
  buildingSize: ReadonlyMap<string, Size>,
  yard: readonly YardEntry[],
  notes: string[],
): Entity[] {
  const out: Entity[] = [];
  for (const site of sites) {
    const parts = siteParts(catalog, site, { buildings, sizes: buildingSize, yard });
    const layout = site.outline
      ? shapedLayout(site, parts, buildingSize, notes)
      : shelfLayout(parts.clusters, parts.common, site.land?.w ?? 200);
    out.push(...plantEntities(parts, layout, buildingSize));
    const land = landOf(site, layout.used);
    if (site.land && !site.outline && (land.w > site.land.w || land.d > site.land.d))
      notes.push(
        `${site.name}: 건물이 부지에 다 들어가지 않아 부지를 ${Math.round(land.w)}×${Math.round(land.d)} m로 넓혔어요`,
      );
    out.push(siteEntity(site, land));
    if (site.parcels) out.push(...parcelEntities(site, land, layout.used));
    for (const b of parts.own)
      out.push(
        buildingEntity(
          site,
          b,
          layout.at.get(b.id) as { x: number; y: number },
          buildingSize.get(b.id) as Size,
        ),
      );
  }
  return out;
}
