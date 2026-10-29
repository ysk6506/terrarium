/**
 * Assembling a blueprint from rooms of racks and equipment (ADR-0008). worldgen and realimport both
 * describe *what* is where (hints, rack references); this module decides the geometry: the room layout
 * comes from core.spatial, then rooms are packed onto floors, floors stacked in buildings and buildings
 * packed onto the site. Nothing here knows where the description came from.
 */
import type { Catalog } from "@terrarium/core/catalog";
import {
  deriveRoomLayout,
  type LocationHint,
  packShelves,
  type RoomLayout,
} from "@terrarium/core/spatial";
import {
  BLUEPRINT_SCHEMA_VERSION,
  type Blueprint,
  DEFAULT_FLOOR_HEIGHT_M,
  type Entity,
  type EntityKind,
  type Issue,
  type Link,
  type LinkKind,
  type PropValue,
  type RackMountedKind,
  validateBlueprint,
} from "@terrarium/core/world";

export type Props = Readonly<Record<string, PropValue>>;

export interface RackSpec {
  readonly id: string;
  readonly name: string;
  readonly hint: LocationHint;
  readonly props?: Props;
}

export interface DeviceSpec {
  readonly id: string;
  readonly kind: RackMountedKind;
  readonly name: string;
  readonly modelId: string;
  readonly hint: LocationHint;
  /** Explicit rack (e.g. from a graph edge); wins over the hint's rack reference. */
  readonly rackId?: string;
  readonly props?: Props;
}

export interface EquipmentSpec {
  readonly id: string;
  readonly kind: "cooling_unit" | "power_panel" | "ups";
  readonly name: string;
  readonly modelId: string;
  readonly props?: Props;
}

export interface RoomSpec {
  readonly id: string;
  readonly name: string;
  readonly racks: readonly RackSpec[];
  readonly devices: readonly DeviceSpec[];
  readonly equipment: readonly EquipmentSpec[];
  /** Enclose rack pairs facing a cold aisle (or back to back across a hot aisle). */
  readonly containment?: "cold" | "hot" | "none";
  readonly props?: Props;
}

export interface AssemblyResult {
  readonly blueprint: Blueprint;
  readonly issues: readonly Issue[];
  /** Where geometry or slots had to be guessed, for the import report. */
  readonly notes: readonly string[];
}

const GAP_M = 2;
const BUILDING_MARGIN_M = 3;
const SITE_MARGIN_M = 20;

interface PendingRoom {
  readonly spec: RoomSpec;
  readonly floorId: string;
  readonly layout: RoomLayout;
}

export class BlueprintAssembler {
  private readonly sites: Array<{
    id: string;
    name: string;
    land?: { w: number; d: number };
    props: Props;
  }> = [];
  private readonly buildings: Array<{ id: string; siteId: string; name: string; props: Props }> =
    [];
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

  /** A site; `land` is its size in metres (grown if the buildings do not fit). */
  site(id: string, name: string, land?: { w: number; d: number }, props: Props = {}): this {
    this.sites.push({ id, name, ...(land ? { land } : {}), props });
    return this;
  }

