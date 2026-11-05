/**
 * A made-up campus that is big enough to fold and cheap to build: buildings > floors > rooms > racks > servers, two
 * cooling units per room on two chillers per building, a PDU per rack on a panel per room on a UPS per building on a
 * transfer switch with a generator, a ToR per room under a spine per building under one core. It is not checked
 * against the catalog (the board reads the structure and the states, not the models), so a test can make thousands of
 * racks in a few milliseconds and put faults and alarms wherever it wants.
 */
import { Catalog } from "@terrarium/core/catalog";
import {
  type Alarm,
  type Blueprint,
  BlueprintIndex,
  type Entity,
  type EntityKind,
  type EntityState,
  type Fault,
  initialState,
  type Link,
  type LinkKind,
} from "@terrarium/core/world";
import type { Earlier, TopologySource } from "../types";

export interface GridSpec {
  readonly buildings: number;
  readonly floors: number;
  readonly rooms: number;
  readonly racks: number;
  readonly servers: number;
}

export interface Extras {
  readonly faults?: readonly Fault[];
  readonly alarms?: readonly Alarm[];
  readonly touched?: ReadonlySet<string>;
  readonly earlier?: Earlier;
  /** States to put over the initial ones. */
  readonly states?: Readonly<Record<string, Partial<EntityState>>>;
}

const catalog = new Catalog();

export function gridBlueprint(spec: GridSpec): Blueprint {
  const entities: Entity[] = [];
  const links: Link[] = [];
  const add = (id: string, kind: EntityKind, parentId?: string) =>
    entities.push({ id, kind, name: id, ...(parentId ? { parentId } : {}), props: {} });
  const link = (kind: LinkKind, from: string, to: string) =>
    links.push({ id: `${kind}:${from}>${to}`, kind, from, to, props: {} });
  add("site", "site");
  add("gen", "generator", "site");
  add("feed", "power_panel", "site");
  link("power", "feed", "gen");
  for (let b = 0; b < spec.buildings; b++) buildingOf(b, spec, add, link);
  return { schemaVersion: 1, id: "grid", name: "grid", entities, links, meta: {} };
}

type Add = (id: string, kind: EntityKind, parentId?: string) => void;
type Linker = (kind: LinkKind, from: string, to: string) => void;

function buildingOf(b: number, spec: GridSpec, add: Add, link: Linker): void {
  const bid = `b${b}`;
  add(bid, "building", "site");
  for (const n of [1, 2]) add(`${bid}-ch${n}`, "chiller", "site");
  add(`${bid}-ups`, "ups", "site");
  link("power", `${bid}-ups`, "feed");
  for (let f = 0; f < spec.floors; f++) {
    const fid = `${bid}f${f}`;
    add(fid, "floor", bid);
    for (let r = 0; r < spec.rooms; r++) roomOf(`${fid}r${r}`, fid, bid, spec, add, link);
  }
  add(`${bid}-spine`, "switch", `${bid}f0r0-k0`);
  link("network", `${bid}-spine`, "core");
  if (b === 0) add("core", "switch", `${bid}f0r0-k0`);
}

function roomOf(
  rid: string,
  floor: string,
  bid: string,
  spec: GridSpec,
  add: Add,
  link: Linker,
): void {
  add(rid, "room", floor);
  add(`${rid}-ca`, "containment", rid);
  add(`${rid}-panel`, "power_panel", rid);
  link("power", `${rid}-panel`, `${bid}-ups`);
  add(`${rid}-tor`, "switch", `${rid}-k0`);
  link("network", `${rid}-tor`, `${bid}-spine`);
  for (const n of [1, 2]) {
    add(`${rid}-u${n}`, "cooling_unit", rid);
    for (const c of [1, 2]) link("cooling", `${rid}-u${n}`, `${bid}-ch${c}`);
  }
  for (let k = 0; k < spec.racks; k++) rackOf(`${rid}-k${k}`, rid, spec, add, link);
}

function rackOf(kid: string, rid: string, spec: GridSpec, add: Add, link: Linker): void {
  add(kid, "rack", `${rid}-ca`);
  for (const n of [1, 2]) link("cooling", kid, `${rid}-u${n}`);
  add(`${kid}-pdu`, "pdu", kid);
  link("power", `${kid}-pdu`, `${rid}-panel`);
  for (let s = 0; s < spec.servers; s++) {
    const sid = `${kid}s${s}`;
    add(sid, "server", kid);
    link("power", sid, `${kid}-pdu`);
    link("network", sid, `${rid}-tor`);
  }
}

/** A grid as a source of a world: states as they start, with the faults, alarms and states a test puts on it. */
export function gridWorld(
  spec: GridSpec,
  extras: Extras = {},
): TopologySource & { blueprint: Blueprint } {
  const blueprint = gridBlueprint(spec);
  const index = new BlueprintIndex(blueprint);
  const state = initialState(index, catalog);
  for (const [id, patch] of Object.entries(extras.states ?? {}))
    Object.assign(state.entities[id] as object, patch);
  return {
    blueprint,
    index,
    time: () => 600,
    stateOf: (id) => state.entities[id] as EntityState,
    faults: () => extras.faults ?? [],
    alarms: () => extras.alarms ?? [],
    linkUp: () => true,
    ...(extras.touched ? { touched: extras.touched } : {}),
    ...(extras.earlier ? { earlier: extras.earlier } : {}),
  };
}

export const fault = (type: Fault["type"], target: string): Fault => ({
  id: `f-${target}`,
  type,
  target,
  params: {},
  since: 0,
});

export const alarm = (entityId: string, severity: Alarm["severity"] = "warning"): Alarm => ({
  id: `a-${entityId}`,
  entityId,
  code: "test",
  severity,
  message: "test",
  since: 0,
});
