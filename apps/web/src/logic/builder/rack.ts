/**
 * One rack's front, unit by unit (the elevation panel): what sits where, what is free, and how much
 * power the devices ask for against what the rack's PDUs can give.
 */
import {
  type Catalog,
  type EquipmentModel,
  mountOfModel,
  RACK_STANDARD_LABELS,
} from "@terrarium/core/catalog";
import { withJosa } from "@terrarium/core/kernel";
import {
  type Blueprint,
  BlueprintIndex,
  type Entity,
  heightU,
  isRackMountedKind,
  rackStandardOf,
  rackUnits,
} from "@terrarium/core/world";
import { type Edit, EditError, nextId } from "./edit";
import { assertPower } from "./power";

export interface Slot {
  /** Lowest unit the slot covers (1 = bottom). */
  readonly u: number;
  readonly height: number;
  readonly device?: Entity;
}

export interface Elevation {
  readonly rack: Entity;
  readonly units: number;
  /** From the top unit down, as a rack is drawn: devices and runs of free units. */
  readonly slots: readonly Slot[];
  /** Vertical (0U) PDUs at the back. */
  readonly pdus: readonly Entity[];
  readonly freeUnits: number;
  /** Nameplate maximum of the devices vs. what the PDUs can carry (one PDU when there are two: A/B redundancy). */
  readonly demandW: number;
  readonly supplyW: number;
}

/** U count of a rack: what was set, else what its model is built with, else 42U. */
export const unitsOf = (rack: Entity, catalog: Catalog) => rackUnits(rack, catalog);

function maxPowerW(model: EquipmentModel | undefined): number {
  if (!model) return 0;
  if ("maxPowerW" in model) return model.maxPowerW;
  if ("powerW" in model) return model.powerW;
  return 0;
}

export function elevation(index: BlueprintIndex, catalog: Catalog, rackId: string): Elevation {
  const rack = index.entity(rackId);
  const units = unitsOf(rack, catalog);
  const devices = index.childrenOf(rackId).filter((d) => isRackMountedKind(d.kind));
  const pdus = devices.filter((d) => heightU(d, catalog) === 0);
  const mounted = devices
    .filter((d) => heightU(d, catalog) > 0 && d.placement?.type === "unit")
    .map((d) => ({ device: d, u: (d.placement as { u: number }).u, height: heightU(d, catalog) }));
  const slots: Slot[] = [];
  for (let u = units; u >= 1; ) {
    const here = mounted.find((m) => u >= m.u && u < m.u + m.height);
    if (here) {
      slots.push({ u: here.u, height: here.height, device: here.device });
      u = here.u - 1;
      continue;
    }
    let low = u;
    while (low > 1 && !mounted.some((m) => low - 1 >= m.u && low - 1 < m.u + m.height)) low--;
    slots.push({ u: low, height: u - low + 1 });
    u = low - 1;
  }
  const model = (d: Entity) =>
    d.modelId && catalog.has(d.modelId) ? catalog.get(d.modelId) : undefined;
  const capacities = pdus.map((p) => {
    const m = model(p);
    return m && "capacityW" in m ? m.capacityW : 0;
  });
  // Power shelves of an ORv3 rack share one busbar: what they can give adds up.
  const shelfW = mounted
    .map((m) => model(m.device))
    .reduce((sum, m) => sum + (m?.kind === "pdu" ? m.capacityW : 0), 0);
  return {
    rack,
    units,
    slots,
    pdus,
    freeUnits: slots.filter((s) => !s.device).reduce((sum, s) => sum + s.height, 0),
    demandW: mounted.reduce((sum, m) => sum + maxPowerW(model(m.device)), 0),
    // With two PDUs fed from A and B, either one must carry the whole rack.
    supplyW:
      shelfW > 0 ? shelfW : capacities.length >= 2 ? Math.min(...capacities) : (capacities[0] ?? 0),
  };
}

/** The lowest unit where a device of this height fits, or undefined when the rack is full. */
export function firstFreeU(
  index: BlueprintIndex,
  catalog: Catalog,
  rackId: string,
  height: number,
): number | undefined {
  const free = elevation(index, catalog, rackId)
    .slots.filter((s) => !s.device && s.height >= height)
    .sort((a, b) => a.u - b.u);
  return free[0]?.u;
}

