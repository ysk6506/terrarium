/**
 * The site as the 3D view draws it (REQ-006, REQ-043, REQ-048): the land with its outline, the
 * buildings standing on it, the yards of plant equipment, the roads between them, trees and parked
 * cars. Everything is in the site's plan frame, in metres.
 */
import type { Catalog, ModelLook } from "@terrarium/core/catalog";
import { parseReserved } from "@terrarium/core/spatial";
import {
  type BlueprintIndex,
  type Entity,
  KIND_LABELS,
  roomPurposeOf,
} from "@terrarium/core/world";
import { floorsOf } from "../builder/levels";
import { type Campus, planCampus } from "./campus";
import { COOLING_MODES, type CoolingMode, hallMode, racksIn, serversIn } from "./modes";
import {
  type Bounds,
  type Box,
  boundsOf,
  boundsOfBox,
  boxOf,
  centreOf,
  inflate,
  type Pt,
  parseOutline,
  polygonArea,
  unionOf,
} from "./plan";
import { planRoads, ROAD_CELL_M, type RoadPlan } from "./roads";
import { type ParkingLot, parkingLots, scatterTrees, type Tree } from "./scatter";

const TREE_MAX = 4000;
const TREE_GAP_M = 14;

/** Trees stand wider apart on big land, so the budget reaches all of it instead of running out in the north. */
const treeGap = (landM2: number): number =>
  Math.max(TREE_GAP_M * 1.2, Math.sqrt((0.75 * landM2) / TREE_MAX));

export interface BuildingInfo extends Box {
  readonly floors: number;
  readonly floorH: number;
  readonly height: number;
  readonly purpose: string;
  readonly modes: readonly CoolingMode[];
  readonly halls: number;
  readonly rooms: number;
  readonly racks: number;
  readonly servers: number;
  readonly containments: number;
  /** Rows of cooling equipment on the roof. */
  readonly roofRows: number;
}

export type YardKind = "cooling" | "generators" | "power";

export interface YardItem extends Box {
  readonly modelId: string;
  /** chiller, dry_cooler, cooling_tower, generator, transformer, ats, switchgear, panel, busway */
  readonly style: string;
  readonly look: ModelLook;
  readonly capacityKw: number;
}

export interface Yard {
  readonly id: string;
  readonly name: string;
  readonly kind: YardKind;
  readonly area: Bounds;
  readonly items: readonly YardItem[];
}

export interface ParcelInfo {
  readonly id: string;
  readonly name: string;
  readonly area: Bounds;
  readonly owned: boolean;
  readonly areaM2: number;
  readonly priceM: number;
}

export interface SiteScene {
  readonly id: string;
  readonly name: string;
  readonly outline: readonly Pt[];
  readonly bounds: Bounds;
  /** The developed part of the land: buildings, yards and what is around them. */
  readonly cluster: Bounds;
  readonly gate: Pt;
  readonly buildings: readonly BuildingInfo[];
  readonly yards: readonly Yard[];
  readonly parcels: readonly ParcelInfo[];
  readonly roads: RoadPlan;
  readonly trees: readonly Tree[];
  readonly lots: readonly ParkingLot[];
  /** Streets, blocks and paved ground around the buildings (REQ-048). */
  readonly campus: Campus;
}

const FLOOR_H_DEFAULT = 4.5;
const YARD_MARGIN_M = 5;

const YARD_KIND: Readonly<Record<string, YardKind>> = {
  chiller: "cooling",
  generator: "generators",
  power_panel: "power",
};

function floorHeights(index: BlueprintIndex, building: Entity): { n: number; h: number } {
  const floors = floorsOf(index, building.id);
  const first = floors[0]?.placement;
  const h = first?.type === "level" ? first.height : FLOOR_H_DEFAULT;
  return { n: Math.max(1, floors.length), h };
}

