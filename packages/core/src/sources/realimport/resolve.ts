/**
 * Step 2 of an import: where everything is and what it is. Rooms, racks and devices are placed from
 * graph relationships first and location properties second (core.spatial reads the many formats);
 * whatever has neither goes to an "미배치" (unplaced) rack, and every such guess is counted.
 */
import type { Catalog } from "@terrarium/core/catalog";
import { slug } from "@terrarium/core/kernel";
import type { DeviceSpec, EquipmentSpec, RackSpec } from "@terrarium/core/sources";
import {
  extractHint,
  type FloorInfo,
  floorLevel,
  type LocationHint,
  roomKey,
} from "@terrarium/core/spatial";
import type { EntityKind, LinkKind, PropValue } from "@terrarium/core/world";
import { type Classification, type Classified, firstString, type Relation } from "./classify";
import type { KgMapping, RelationMeaning } from "./mapping";

export interface PlannedRoom {
  readonly id: string;
  readonly name: string;
  readonly floorKey: string;
  readonly racks: RackSpec[];
  readonly devices: DeviceSpec[];
  readonly equipment: EquipmentSpec[];
}

export interface PlannedFloor {
  readonly id: string;
  readonly buildingId: string;
  readonly name: string;
  readonly level: number;
}

export interface PlannedLink {
  readonly kind: LinkKind;
  readonly from: string;
  readonly to: string;
  readonly props: Readonly<Record<string, PropValue>>;
}

export interface Plan {
  readonly siteName: string;
  readonly buildings: Map<string, string>;
  readonly floors: Map<string, PlannedFloor>;
  readonly rooms: Map<string, PlannedRoom>;
  readonly virtual: Array<{
    id: string;
    kind: EntityKind;
    name: string;
    props: Record<string, PropValue>;
  }>;
  readonly links: PlannedLink[];
  /** Entity id → kind, for everything planned. */
  readonly kinds: Map<string, EntityKind>;
  readonly counts: {
    hypervisorsMerged: number;
    hypervisorsAlone: number;
    unplacedRacks: number;
    unplacedDevices: number;
    modelsGuessed: number;
    networkLinks: number;
  };
}

const PREFIX: Partial<Record<EntityKind, string>> = {
  server: "srv",
  storage: "stor",
  switch: "sw",
  rack: "rack",
  room: "room",
  building: "bldg",
  cooling_unit: "hvac",
  vm: "vm",
  cluster: "cl",
  vcenter: "vc",
  datastore: "ds",
};

const SPINE_TIERS = new Set(["SPINE", "SUPER_SPINE", "SUBCORE", "BORDER_LEAF", "CORE"]);
const MGMT_TIERS = new Set(["MANAGEMENT", "OOB", "OOB-MGMT"]);
const UNPLACED_PER_RACK = 16;

/** Plain scalar properties worth keeping, plus where the record came from. */
function keptProps(c: Classified): Record<string, PropValue> {
  const out: Record<string, PropValue> = {
    sourceId: c.node.id,
    sourceLabel: c.node.labels[0] ?? "",
  };
  for (const [k, v] of Object.entries(c.node.props))
    if (
      (typeof v === "string" && v.length <= 200) ||
      typeof v === "number" ||
      typeof v === "boolean"
    )
      out[k] = v;
  return out;
}

class Planner {
  readonly plan: Plan;
  private readonly ids = new Map<string, string>();
  private readonly used = new Set<string>();
  private readonly roomIds = new Map<string, string>();
  private readonly byMeaning = new Map<RelationMeaning, Relation[]>();
  private readonly hostOf = new Map<string, string>();

  constructor(
    private readonly c: Classification,
    private readonly mapping: KgMapping,
    private readonly catalog: Catalog,
    siteName: string,
  ) {
    this.plan = {
      siteName,
      buildings: new Map(),
      floors: new Map(),
      rooms: new Map(),
      virtual: [],
      links: [],
      kinds: new Map(),
      counts: {
        hypervisorsMerged: 0,
        hypervisorsAlone: 0,
        unplacedRacks: 0,
        unplacedDevices: 0,
        modelsGuessed: 0,
        networkLinks: 0,
      },
    };
    for (const r of c.relations)
      this.byMeaning.set(r.means, [...(this.byMeaning.get(r.means) ?? []), r]);
    for (const r of this.rels("hosted_on")) this.hostOf.set(r.from, r.to);
  }

