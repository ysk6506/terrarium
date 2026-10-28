/**
 * Derive the layout of one room from location hints alone, with no floor plan (REQ-013).
 * Racks stand in rows; neighbouring rows face each other across a cold aisle, then sit back to back
 * across a hot aisle, as real halls are built. Results depend only on sorted ids, never input order.
 * Coordinates are room-local metres: (0, 0) is the room's front-left corner.
 */
import { RACK_DEPTH_M, RACK_UNITS_DEFAULT, RACK_WIDTH_M } from "@terrarium/core/kernel";
import type { Rotation } from "./geometry";
import type { LocationHint } from "./hints";
import { assignSlots } from "./slots";

export interface LayoutSpec {
  readonly rackWidth: number;
  readonly rackDepth: number;
  readonly coldAisle: number;
  readonly hotAisle: number;
  readonly margin: number;
  readonly equipmentZone: number;
  readonly equipmentPitch: number;
  readonly racksPerRow: number;
  readonly rackUnits: number;
}

export const DEFAULT_LAYOUT: LayoutSpec = {
  rackWidth: RACK_WIDTH_M,
  rackDepth: RACK_DEPTH_M,
  coldAisle: 1.8,
  hotAisle: 1.2,
  margin: 1.5,
  equipmentZone: 2.0,
  equipmentPitch: 1.5,
  racksPerRow: 10,
  rackUnits: RACK_UNITS_DEFAULT,
};

export interface RackInput {
  readonly id: string;
  readonly hint: LocationHint;
}

export interface DeviceInput {
  readonly id: string;
  readonly hint: LocationHint;
  /** Explicit rack relation; wins over the hint's text reference. */
  readonly rackId?: string;
  readonly heightU: number;
}

export interface RackPlacement {
  readonly x: number;
  readonly y: number;
  readonly rotation: Rotation;
  readonly row: number;
  readonly column: number;
  readonly inferred: boolean;
}

export interface DevicePlacement {
  readonly rackId: string;
  readonly u: number;
  readonly inferred: boolean;
}

export interface EquipmentPlacement {
  readonly x: number;
  readonly y: number;
  readonly inferred: true;
}