function buildingInfo(index: BlueprintIndex, catalog: Catalog, building: Entity): BuildingInfo {
  const box = boxOf(building, catalog) as Box;
  const { n, h } = floorHeights(index, building);
  const modes = new Set<CoolingMode>();
  let halls = 0;
  let rooms = 0;
  let racks = 0;
  let servers = 0;
  let containments = 0;
  let chilled = false;
  for (const floor of floorsOf(index, building.id))
    for (const room of index.childrenOf(floor.id, "room")) {
      rooms++;
      containments += index.childrenOf(room.id, "containment").length;
      chilled ||= index
        .childrenOf(room.id)
        .some((e) => e.kind === "cooling_unit" || e.kind === "cdu");
      if (roomPurposeOf(room) !== "data_hall") continue;
      halls++;
      const mode = hallMode(index, catalog, room);
      if (mode) modes.add(mode);
      for (const rack of racksIn(index, room.id)) {
        racks++;
        servers += serversIn(index, rack);
      }
    }
  return {
    ...box,
    floors: n,
    floorH: h,
    height: n * h,
    purpose: String(building.props.purpose ?? "data_center"),
    modes: COOLING_MODES.filter((m) => modes.has(m)),
    halls,
    rooms,
    racks,
    servers,
    containments,
    roofRows: chilled ? Math.min(4, 1 + Math.floor(racks / 400)) : 0,
  };
}

function yardItem(entity: Entity, catalog: Catalog): YardItem | undefined {
  const box = boxOf(entity, catalog);
  if (!box || !entity.modelId || !catalog.has(entity.modelId)) return undefined;
  const model = catalog.get(entity.modelId);
  let style: string = entity.kind;
  if (model.kind === "chiller") style = model.plant;
  else if (model.kind === "power_panel") style = model.style;
  const capacityKw = "capacityKw" in model ? model.capacityKw : 0;
  return { ...box, modelId: model.id, style, look: model.look, capacityKw };
}

function yardsOf(index: BlueprintIndex, catalog: Catalog, site: Entity): Yard[] {
  const groups = new Map<string, YardItem[]>();
  const kinds = new Map<string, YardKind>();
  for (const e of index.childrenOf(site.id)) {
    const kind = YARD_KIND[e.kind];
    if (!kind) continue;
    const item = yardItem(e, catalog);
    if (!item) continue;
    const name = String(e.props.yard ?? KIND_LABELS[e.kind]);
    groups.set(name, [...(groups.get(name) ?? []), item]);
    kinds.set(name, kind);
  }
  return [...groups].map(([name, items]) => ({
    id: `yard:${name}`,
    name,
    kind: kinds.get(name) as YardKind,
    area: inflate(unionOf(items.map(boundsOfBox)) as Bounds, YARD_MARGIN_M),
    items,
  }));
}

function parcelsOf(index: BlueprintIndex, catalog: Catalog, site: Entity): ParcelInfo[] {
  return index.childrenOf(site.id, "parcel").flatMap((e) => {
    const box = boxOf(e, catalog);
    if (!box) return [];
    return [
      {
        id: e.id,
        name: e.name,
        area: boundsOfBox(box),
        owned: e.props.owned !== false,
        areaM2: Number(e.props.areaM2) || box.w * box.d,
        priceM: Number(e.props.priceM) || 0,
      },
    ];
  });
}

/** Where the land meets the viewer's side at x: the southernmost crossing of the outline. */
export function gateOf(outline: readonly Pt[], x: number): Pt {
  let best: Pt | undefined;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i] as Pt;
    const b = outline[(i + 1) % outline.length] as Pt;
    if (a.x === b.x || (x - a.x) * (x - b.x) > 0) continue;
    const z = a.z + ((b.z - a.z) * (x - a.x)) / (b.x - a.x);
    if (!best || z > best.z) best = { x, z };
  }
  if (best) return best;
  return outline.reduce((p, q) => (q.z > p.z ? q : p));
}