  nodeOf(nodeId: string): Classified | undefined {
    return this.c.nodes.get(nodeId);
  }

  get keys(): KgMapping["keys"] {
    return this.mapping.keys;
  }

  rels(means: RelationMeaning): Relation[] {
    return this.byMeaning.get(means) ?? [];
  }

  /** A hypervisor stands for the physical server it runs on. */
  canon(nodeId: string): string {
    return this.hostOf.get(nodeId) ?? nodeId;
  }

  /** The entity id of a node (after merging hypervisors), if it became an entity. */
  entityOf(nodeId: string): string | undefined {
    return this.ids.get(this.canon(nodeId));
  }

  /** A readable, unique id from the kind and the record's name. */
  newId(nodeId: string, kind: EntityKind, name: string): string {
    const base = `${PREFIX[kind] ?? kind}-${slug(name).toLowerCase()}`.slice(0, 90);
    let id = base;
    for (let n = 2; this.used.has(id); n++) id = `${base}-${n}`;
    this.used.add(id);
    this.ids.set(nodeId, id);
    this.plan.kinds.set(id, kind);
    return id;
  }

  ofRole(...roles: string[]): Classified[] {
    return [...this.c.nodes.values()].filter((n) => roles.includes(n.role));
  }

  /** Register an entity under an id chosen by the caller (made unique if taken). */
  exactId(key: string, kind: EntityKind, wanted: string): string {
    let id = wanted;
    for (let n = 2; this.used.has(id); n++) id = `${wanted}-${n}`;
    this.used.add(id);
    this.ids.set(key, id);
    this.plan.kinds.set(id, kind);
    return id;
  }

  /** The room a location points at, creating rooms (and floors, buildings) as needed. */
  roomFor(info: FloorInfo, preferredName?: string, buildingName?: string): PlannedRoom {
    const key = roomKey(info);
    const known = this.plan.rooms.get(this.roomIds.get(key) ?? "");
    if (known) return known;
    const building = buildingName ?? info.building ?? "미분류 건물";
    const buildingId = this.buildingId(building);
    const floorName = info.floor ?? "1F";
    const floorKey = `${buildingId}>${floorName}`;
    if (!this.plan.floors.has(floorKey))
      this.plan.floors.set(floorKey, {
        id: `${buildingId}-f-${slug(floorName).toLowerCase()}`,
        buildingId,
        name: floorName,
        level: floorLevel(floorName),
      });
    const name = preferredName ?? info.room ?? "미분류 서버룸";
    const room: PlannedRoom = {
      id: this.newId(`room:${key}`, "room", `${building}-${floorName}-${name}`),
      name,
      floorKey,
      racks: [],
      devices: [],
      equipment: [],
    };
    this.roomIds.set(key, room.id);
    this.plan.rooms.set(room.id, room);
    return room;
  }

  private buildingId(name: string): string {
    const existing = [...this.plan.buildings].find(([, n]) => n === name)?.[0];
    if (existing) return existing;
    const id = this.newId(`building:${name}`, "building", name);
    this.plan.buildings.set(id, name);
    return id;
  }

  link(
    kind: LinkKind,
    fromNode: string,
    toNode: string,
    props: Record<string, PropValue> = {},
  ): void {
    const from = this.entityOf(fromNode);
    const to = this.entityOf(toNode);
    if (from && to && from !== to) this.plan.links.push({ kind, from, to, props });
  }

  hint(c: Classified, kind: "rack" | "device"): LocationHint {
    return extractHint(c.node.props, kind);
  }

  modelFor(c: Classified, kind: DeviceKind | "cooling_unit"): string {
    const stated = firstString(c.node.props, this.mapping.keys.model);
    if (kind === "switch")
      return switchModel(firstString(c.node.props, this.mapping.keys.switchTier));
    if (kind === "cooling_unit") return coolingModel(stated ?? String(c.node.props.type ?? ""));
    const { model, guessed } = this.catalog.resolve(kind, stated);
    if (!guessed) return model.id;
    this.plan.counts.modelsGuessed++;
    return kind === "storage" ? "stor-2u-24bay" : serverBySpan(this.hint(c, "device").unitSpan);
  }
}

type DeviceKind = "server" | "storage" | "switch";

