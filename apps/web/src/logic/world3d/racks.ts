/**
 * Racks as the 3D view draws them: grouped by what they are (one group = one instanced mesh), each
 * with where it stands, how full it is and whether it is a light rack that counts its servers.
 */
import type { Catalog, ModelLook, RackModel, ServerModel } from "@terrarium/core/catalog";
import {
  type BlueprintIndex,
  bulkOf,
  type Entity,
  footprint,
  rackStandardOf,
  rackUnits,
} from "@terrarium/core/world";
import { type RackForm, rackFormOf, rackModelOf } from "./modes";
import { turnOf } from "./plan";

/** Height of one rack unit and what the frame adds above and below, metres. */
export const U_M = 0.0445;
/** One OpenU of an ORv3 rack, metres (REQ-063). */
export const OU_M = 0.048;
export const RACK_BASE_M = 0.14;
export const TANK_HEIGHT_M = 1.15;

const FALLBACK_LOOK: ModelLook = {
  body: "#2b3036",
  accent: "#4aa3ff",
  finish: "metal",
  front: "mesh",
};

/** What a group of racks has in common. */
export interface RackKind {
  readonly key: string;
  readonly modelId: string;
  readonly form: RackForm;
  readonly name: string;
  /** Width and depth of the footprint, metres. */
  readonly w: number;
  readonly d: number;
  /** Height of the rack or tank, metres. */
  readonly h: number;
  readonly units: number;
  /** Height of one unit in this rack: 44.5 mm, or 48 mm in an ORv3 rack. */
  readonly unitM: number;
  readonly look: ModelLook;
}

export interface RackSet {
  readonly kind: RackKind;
  readonly ids: readonly string[];
  /** Per rack: centre x, base y, centre z, turn (radians). */
  readonly at: Float32Array;
  /** Per rack: 1 when it is a light rack. */
  readonly bulk: Uint8Array;
  /** Per rack: servers it holds (counted for a light rack). */
  readonly servers: Uint16Array;
  /** Per rack: share of its units in use, 0..1. */
  readonly fill: Float32Array;
}

/** A rack to draw and where its frame sits in the view's frame. */
export interface RackPlace {
  readonly rack: Entity;
  readonly ox: number;
  readonly oy: number;
  readonly oz: number;
}

/** Height of one unit in a rack, metres. */
export const unitMOf = (catalog: Catalog, rack: Entity | undefined): number =>
  rackStandardOf(rack, catalog) === "orv3" ? OU_M : U_M;

export function rackKindOf(catalog: Catalog, rack: Entity): RackKind {
  const model: RackModel | undefined = rackModelOf(catalog, rack);
  const form = rackFormOf(model);
  const units = rackUnits(rack, catalog);
  const unitM = unitMOf(catalog, rack);
  const w = model?.footprint.w ?? 0.6;
  const d = model?.footprint.d ?? 1.2;
  return {
    key: model?.id ?? "rack",
    modelId: model?.id ?? "",
    form,
    name: model?.name ?? "랙",
    w,
    d,
    h: form === "tank" ? TANK_HEIGHT_M : units * unitM + RACK_BASE_M * 2,
    units,
    unitM,
    look: model?.look ?? FALLBACK_LOOK,
  };
}

function serverModel(catalog: Catalog, id: string | undefined): ServerModel | undefined {
  if (!id || !catalog.has(id)) return undefined;
  const m = catalog.get(id);
  return m.kind === "server" ? m : undefined;
}

/** Units in use and servers in a rack. */
export function rackFill(
  index: BlueprintIndex,
  catalog: Catalog,
  rack: Entity,
  units: number,
): { servers: number; fill: number } {
  const bulk = bulkOf(rack);
  if (bulk) {
    const m = serverModel(catalog, bulk.modelId);
    const used = bulk.servers * (m?.uHeight ?? 1) + 1;
    return { servers: bulk.servers, fill: Math.min(1, used / units) };
  }
  let used = 0;
  let servers = 0;
  for (const child of index.childrenOf(rack.id)) {
    if (child.placement?.type !== "unit") continue;
    const m = child.modelId && catalog.has(child.modelId) ? catalog.get(child.modelId) : undefined;
    used += m && "uHeight" in m ? m.uHeight : 1;
    if (child.kind === "server") servers++;
  }
  return { servers, fill: Math.min(1, used / units) };
}

/** Group racks by model and lay out their instance data. */
export function rackSets(
  index: BlueprintIndex,
  catalog: Catalog,
  places: readonly RackPlace[],
): RackSet[] {
  const groups = new Map<string, { kind: RackKind; items: RackPlace[] }>();
  for (const p of places) {
    const kind = rackKindOf(catalog, p.rack);
    const group = groups.get(kind.key) ?? { kind, items: [] };
    group.items.push(p);
    groups.set(kind.key, group);
  }
  return [...groups.values()].map(({ kind, items }) => {
    const at = new Float32Array(items.length * 4);
    const bulk = new Uint8Array(items.length);
    const servers = new Uint16Array(items.length);
    const fill = new Float32Array(items.length);
    items.forEach((p, i) => {
      const rect = footprint(p.rack, catalog);
      const spot = p.rack.placement?.type === "spot" ? p.rack.placement : undefined;
      at[i * 4] = p.ox + (rect?.x ?? 0) + (rect?.w ?? kind.w) / 2;
      at[i * 4 + 1] = p.oy;
      at[i * 4 + 2] = p.oz + (rect?.y ?? 0) + (rect?.d ?? kind.d) / 2;
      at[i * 4 + 3] = turnOf(spot?.rotation ?? 0);
      const f = rackFill(index, catalog, p.rack, kind.units);
      bulk[i] = bulkOf(p.rack) ? 1 : 0;
      servers[i] = f.servers;
      fill[i] = f.fill;
    });
    return { kind, ids: items.map((p) => p.rack.id), at, bulk, servers, fill };
  });
}