function doorOf(area: Bounds, from: Pt): Pt {
  const c = centreOf(area);
  const out = ROAD_CELL_M * 1.6;
  const doors: Pt[] = [
    { x: c.x, z: area.z1 + out },
    { x: c.x, z: area.z0 - out },
    { x: area.x0 - out, z: c.z },
    { x: area.x1 + out, z: c.z },
  ];
  return doors.reduce((a, b) =>
    Math.hypot(a.x - from.x, a.z - from.z) <= Math.hypot(b.x - from.x, b.z - from.z) ? a : b,
  );
}

/** Where the map shows a building this site does not build, as plan bounds. */
function reservedOf(site: Entity): Array<Bounds & { kind: string }> {
  return parseReserved(site.props.reserved).map((p) => ({
    x0: p.x,
    z0: p.y,
    x1: p.x + p.w,
    z1: p.y + p.d,
    kind: p.kind,
  }));
}

/** The land, what stands on it, and what is laid around it. */
export function siteScene(index: BlueprintIndex, catalog: Catalog): SiteScene | undefined {
  const site = index.ofKind("site")[0];
  if (!site) return undefined;
  const land = site.placement?.type === "land" ? site.placement : { w: 200, d: 200 };
  const outline = parseOutline(site.props.outline) ?? [
    { x: 0, z: 0 },
    { x: land.w, z: 0 },
    { x: land.w, z: land.d },
    { x: 0, z: land.d },
  ];
  const bounds = boundsOf(outline);
  const buildings = index
    .childrenOf(site.id, "building")
    .filter((b) => boxOf(b, catalog))
    .map((b) => buildingInfo(index, catalog, b));
  const yards = yardsOf(index, catalog, site);
  const parcels = parcelsOf(index, catalog, site);
  const reserved = reservedOf(site);
  // The places the map shows for buildings that are not built here are spoken for like the built ones.
  const built = [...buildings.map(boundsOfBox), ...yards.map((y) => y.area), ...reserved];
  const cluster = unionOf(built) ?? bounds;
  const gate = gateOf(outline, centreOf(cluster).x);
  const from = { x: centreOf(cluster).x, z: cluster.z1 };
  const roads = planRoads({
    outline,
    obstacles: built,
    gate: { x: gate.x, z: Math.max(cluster.z1 + ROAD_CELL_M * 3, gate.z - ROAD_CELL_M * 2) },
    targets: [
      ...buildings.map((b) => ({ id: b.id, door: doorOf(boundsOfBox(b), from) })),
      ...yards.map((y) => ({ id: y.id, door: doorOf(y.area, from) })),
    ],
  });
  const keepOut = [
    ...built.map((b) => inflate(b, 6)),
    ...roads.rects.map((r) => inflate(r, 3)),
    ...parcels.filter((p) => !p.owned).map((p) => p.area),
  ];
  const lots = parkingLots({
    outline,
    buildings: buildings.map((b) => ({ id: b.id, bounds: boundsOfBox(b) })),
    occupied: keepOut.map((b) => inflate(b, -2)),
    seed: 9,
  });
  const campus = planCampus({
    outline,
    buildings: buildings.map(boundsOfBox),
    yards: yards.map((y) => y.area),
    roads: roads.rects,
    avoid: [...parcels.map((p) => p.area), ...lots.map((l) => l.area)],
    reserved,
    cluster,
    landM2: Math.abs(polygonArea(outline)),
    seed: 3,
  });
  const trees = scatterTrees({
    outline,
    area: inflate(cluster, 140),
    keepOut: [...keepOut, ...campus.occupied, ...campus.aprons, ...lots.map((l) => l.area)],
    spacing: treeGap(Math.abs(polygonArea(outline))),
    seed: 5,
    max: TREE_MAX,
  });
  return {
    id: site.id,
    name: site.name,
    outline,
    bounds,
    cluster,
    gate,
    buildings,
    yards,
    parcels,
    roads,
    trees,
    lots,
    campus,
  };
}