function switchModel(tier: string | undefined): string {
  const t = (tier ?? "").toUpperCase();
  if (SPINE_TIERS.has(t)) return "sw-spine-32x100g";
  return MGMT_TIERS.has(t) ? "sw-mgmt-48x1g" : "sw-tor-48x25g";
}

const coolingModel = (text: string) => (/in-?row/i.test(text) ? "inrow-30kw" : "crah-100kw");

/** A server of unknown model, judged by how many units it takes. */
function serverBySpan(span: number): string {
  if (span >= 4) return "srv-4u-gpu";
  return span === 1 ? "srv-1u-compute" : "srv-2u-compute";
}

function roomInfo(p: Planner, c: Classified): FloorInfo {
  const parsed = p.hint(c, "rack").floorInfo;
  const props = c.node.props;
  const str = (k: string) => (typeof props[k] === "string" ? (props[k] as string) : undefined);
  return {
    ...((parsed.site ?? str("site")) ? { site: parsed.site ?? str("site") } : {}),
    ...((parsed.building ?? str("building"))
      ? { building: parsed.building ?? str("building") }
      : {}),
    ...((parsed.floor ?? str("floor")) ? { floor: parsed.floor ?? str("floor") } : {}),
    room: parsed.room ?? str("room") ?? c.name,
  };
}

function placeRooms(p: Planner): Map<string, PlannedRoom> {
  const byNode = new Map<string, PlannedRoom>();
  const buildingOfRoom = new Map(p.rels("located_in").map((r) => [r.from, r.to]));
  for (const c of p.ofRole("room")) {
    const building = p.ofRole("building").find((b) => b.node.id === buildingOfRoom.get(c.node.id));
    byNode.set(c.node.id, p.roomFor(roomInfo(p, c), c.name, building?.name));
  }
  return byNode;
}

/** Room of a record: an explicit relationship, else its location properties, else unplaced. */
function locate(p: Planner, c: Classified, roomsByNode: Map<string, PlannedRoom>): PlannedRoom {
  const rel = p.rels("located_in").find((r) => r.from === c.node.id && roomsByNode.has(r.to));
  if (rel) return roomsByNode.get(rel.to) as PlannedRoom;
  const info = p.hint(c, "rack").floorInfo;
  return p.roomFor(info.room || info.floor ? info : {});
}

function placeRacks(
  p: Planner,
  roomsByNode: Map<string, PlannedRoom>,
): Map<string, { room: PlannedRoom; id: string }> {
  const racks = new Map<string, { room: PlannedRoom; id: string }>();
  for (const c of p.ofRole("rack")) {
    const room = locate(p, c, roomsByNode);
    const id = p.newId(c.node.id, "rack", c.name);
    room.racks.push({ id, name: c.name, hint: p.hint(c, "rack"), props: keptProps(c) });
    racks.set(c.node.id, { room, id });
  }
  return racks;
}

const DEVICE_KIND: Readonly<Record<string, DeviceKind>> = {
  server: "server",
  storage: "storage",
  switch: "switch",
  hypervisor: "server",
};

function unplacedRack(p: Planner, room: PlannedRoom): string {
  const open = room.racks.filter((r) => r.props?.unplaced === true);
  const last = open.at(-1);
  if (last && room.devices.filter((d) => d.rackId === last.id).length < UNPLACED_PER_RACK)
    return last.id;
  const n = open.length + 1;
  const id = p.exactId(`unplaced:${room.id}:${n}`, "rack", `${room.id}-unplaced-${n}`);
  room.racks.push({
    id,
    name: `미배치 ${n}`,
    hint: { floorInfo: {}, unitSpan: 1 },
    props: { unplaced: true },
  });
  p.plan.counts.unplacedRacks++;
  return id;
}

