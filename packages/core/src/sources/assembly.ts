/**
 * Assembling a blueprint from rooms of racks and equipment (ADR-0008). worldgen
 * describes *what* is where (hints, rack references); this module decides the geometry: the room layout
 * comes from core.spatial, then rooms are packed onto floors, floors stacked in buildings and buildings
 * packed onto the site. Nothing here knows where the description came from.
 */
import type { Catalog } from "@terrarium/core/catalog";
import {
  deriveRoomLayout,
  type Outline,
  packShelves,
  type ReservedPlot,
  type RoomLayout,
} from "@terrarium/core/spatial";
import {
  BLUEPRINT_SCHEMA_VERSION,
  type Blueprint,
  DEFAULT_FLOOR_HEIGHT_M,
  type Entity,
  type EntityKind,
  type Link,
  type LinkKind,
  validateBlueprint,
} from "@terrarium/core/world";
import { type PendingRoom, roomEntities } from "./assembly-room";
import { type BuildingPlan, type SitePlan, siteEntities, type YardEntry } from "./assembly-site";
import type { AssemblyResult, EquipmentSpec, Props, RoomSpec, YardSpec } from "./assembly-types";

export type {
  AssemblyResult,
  DeviceSpec,
  EquipmentSpec,
  PodSpec,
  Props,
  RackSpec,
  RoomSpec,
  YardSpec,
} from "./assembly-types";

const GAP_M = 2;
const BUILDING_MARGIN_M = 3;

export class BlueprintAssembler {
  private readonly sites: SitePlan[] = [];
  private readonly buildings: BuildingPlan[] = [];
  private readonly yard: YardEntry[] = [];
  private readonly floors: Array<{
    id: string;
    buildingId: string;
    name: string;
    level: number;
    props: Props;
  }> = [];
  private readonly rooms: PendingRoom[] = [];
  private readonly floorEquipment: Array<{ floorId: string; spec: EquipmentSpec }> = [];
  private readonly loose: Entity[] = [];
  private readonly links: Link[] = [];
  private readonly linkIds = new Set<string>();
  private readonly notes: string[] = [];

  constructor(
    private readonly id: string,
    private readonly name: string,
    private readonly catalog: Catalog,
    private readonly meta: Props = {},
  ) {}

  /**
   * A site; `land` is its size in metres (grown if the buildings do not fit). With `parcels`, the land
   * in use is the owner's and the rest of `land` is divided into parcels that could be bought. With
   * an `outline` (metres, from (0, 0)) the land has that shape and buildings are placed inside it.
   */
  site(
    id: string,
    name: string,
    land?: { w: number; d: number },
    props: Props = {},
    parcels = false,
    outline?: Outline,
  ): this {
    this.sites.push({
      id,
      name,
      ...(land ? { land } : {}),
      props,
      parcels,
      ...(outline ? { outline } : {}),
    });
    return this;
  }

  /**
   * Ground a map shows a building on that this world does not build. Other buildings and plant keep
   * off it, and the site keeps the list so what is drawn around the buildings can leave it alone.
   */
  reserve(siteId: string, plots: readonly ReservedPlot[]): this {
    const i = this.sites.findIndex((s) => s.id === siteId);
    const site = this.sites[i];
    if (site && plots.length > 0) this.sites[i] = { ...site, reserved: plots };
    return this;
  }

  /**
   * Plant standing on the site grounds (generators, chillers, transformers), grouped into yards.
   * With `building`, it stands beside that building.
   */
  yardItem(siteId: string, group: string, spec: YardSpec, building?: string): this {
    this.yard.push({ siteId, group, spec, ...(building ? { building } : {}) });
    return this;
  }