export interface RoomLayout {
  readonly racks: ReadonlyMap<string, RackPlacement>;
  readonly devices: ReadonlyMap<string, DevicePlacement>;
  /** Free-standing equipment: devices with no rack (cooling units, panels, UPS). */
  readonly equipment: ReadonlyMap<string, EquipmentPlacement>;
  readonly size: { readonly w: number; readonly d: number };
  readonly notes: readonly string[];
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

interface RackState {
  occupied: Set<number>;
  nextFree: number;
}

function fits(state: RackState, start: number, height: number, rackUnits: number): boolean {
  if (start < 1 || start + height - 1 > rackUnits) return false;
  for (let u = start; u < start + height; u++) if (state.occupied.has(u)) return false;
  return true;
}

/** Nearest free start unit to `wanted`, searching up first, then down. */
function nearestFree(
  state: RackState,
  wanted: number,
  height: number,
  rackUnits: number,
): number | undefined {
  for (let offset = 0; offset < rackUnits; offset++) {
    for (const start of offset === 0 ? [wanted] : [wanted + offset, wanted - offset]) {
      if (fits(state, start, height, rackUnits)) return start;
    }
  }
  return undefined;
}

/**
 * The unit a device starts at, and whether it had to be guessed. A device whose stated unit is taken
 * goes to the nearest free unit (real equipment is usually close to where the record says it is).
 */
function chooseUnit(
  device: DeviceInput,
  state: RackState,
  rackUnits: number,
  notes: string[],
): { u: number; inferred: boolean } {
  const wanted = device.hint.unit;
  const height = device.heightU;
  if (wanted !== undefined && fits(state, wanted, height, rackUnits))
    return { u: wanted, inferred: false };
  const valid = wanted !== undefined && wanted + height - 1 <= rackUnits;
  const start = nearestFree(
    state,
    valid ? (wanted as number) : Math.max(state.nextFree, 1),
    height,
    rackUnits,
  );
  if (start === undefined) {
    notes.push(`${device.id}: rack is full, stacked at the top`);
    return { u: Math.max(rackUnits - height + 1, 1), inferred: true };
  }
  notes.push(
    `${device.id}: ${valid ? "unit already used" : "no usable unit given"}, placed at U${start}`,
  );
  if (!valid) state.nextFree = start + height;
  return { u: start, inferred: true };
}

function placeRacks(
  racks: readonly RackInput[],
  hasEquipment: boolean,
  spec: LayoutSpec,
  notes: string[],
): Map<string, RackPlacement> {
  const slots = assignSlots(
    racks.map((r) => [r.id, r.hint] as const),
    spec.racksPerRow,
    notes,
  );
  const rows = [...new Set([...slots.values()].map((s) => s.row))].sort((a, b) => a - b);
  const rowY = new Map<number, { y: number; rotation: Rotation }>();
  let edge = spec.margin + (hasEquipment ? spec.equipmentZone : 0);
  rows.forEach((row, index) => {
    rowY.set(row, { y: edge, rotation: index % 2 === 0 ? 0 : 180 });
    edge += spec.rackDepth + (index % 2 === 0 ? spec.coldAisle : spec.hotAisle);
  });
  const placements = new Map<string, RackPlacement>();
  for (const [id, slot] of [...slots].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const row = rowY.get(slot.row) as { y: number; rotation: Rotation };
    placements.set(id, {
      x: spec.margin + (slot.column - 1) * spec.rackWidth,
      y: row.y,
      rotation: row.rotation,
      row: slot.row,
      column: slot.column,
      inferred: slot.inferred,
    });
  }
  return placements;
}

function rackOf(
  device: DeviceInput,
  racks: ReadonlyMap<string, RackPlacement>,
): string | undefined {
  for (const candidate of [device.rackId, device.hint.rackRef]) {
    if (candidate !== undefined && racks.has(candidate)) return candidate;
  }
  return undefined;
}

export function deriveRoomLayout(
  rackInputs: readonly RackInput[],
  deviceInputs: readonly DeviceInput[],
  spec: LayoutSpec = DEFAULT_LAYOUT,
): RoomLayout {
  const notes: string[] = [];
  const devicesSorted = [...deviceInputs].sort(byId);
  const rackIds = new Set(rackInputs.map((r) => r.id));
  const freeStanding = devicesSorted.filter(
    (d) => !rackIds.has(d.rackId ?? "") && !rackIds.has(d.hint.rackRef ?? ""),
  );
  const racks = placeRacks([...rackInputs].sort(byId), freeStanding.length > 0, spec, notes);
  const devices = new Map<string, DevicePlacement>();
  const equipment = new Map<string, EquipmentPlacement>();
  const states = new Map<string, RackState>();
  for (const device of devicesSorted) {
    const rackId = rackOf(device, racks);
    if (rackId === undefined) {
      equipment.set(device.id, {
        x: spec.margin + equipment.size * spec.equipmentPitch,
        y: spec.margin,
        inferred: true,
      });
      continue;
    }
    const state = states.get(rackId) ?? { occupied: new Set<number>(), nextFree: 1 };
    states.set(rackId, state);
    const { u, inferred } = chooseUnit(device, state, spec.rackUnits, notes);
    for (let unit = u; unit < u + device.heightU; unit++) state.occupied.add(unit);
    devices.set(device.id, { rackId, u, inferred });
  }
  const columns = Math.max(0, ...[...racks.values()].map((r) => r.column));
  const lastY = Math.max(
    spec.margin + (freeStanding.length > 0 ? spec.equipmentZone : 0),
    ...[...racks.values()].map((r) => r.y + spec.rackDepth),
  );
  const width = Math.max(
    spec.margin * 2 + columns * spec.rackWidth,
    spec.margin * 2 + equipment.size * spec.equipmentPitch,
  );
  return { racks, devices, equipment, size: { w: width, d: lastY + spec.margin }, notes };
}