function placeDevices(
  p: Planner,
  roomsByNode: Map<string, PlannedRoom>,
  racks: Map<string, { room: PlannedRoom; id: string }>,
): void {
  const rackByName = new Map(
    [...p.ofRole("rack")].map((c) => [c.name.toLowerCase(), racks.get(c.node.id)]),
  );
  const inRack = new Map(
    p
      .rels("located_in")
      .filter((r) => racks.has(r.to))
      .map((r) => [r.from, r.to]),
  );
  const alone = p.ofRole("hypervisor").filter((h) => p.canon(h.node.id) === h.node.id);
  p.plan.counts.hypervisorsAlone = alone.length;
  p.plan.counts.hypervisorsMerged = p.ofRole("hypervisor").length - alone.length;
  for (const c of [...p.ofRole("server", "storage", "switch"), ...alone]) {
    const kind = DEVICE_KIND[c.role] as DeviceKind;
    const hint = p.hint(c, "device");
    const rack =
      racks.get(inRack.get(c.node.id) ?? "") ?? rackByName.get((hint.rackRef ?? "").toLowerCase());
    const room = rack?.room ?? locate(p, c, roomsByNode);
    const rackId = rack?.id ?? unplacedRack(p, room);
    if (!rack) p.plan.counts.unplacedDevices++;
    const id = p.newId(c.node.id, kind, c.name);
    const esxi = p
      .ofRole("hypervisor")
      .find((h) => p.canon(h.node.id) === c.node.id && h.node.id !== c.node.id);
    room.devices.push({
      id,
      kind,
      name: c.name,
      modelId: p.modelFor(c, kind),
      hint,
      rackId,
      props: { ...keptProps(c), ...(esxi ? { esxiName: esxi.name } : {}) },
    });
  }
}

function placeCooling(
  p: Planner,
  roomsByNode: Map<string, PlannedRoom>,
  racks: Map<string, { room: PlannedRoom; id: string }>,
): void {
  for (const c of p.ofRole("cooling_unit")) {
    const viaRacks = p
      .rels("cooling")
      .filter((r) => r.to === c.node.id)
      .map((r) => racks.get(r.from)?.room)
      .filter((r) => r !== undefined);
    const explicit = p
      .rels("located_in")
      .some((r) => r.from === c.node.id && roomsByNode.has(r.to));
    const room =
      explicit || viaRacks.length === 0 ? locate(p, c, roomsByNode) : (viaRacks[0] as PlannedRoom);
    room.equipment.push({
      id: p.newId(c.node.id, "cooling_unit", c.name),
      kind: "cooling_unit",
      name: c.name,
      modelId: p.modelFor(c, "cooling_unit"),
      props: keptProps(c),
    });
  }
}

function virtualEntities(p: Planner): void {
  for (const c of p.ofRole("vcenter", "cluster", "vm", "datastore")) {
    const kind = c.role as EntityKind;
    p.plan.virtual.push({
      id: p.newId(c.node.id, kind, c.name),
      kind,
      name: c.name,
      props: keptProps(c),
    });
  }
}

const SIMPLE: ReadonlyArray<readonly [RelationMeaning, LinkKind]> = [
  ["runs_on", "runs_on"],
  ["member_of", "member_of"],
  ["managed_by", "managed_by"],
  ["stored_on", "stored_on"],
  ["cooling", "cooling"],
  ["network", "network"],
];

function links(p: Planner): void {
  for (const [means, kind] of SIMPLE)
    for (const r of p.rels(means)) p.link(kind, r.from, r.to, scalarProps(r.props));
  const owner = new Map(p.rels("port_owner").map((r) => [r.from, r.to]));
  for (const r of p.rels("uses_interface")) if (!owner.has(r.to)) owner.set(r.to, r.from);
  const portName = (id: string) => firstString(p.nodeOf(id)?.node.props ?? {}, p.keys.port) ?? id;
  for (const wire of p.rels("wire")) {
    const from = owner.get(wire.from);
    const to = owner.get(wire.to);
    if (from && to)
      p.link("network", from, to, { fromPort: portName(wire.from), toPort: portName(wire.to) });
  }
  const provider = new Map(p.rels("provides_volume").map((r) => [r.to, r.from]));
  for (const r of p.rels("volume_backs")) {
    const storage = provider.get(r.from);
    if (storage) p.link("backed_by", r.to, storage);
  }
  p.plan.counts.networkLinks = p.plan.links.filter((l) => l.kind === "network").length;
}

function scalarProps(props: Readonly<Record<string, unknown>>): Record<string, PropValue> {
  const out: Record<string, PropValue> = {};
  for (const [k, v] of Object.entries(props))
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
  return out;
}

export function resolve(
  c: Classification,
  mapping: KgMapping,
  catalog: Catalog,
  siteName: string,
): Plan {
  const p = new Planner(c, mapping, catalog, siteName);
  const roomsByNode = placeRooms(p);
  const racks = placeRacks(p, roomsByNode);
  placeDevices(p, roomsByNode, racks);
  placeCooling(p, roomsByNode, racks);
  virtualEntities(p);
  links(p);
  return p.plan;
}