  /**
   * A building. With `at` (its centre in the site's frame, where a map shows it standing) it is put
   * there if the land and its neighbours allow; without, or when they do not, it is placed by the layout.
   */
  building(
    id: string,
    siteId: string,
    name: string,
    props: Props = {},
    at?: { readonly x: number; readonly y: number },
    size?: { readonly w: number; readonly d: number },
  ): this {
    this.buildings.push({
      id,
      siteId,
      name,
      props,
      ...(at ? { at: { x: at.x, y: at.y } } : {}),
      ...(size ? { size } : {}),
    });
    return this;
  }

  /** A floor; level 1 is the ground floor, negative levels are basements. */
  floor(id: string, buildingId: string, name: string, level: number, props: Props = {}): this {
    this.floors.push({ id, buildingId, name, level, props });
    return this;
  }

  /** A room on a floor; its layout is derived now, its position on the floor at build time. */
  room(floorId: string, spec: RoomSpec): this {
    const heights = new Map(spec.devices.map((d) => [d.id, this.heightOf(d.modelId)]));
    const derived = deriveRoomLayout(
      spec.racks.map((r) => ({
        id: r.id,
        hint: r.hint,
        ...(r.at ? { at: r.at } : {}),
        ...(r.modelId ? this.rackShape(r.modelId) : {}),
      })),
      [
        ...spec.devices.map((d) => ({
          id: d.id,
          hint: d.hint,
          heightU: heights.get(d.id) ?? 1,
          ...(d.rackId ? { rackId: d.rackId } : {}),
        })),
        ...spec.equipment.map((e) => ({
          id: e.id,
          hint: { floorInfo: {}, unitSpan: 1 },
          heightU: 1,
          footprint: this.footprintOf(e.modelId),
          ...(e.at ? { at: e.at } : {}),
        })),
      ],
    );
    const layout: RoomLayout = spec.size
      ? {
          ...derived,
          size: {
            w: Math.max(derived.size.w, spec.size.w),
            d: Math.max(derived.size.d, spec.size.d),
          },
        }
      : derived;
    this.notes.push(...layout.notes.map((n) => `${spec.name}: ${n}`));
    this.rooms.push({ spec, floorId, layout });
    return this;
  }

  /** Equipment standing on a floor outside the rooms (UPS and panels in an electrical room). */
  floorItem(floorId: string, spec: EquipmentSpec): this {
    this.floorEquipment.push({ floorId, spec });
    return this;
  }

  /** An entity with no physical place (vCenter, cluster, VM, datastore). */
  virtual(id: string, kind: EntityKind, name: string, props: Props = {}): this {
    this.loose.push({ id, kind, name, props });
    return this;
  }

  /** A dependency link: `from` depends on `to`. Duplicates are ignored. */
  link(kind: LinkKind, from: string, to: string, props: Props = {}): this {
    const key = `${kind}:${from}>${to}`;
    if (this.linkIds.has(key)) return this;
    this.linkIds.add(key);
    this.links.push({ id: `l-${kind}-${from}-${to}`, kind, from, to, props });
    return this;
  }

  build(): AssemblyResult {
    const entities: Entity[] = [];
    const footprints = new Map<string, { w: number; d: number }>();
    for (const floor of this.floors) {
      const rooms = this.rooms.filter((r) => r.floorId === floor.id);
      const used = this.placeRooms(rooms, entities);
      footprints.set(floor.id, this.placeFloorEquipment(floor.id, used, entities));
    }
    const buildingSize = new Map<string, { w: number; d: number }>();
    for (const building of this.buildings) {
      const sizes = this.floors
        .filter((f) => f.buildingId === building.id)
        .map((f) => footprints.get(f.id) ?? { w: 10, d: 10 });
      buildingSize.set(
        building.id,
        building.size ?? {
          w: Math.max(10, ...sizes.map((s) => s.w)) + 2 * BUILDING_MARGIN_M,
          d: Math.max(10, ...sizes.map((s) => s.d)) + 2 * BUILDING_MARGIN_M,
        },
      );
    }
    entities.push(
      ...siteEntities(
        this.catalog,
        this.sites,
        this.buildings,
        buildingSize,
        this.yard,
        this.notes,
      ),
    );
    entities.push(...this.floors.map((f) => this.floorEntity(f)));
    entities.push(...this.loose);
    const blueprint: Blueprint = {
      schemaVersion: BLUEPRINT_SCHEMA_VERSION,
      id: this.id,
      name: this.name,
      entities: entities.sort((a, b) => a.id.localeCompare(b.id)),
      links: [...this.links].sort((a, b) => a.id.localeCompare(b.id)),
      meta: this.meta,
    };
    return { blueprint, issues: validateBlueprint(blueprint, this.catalog), notes: this.notes };
  }

