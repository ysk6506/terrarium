/**
 * Where heat is made and carried, laid out as flat arrays by position (see power-plan.ts): which room a
 * rack stands in, which cooling units serve it, which devices sit in it, what each room holds. Worked out
 * once per blueprint; every step then reads arrays instead of walking the blueprint and looking ids up.
 */
import type { Catalog, RackCooling } from "@terrarium/core/catalog";
import type { BlueprintIndex, Entity, Fault, World } from "@terrarium/core/world";
import { type Pass, passOf } from "./power";
import type { PowerPlan } from "./power-plan";

/** The world as the thermal and plant passes read it: states and faults by position, and the thermal layout. */
export interface Heat extends Pass {
  readonly world: World;
  readonly t: ThermalPlan;
}

export const heatOf = (world: World): Heat => {
  const pass = passOf(world);
  return { ...pass, world, t: thermalPlanOf(pass.plan, world.index, world.catalog) };
};

export const faultsAt = (heat: Pass, i: number) => heat.faults[i] as readonly Fault[];

/** Lists of positions, one list per entity: the list of entity i is `items[start[i] .. start[i + 1]]`. */
export interface Lists {
  readonly start: Int32Array;
  readonly items: Int32Array;
}

export interface ThermalPlan {
  readonly racks: Int32Array;
  readonly rooms: Int32Array;
  readonly containments: Int32Array;
  /** Room a rack stands in (-1: none) and whether it stands in a containment. */
  readonly rackRoom: Int32Array;
  readonly contained: Uint8Array;
  readonly cooling: readonly RackCooling[];
  /** Per room: floor area, m². */
  readonly area: Float64Array;
  /** Cooling units a rack is wired to; cooling units standing in a room. */
  readonly assigned: Lists;
  readonly roomUnits: Lists;
  /** Per room: the racks, UPSes and CDUs in it (they give off heat into it), in the order of the room's contents. */
  readonly roomSources: Lists;
  /** Per rack: the devices whose power it adds up (servers, switches, storage); the servers alone. */
  readonly devices: Lists;
  readonly servers: Lists;
  /** Rack unit a server sits at. */
  readonly unit: Int32Array;
  /** Per containment: the racks in it. */
  readonly podRacks: Lists;
  readonly cdus: Int32Array;
  readonly chillers: Int32Array;
  readonly coolingUnits: Int32Array;
  /** The chillers a rack, CDU or cooling unit takes water from; the CDUs a rack is wired to (cable order). */
  readonly plants: Lists;
  readonly rackCdus: Lists;
}

const plans = new WeakMap<PowerPlan, ThermalPlan>();

export function thermalPlanOf(
  power: PowerPlan,
  index: BlueprintIndex,
  catalog: Catalog,
): ThermalPlan {
  const known = plans.get(power);
  if (known) return known;
  const plan = buildPlan(power, index, catalog);
  plans.set(power, plan);
  return plan;
}

function lists(n: number, of: (i: number) => readonly number[]): Lists {
  const per = Array.from({ length: n }, (_, i) => of(i));
  const start = new Int32Array(n + 1);
  per.forEach((list, i) => {
    start[i + 1] = (start[i] as number) + list.length;
  });
  return { start, items: Int32Array.from(per.flat()) };
}

const positionsOf = (ents: readonly Entity[], kind: Entity["kind"]) =>
  Int32Array.from(ents.flatMap((e, i) => (e.kind === kind ? [i] : [])));

/** What a thing is wired to for cooling, of one kind, in cable order. */
const coolingTargets = (index: BlueprintIndex, from: Entity, kind: Entity["kind"]) =>
  index
    .outgoing(from.id, "cooling")
    .map((l) => index.entity(l.to))
    .filter((e) => e.kind === kind);

function rackCoolingOf(rack: Entity, catalog: Catalog): RackCooling {
  if (!rack.modelId || !catalog.has(rack.modelId)) return "air";
  const model = catalog.get(rack.modelId);
  return model.kind === "rack" ? model.cooling : "air";
}

