/**
 * Rooms that are not data halls (REQ-043): electrical rooms with UPS, switchgear and transfer switches,
 * battery rooms, the mechanical room with the CDUs, the network room (MMR) with the building's core
 * switches, and the control room. Equipment in them is laid out in shelves; each room is cooled.
 */
import type { Catalog } from "@terrarium/core/catalog";
import type { EquipmentSpec, RackSpec, RoomSpec } from "@terrarium/core/sources";
import { packShelves } from "@terrarium/core/spatial";
import type { RoomPurpose } from "@terrarium/core/world";
import { FAMILIES } from "./campus-families";
import type { CampusCtx } from "./campus-types";

const GAP_M = 1;
const MAX_WIDTH_M = 30;
/** A cooling unit is planned for this share of its capacity. */
const COOLING_PLAN = 0.6;

const footprintOf = (catalog: Catalog, modelId: string) => {
  const model = catalog.get(modelId);
  return "footprint" in model ? model.footprint : { w: 1, d: 1 };
};

/** Gap between equipment in a room that has a size given by a floor plan: tighter than in a room that grows to fit. */
const PLAN_GAP_M = 0.4;

/** Equipment placed in shelves; the room is as big as the shelves need. */
export function shelve(
  catalog: Catalog,
  items: readonly EquipmentSpec[],
  minSize = { w: 8, d: 6 },
  fixed = false,
): { equipment: EquipmentSpec[]; size: { w: number; d: number } } {
  const gap = fixed ? PLAN_GAP_M : GAP_M;
  const packed = packShelves(
    items.map((i) => ({ id: i.id, ...footprintOf(catalog, i.modelId) })),
    fixed ? minSize.w - 2 * gap : MAX_WIDTH_M,
    gap,
  );
  const equipment = items.map((item) => {
    const p = packed.find((x) => x.id === item.id) as (typeof packed)[number];
    return { ...item, at: { x: p.x, y: p.y } };
  });
  const w = Math.max(minSize.w, ...packed.map((p) => p.x + p.w + gap));
  const d = Math.max(minSize.d, ...packed.map((p) => p.y + p.d + gap));
  return { equipment, size: { w, d } };
}

/** Cooling units for a room that gives off `heatW`, with one spare. */
export function roomCooling(
  ctx: CampusCtx,
  room: string,
  heatW: number,
  powerFrom: readonly string[],
): EquipmentSpec[] {
  const model = "cv-dx-60kw";
  const cap = ctx.catalog.getOf(model, "cooling_unit").capacityKw * 1000;
  const count = Math.max(1, Math.ceil(heatW / (COOLING_PLAN * cap))) + 1;
  return Array.from({ length: count }, (_, i) => {
    const id = `${room}-ac${i + 1}`;
    ctx.asm.link("power", id, powerFrom[i % powerFrom.length] as string);
    return {
      id,
      kind: "cooling_unit" as const,
      name: `AC-${room.split("-").slice(-2).join("-")}-${i + 1}`,
      modelId: model,
    };
  });
}

export interface PlainRoom {
  readonly id: string;
  readonly name: string;
  readonly purpose: RoomPurpose;
  readonly equipment?: readonly EquipmentSpec[];
  readonly racks?: readonly RackSpec[];
  readonly devices?: RoomSpec["devices"];
  readonly size?: { w: number; d: number };
  readonly props?: RoomSpec["props"];
}

export function emitRoom(ctx: CampusCtx, floorId: string, room: PlainRoom): void {
  // A room on a floor plan has the size and place the plan gives it; its equipment is packed into that.
  const plan = ctx.placed.get(room.id);
  const shelved = shelve(ctx.catalog, room.equipment ?? [], plan ?? room.size, plan !== undefined);
  ctx.asm.room(floorId, {
    ...(plan ? { at: { x: plan.x, y: plan.y } } : {}),
    id: room.id,
    name: room.name,
    purpose: room.purpose,
    racks: room.racks ?? [],
    devices: room.devices ?? [],
    equipment: shelved.equipment,
    size: shelved.size,
    ...(room.props ? { props: room.props } : {}),
  });
}

/** The network room: two racks, each with a core switch and a management switch, fed from A and B. */
export function emitNetworkRoom(
  ctx: CampusCtx,
  floorId: string,
  building: string,
  feeds: { readonly a: string; readonly b: string },
): string[] {
  const id = `${building}-f1-mmr`;
  const family = FAMILIES[2] as (typeof FAMILIES)[number];
  const cores: string[] = [];
  const racks: RackSpec[] = [];
  const devices: RoomSpec["devices"][number][] = [];
  for (const [i, side] of (["a", "b"] as const).entries()) {
    const rackId = `${id}-r${i + 1}`;
    racks.push({
      id: rackId,
      name: `MMR-${side.toUpperCase()}`,
      hint: { floorInfo: {}, unitSpan: 1 },
      at: { x: 2 + i * 1.4, y: 3, rotation: 0, row: 1, column: i + 1 },
    });
    const pdu = `${rackId}-pdu`;
    const core = `${rackId}-core`;
    const mgmt = `${rackId}-mgmt`;
    const hint = (unit: number) => ({ floorInfo: {}, unit, unitSpan: 1 });
    devices.push(
      {
        id: pdu,
        kind: "pdu",
        name: `PDU-MMR-${side.toUpperCase()}`,
        modelId: "pdu-17kw",
        hint: hint(1),
        rackId,
      },
      {
        id: core,
        kind: "switch",
        name: `core-${building.split("-").at(-1)}-${side}`,
        modelId: family.spine,
        hint: hint(30),
        rackId,
      },
      {
        id: mgmt,
        kind: "switch",
        name: `mgmt-${building.split("-").at(-1)}-${side}`,
        modelId: "sw-mgmt-48x1g",
        hint: hint(40),
        rackId,
      },
    );
    ctx.asm
      .link("power", pdu, feeds[side])
      .link("power", core, pdu)
      .link("power", mgmt, pdu)
      .link("network", mgmt, core);
    cores.push(core);
  }
  const heat = 2 * (ctx.catalog.getOf(family.spine, "switch").powerW + 80);
  const cooling = roomCooling(ctx, id, heat, [feeds.a, feeds.b]);
  emitRoom(ctx, floorId, {
    id,
    name: `${building.split("-").at(-1)?.toUpperCase()} 통신실(MMR)`,
    purpose: "network",
    equipment: cooling,
    racks,
    devices,
    size: { w: 14, d: 10 },
  });
  for (const r of racks)
    for (const unit of cooling.slice(0, 2)) ctx.asm.link("cooling", r.id, unit.id);
  return cores;
}