  building(id: string, siteId: string, name: string, props: Props = {}): this {
    this.buildings.push({ id, siteId, name, props });
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
    const layout = deriveRoomLayout(
      spec.racks.map((r) => ({ id: r.id, hint: r.hint })),
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
        })),
      ],
    );
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
      buildingSize.set(building.id, {
        w: Math.max(10, ...sizes.map((s) => s.w)) + 2 * BUILDING_MARGIN_M,
        d: Math.max(10, ...sizes.map((s) => s.d)) + 2 * BUILDING_MARGIN_M,
      });
    }
    entities.push(...this.siteEntities(buildingSize));
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
    const total = rooms.reduce((sum, r) => sum + r.layout.size.w * r.layout.size.d, 0);
    const maxWidth = Math.max(40, Math.sqrt(total) * 1.6);
    const packed = packShelves(
      rooms.map((r) => ({ id: r.spec.id, w: r.layout.size.w, d: r.layout.size.d })),
      maxWidth,
      GAP_M,
    );
    for (const room of rooms) {
      const at = packed.find((p) => p.id === room.spec.id) as (typeof packed)[number];
      out.push(...this.roomEntities(room, at));
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

  private roomEntities(room: PendingRoom, at: { x: number; y: number }): Entity[] {
    const { spec, layout } = room;
    const out: Entity[] = [
      {
        id: spec.id,
        kind: "room",
        name: spec.name,
        parentId: room.floorId,
        placement: { type: "area", x: at.x, y: at.y, w: layout.size.w, d: layout.size.d },
        props: spec.props ?? {},
      },
    ];
    const containerOf = this.containments(room, out);
    out.push(
      ...rackEntities(room, containerOf),
      ...deviceEntities(room),
      ...equipmentEntities(room),
    );
    return out;
  }

  /**
   * Containments enclose pairs of rack rows: rows 1+2, 3+4 ... face each other across a cold aisle;
   * rows 2+3, 4+5 ... stand back to back across a hot aisle. Returns rack id → containment id.
   */
  private containments(room: PendingRoom, out: Entity[]): Map<string, string> {
    const mode = room.spec.containment ?? "none";
    const owner = new Map<string, string>();
    if (mode === "none") return owner;
    const rows = [...new Set([...room.layout.racks.values()].map((p) => p.row))].sort(
      (a, b) => a - b,
    );
    const first = mode === "cold" ? 0 : 1;
    for (let i = first; i + 1 < rows.length; i += 2) {
      const pair = new Set([rows[i], rows[i + 1]]);
      const racks = [...room.layout.racks].filter(([, p]) => pair.has(p.row));
      const xs = racks.map(([, p]) => p.x);
      const ys = racks.map(([, p]) => p.y);
      const n = Math.floor(i / 2) + 1;
      const id = `${room.spec.id}-${mode === "cold" ? "ca" : "ha"}${n}`;
      out.push({
        id,
        kind: "containment",
        name: `${room.spec.name} ${mode === "cold" ? "냉복도" : "열복도"} ${n}`,
        parentId: room.spec.id,
        placement: {
          type: "area",
          x: Math.min(...xs) - 0.1,
          y: Math.min(...ys) - 0.1,
          w: Math.max(...xs) - Math.min(...xs) + 0.8,
          d: Math.max(...ys) - Math.min(...ys) + 1.4,
        },
        props: { aisle: mode },
      });
      for (const [rackId] of racks) owner.set(rackId, id);
    }
    return owner;
  }

  private siteEntities(buildingSize: ReadonlyMap<string, { w: number; d: number }>): Entity[] {
    const out: Entity[] = [];
    for (const site of this.sites) {
      const buildings = this.buildings.filter((b) => b.siteId === site.id);
      const want = site.land?.w ?? 200;
      const packed = packShelves(
        buildings.map((b) => ({
          id: b.id,
          ...(buildingSize.get(b.id) as { w: number; d: number }),
        })),
        Math.max(want - SITE_MARGIN_M, 50),
        SITE_MARGIN_M,
      );
      const usedW = Math.max(0, ...packed.map((p) => p.x + p.w)) + SITE_MARGIN_M;
      const usedD = Math.max(0, ...packed.map((p) => p.y + p.d)) + SITE_MARGIN_M;
      const land = { w: Math.max(site.land?.w ?? 0, usedW), d: Math.max(site.land?.d ?? 0, usedD) };
      if (site.land && (land.w > site.land.w || land.d > site.land.d))
        this.notes.push(
          `${site.name}: 건물이 부지에 다 들어가지 않아 부지를 ${Math.round(land.w)}×${Math.round(land.d)} m로 넓혔다`,
        );
      out.push({
        id: site.id,
        kind: "site",
        name: site.name,
        placement: { type: "land", ...land },
        props: site.props,
      });
      for (const b of buildings) {
        const p = packed.find((x) => x.id === b.id) as (typeof packed)[number];
        out.push({
          id: b.id,
          kind: "building",
          name: b.name,
          parentId: site.id,
          placement: { type: "area", x: p.x, y: p.y, w: p.w, d: p.d },
          props: b.props,
        });
      }
    }
    return out;
  }
}

const inferred = (yes: boolean): Props => (yes ? { positionInferred: true } : {});

function rackEntities(room: PendingRoom, containerOf: ReadonlyMap<string, string>): Entity[] {
  return room.spec.racks.flatMap((rack) => {
    const p = room.layout.racks.get(rack.id);
    if (!p) return [];
    return [
      {
        id: rack.id,
        kind: "rack" as const,
        name: rack.name,
        parentId: containerOf.get(rack.id) ?? room.spec.id,
        placement: { type: "spot" as const, x: p.x, y: p.y, rotation: p.rotation },
        props: { ...(rack.props ?? {}), ...inferred(p.inferred) },
      },
    ];
  });
}

function deviceEntities(room: PendingRoom): Entity[] {
  return room.spec.devices.flatMap((device) => {
    const p = room.layout.devices.get(device.id);
    if (!p) return [];
    return [
      {
        id: device.id,
        kind: device.kind,
        name: device.name,
        parentId: p.rackId,
        modelId: device.modelId,
        placement: { type: "unit" as const, u: p.u },
        props: { ...(device.props ?? {}), ...inferred(p.inferred) },
      },
    ];
  });
}

function equipmentEntities(room: PendingRoom): Entity[] {
  return room.spec.equipment.map((eq) => {
    const p = room.layout.equipment.get(eq.id) ?? { x: 1, y: 1 };
    return {
      id: eq.id,
      kind: eq.kind,
      name: eq.name,
      parentId: room.spec.id,
      modelId: eq.modelId,
      placement: { type: "spot" as const, x: p.x, y: p.y, rotation: 0 as const },
      props: eq.props ?? {},
    };
  });
}