const DEVICE_NAMES: Readonly<Record<string, string>> = {
  server: "서버",
  switch: "스위치",
  storage: "스토리지",
};

/** Where a device of this height goes: the given unit if free, else the lowest free one. */
function unitFor(
  index: BlueprintIndex,
  catalog: Catalog,
  ev: Elevation,
  height: number,
  u?: number,
): number {
  if (height === 0) {
    if (ev.pdus.length >= 2) throw new EditError("수직 PDU는 랙마다 둘(A, B)까지예요");
    return 1;
  }
  const at = u ?? firstFreeU(index, catalog, ev.rack.id, height);
  if (at === undefined) throw new EditError(`${height}U가 비어 있는 곳이 없어요`);
  if (at < 1 || at + height - 1 > ev.units)
    throw new EditError(`${ev.units}U 안에 들어가지 않아요`);
  const top = at + height - 1;
  const blocked = ev.slots.find((s) => s.device && s.u <= top && s.u + s.height - 1 >= at);
  if (blocked?.device)
    throw new EditError(`U${at}에 ${withJosa(blocked.device.name, "이")} 있어요`);
  return at;
}

function deviceName(
  index: BlueprintIndex,
  model: EquipmentModel,
  shelf: boolean,
  feed: string,
): string {
  if (shelf) return `파워 셸프 ${index.ofKind("pdu").length + 1}`;
  if (model.kind === "pdu") return `PDU ${feed}`;
  return `${DEVICE_NAMES[model.kind] ?? model.kind} ${index.ofKind(model.kind).length + 1}`;
}

/** Mount a device at unit `u` (or at the lowest free place). Vertical PDUs go at the back, two at most. */
export function mountDevice(
  bp: Blueprint,
  catalog: Catalog,
  rackId: string,
  modelId: string,
  u?: number,
): Edit {
  const index = new BlueprintIndex(bp);
  const rack = index.entity(rackId);
  if (rack.kind !== "rack") throw new EditError("장비는 랙에 달아요");
  const model = catalog.get(modelId);
  if (!("uHeight" in model))
    throw new EditError(`${withJosa(model.name, "은")} 랙에 다는 장비가 아니에요`);
  const wants = mountOfModel(model);
  const has = rackStandardOf(rack, catalog);
  if (wants !== has)
    throw new EditError(
      `${withJosa(model.name, "은")} ${RACK_STANDARD_LABELS[wants]}용이라 ${RACK_STANDARD_LABELS[has]} 랙에는 달 수 없어요`,
    );
  const ev = elevation(index, catalog, rackId);
  const at = unitFor(index, catalog, ev, model.uHeight, u);
  const id = nextId(index, model.kind);
  const feed = ev.pdus.length === 0 ? "A" : "B";
  const shelf = model.kind === "pdu" && model.shelf === true;
  const name = deviceName(index, model, shelf, feed);
  const device: Entity = {
    id,
    kind: model.kind,
    name,
    parentId: rackId,
    modelId,
    placement: { type: "unit", u: at },
    props: model.kind === "pdu" && !shelf ? { feed } : {},
  };
  const next = { ...bp, entities: [...bp.entities, device] };
  assertPower(bp, next, catalog);
  return { blueprint: next, select: [id] };
}

/** Move a mounted device to another unit of the same rack. */
export function remount(bp: Blueprint, catalog: Catalog, deviceId: string, u: number): Edit {
  const index = new BlueprintIndex(bp);
  const device = index.entity(deviceId);
  const height = heightU(device, catalog);
  const rackId = device.parentId as string;
  const others = elevation(
    new BlueprintIndex({ ...bp, entities: bp.entities.filter((e) => e.id !== deviceId) }),
    catalog,
    rackId,
  );
  if (u < 1 || u + height - 1 > others.units)
    throw new EditError(`${others.units}U 안에 들어가지 않아요`);
  const blocked = others.slots.find(
    (s) => s.device && s.u <= u + height - 1 && s.u + s.height - 1 >= u,
  );
  if (blocked?.device) throw new EditError(`U${u}에 ${withJosa(blocked.device.name, "이")} 있어요`);
  return {
    blueprint: {
      ...bp,
      entities: bp.entities.map((e) =>
        e.id === deviceId ? { ...e, placement: { type: "unit", u } } : e,
      ),
    },
    select: [deviceId],
  };
}