  private footprintOf(modelId: string): { w: number; d: number } {
    const model = this.catalog.get(modelId);
    return "footprint" in model ? model.footprint : { w: 1, d: 1 };
  }

  /** Floor size and units of a rack model, for the room layout. */
  private rackShape(modelId: string): { size?: { w: number; d: number }; units?: number } {
    const model = this.catalog.get(modelId);
    if (model.kind !== "rack") return {};
    return { size: model.footprint, units: model.uHeight };
  }

  private heightOf(modelId: string): number {
    const model = this.catalog.get(modelId);
    return "uHeight" in model ? model.uHeight : 1;
  }

  private floorEntity(f: (typeof this.floors)[number]): Entity {
    return {
      id: f.id,
      kind: "floor",
      name: f.name,
      parentId: f.buildingId,
      placement: { type: "level", level: f.level, height: DEFAULT_FLOOR_HEIGHT_M },
      props: f.props,
    };
  }

  /** Pack a floor's rooms in a row of shelves; returns the floor's used footprint. */
  private placeRooms(rooms: readonly PendingRoom[], out: Entity[]): { w: number; d: number } {
    // Rooms that all say where they stand are put there; a floor of real size has a plan, not a packing.
    if (rooms.length > 0 && rooms.every((r) => r.spec.at)) {
      let w = 0;
      let d = 0;
      for (const room of rooms) {
        const at = room.spec.at as { x: number; y: number };
        out.push(...roomEntities(this.catalog, room, at));
        w = Math.max(w, at.x + room.layout.size.w);
        d = Math.max(d, at.y + room.layout.size.d);
      }
      return { w, d };
    }
    const total = rooms.reduce((sum, r) => sum + r.layout.size.w * r.layout.size.d, 0);
    const maxWidth = Math.max(40, Math.sqrt(total) * 1.6);
    const packed = packShelves(
      rooms.map((r) => ({ id: r.spec.id, w: r.layout.size.w, d: r.layout.size.d })),
      maxWidth,
      GAP_M,
    );
    for (const room of rooms) {
      const at = packed.find((p) => p.id === room.spec.id) as (typeof packed)[number];
      out.push(...roomEntities(this.catalog, room, at));
    }
    return {
      w: Math.max(0, ...packed.map((p) => p.x + p.w)) + GAP_M,
      d: Math.max(0, ...packed.map((p) => p.y + p.d)) + GAP_M,
    };
  }

  /** Floor equipment stands in a strip in front of the rooms; returns the grown footprint. */
  private placeFloorEquipment(
    floorId: string,
    used: { w: number; d: number },
    out: Entity[],
  ): { w: number; d: number } {
    const items = this.floorEquipment.filter((e) => e.floorId === floorId).map((e) => e.spec);
    if (items.length === 0) return used;
    let x = GAP_M;
    let depth = 0;
    for (const item of items) {
      const model = this.catalog.get(item.modelId);
      const size = "footprint" in model ? model.footprint : { w: 1, d: 1 };
      out.push({
        id: item.id,
        kind: item.kind,
        name: item.name,
        parentId: floorId,
        modelId: item.modelId,
        placement: { type: "spot", x, y: used.d, rotation: 0 },
        props: item.props ?? {},
      });
      x += size.w + GAP_M;
      depth = Math.max(depth, size.d);
    }
    return { w: Math.max(used.w, x), d: used.d + depth + GAP_M };
  }
}