/** Where racks stand and what serves them: rooms, containments, cooling units. */
type RoomPart = Pick<
  ThermalPlan,
  "rackRoom" | "contained" | "cooling" | "area" | "assigned" | "roomUnits" | "roomSources"
>;

function roomPart(ents: readonly Entity[], index: BlueprintIndex, catalog: Catalog): RoomPart {
  const at = (e: Entity) => index.positionOf(e.id) ?? -1;
  const kindIs = (e: Entity, ...kinds: string[]) => kinds.includes(e.kind);
  const n = ents.length;
  return {
    rackRoom: Int32Array.from(ents, (e) => {
      const room = e.kind === "rack" ? index.enclosing(e.id, "room") : undefined;
      return room ? at(room) : -1;
    }),
    contained: Uint8Array.from(ents, (e) =>
      e.kind === "rack" && index.find(e.parentId ?? "")?.kind === "containment" ? 1 : 0,
    ),
    cooling: ents.map((e) => (e.kind === "rack" ? rackCoolingOf(e, catalog) : "air")),
    area: Float64Array.from(ents, (e) =>
      e.placement?.type === "area" ? e.placement.w * e.placement.d : 100,
    ),
    assigned: lists(n, (i) =>
      (ents[i] as Entity).kind !== "rack"
        ? []
        : coolingTargets(index, ents[i] as Entity, "cooling_unit").map(at),
    ),
    roomUnits: lists(n, (i) =>
      (ents[i] as Entity).kind === "room"
        ? index
            .descendants((ents[i] as Entity).id)
            .filter((e) => e.kind === "cooling_unit")
            .map(at)
        : [],
    ),
    roomSources: lists(n, (i) =>
      (ents[i] as Entity).kind === "room"
        ? index
            .descendants((ents[i] as Entity).id)
            .filter((e) => kindIs(e, "rack", "ups", "cdu"))
            .map(at)
        : [],
    ),
  };
}

/** What a rack holds and what it is wired to for cooling. */
type DevicePart = Pick<ThermalPlan, "devices" | "servers" | "plants" | "rackCdus" | "podRacks">;

function devicePart(ents: readonly Entity[], index: BlueprintIndex): DevicePart {
  const at = (e: Entity) => index.positionOf(e.id) ?? -1;
  const n = ents.length;
  const childrenOfRack = (i: number, ...kinds: string[]) =>
    (ents[i] as Entity).kind !== "rack"
      ? []
      : index
          .childrenOf((ents[i] as Entity).id)
          .filter((e) => kinds.includes(e.kind))
          .map(at);
  return {
    devices: lists(n, (i) => childrenOfRack(i, "server", "switch", "storage")),
    servers: lists(n, (i) => childrenOfRack(i, "server")),
    plants: lists(n, (i) =>
      ["rack", "cdu", "cooling_unit"].includes((ents[i] as Entity).kind)
        ? coolingTargets(index, ents[i] as Entity, "chiller").map(at)
        : [],
    ),
    rackCdus: lists(n, (i) =>
      (ents[i] as Entity).kind === "rack"
        ? coolingTargets(index, ents[i] as Entity, "cdu").map(at)
        : [],
    ),
    podRacks: lists(n, (i) =>
      (ents[i] as Entity).kind === "containment"
        ? index.childrenOf((ents[i] as Entity).id, "rack").map(at)
        : [],
    ),
  };
}

function buildPlan(power: PowerPlan, index: BlueprintIndex, catalog: Catalog): ThermalPlan {
  const ents = power.ents;
  const unit = new Int32Array(ents.length);
  ents.forEach((e, i) => {
    unit[i] = e.placement?.type === "unit" ? e.placement.u : 1;
  });
  return {
    racks: positionsOf(ents, "rack"),
    rooms: positionsOf(ents, "room"),
    containments: positionsOf(ents, "containment"),
    ...roomPart(ents, index, catalog),
    ...devicePart(ents, index),
    unit,
    cdus: positionsOf(ents, "cdu"),
    chillers: positionsOf(ents, "chiller"),
    coolingUnits: positionsOf(ents, "cooling_unit"),
  };
}
