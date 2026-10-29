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

/** Where a rack stands when the caller already knows (a generated hall): used as is, no grid is derived. */
export interface RackSpot {
  readonly x: number;
  readonly y: number;
  readonly rotation: Rotation;
  readonly row: number;
  readonly column: number;
}

export interface RackInput {
  readonly id: string;
  readonly hint: LocationHint;
  /** Known place in the room; racks without one are placed on the derived grid. */
  readonly at?: RackSpot;
  /** Floor size of this rack (a liquid rack or a tank is wider and deeper than a standard one). */
  readonly size?: { readonly w: number; readonly d: number };
  /** Rack units this rack offers; the layout's standard when omitted. */
  readonly units?: number;
}

export interface DeviceInput {
  readonly id: string;
  readonly hint: LocationHint;
  /** Explicit rack relation; wins over the hint's text reference. */
  readonly rackId?: string;
  readonly heightU: number;
  /** Floor footprint of free-standing equipment, so neighbours do not overlap. */
  readonly footprint?: { readonly w: number; readonly d: number };
  /** Known place of free-standing equipment (room frame); otherwise it is lined up along the front. */
  readonly at?: { readonly x: number; readonly y: number };
}

/** Gap between free-standing units that have a known footprint. */
const EQUIPMENT_GAP_M = 0.6;

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
  readonly inferred: boolean;
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
  const placements = new Map<string, RackPlacement>();
  for (const rack of racks) if (rack.at) placements.set(rack.id, { ...rack.at, inferred: false });
  const slots = assignSlots(
    racks.filter((r) => !r.at).map((r) => [r.id, r.hint] as const),
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
  const unitsOf = new Map(rackInputs.map((r) => [r.id, r.units ?? spec.rackUnits]));
  const devices = new Map<string, DevicePlacement>();
  const equipment = new Map<string, EquipmentPlacement>();
  const states = new Map<string, RackState>();
  let equipmentX = spec.margin;
  for (const device of devicesSorted) {
    const rackId = rackOf(device, racks);
    if (rackId === undefined) {
      if (device.at) {
        equipment.set(device.id, { ...device.at, inferred: false });
        continue;
      }
      equipment.set(device.id, { x: equipmentX, y: spec.margin, inferred: true });
      equipmentX += device.footprint ? device.footprint.w + EQUIPMENT_GAP_M : spec.equipmentPitch;
      continue;
    }
    const state = states.get(rackId) ?? { occupied: new Set<number>(), nextFree: 1 };
    states.set(rackId, state);
    const units = unitsOf.get(rackId) ?? spec.rackUnits;
    const { u, inferred } = chooseUnit(device, state, units, notes);
    for (let unit = u; unit < u + device.heightU; unit++) state.occupied.add(unit);
    devices.set(device.id, { rackId, u, inferred });
  }
  return {
    racks,
    devices,
    equipment,
    size: roomSize(rackInputs, racks, devicesSorted, spec, equipmentX, freeStanding.length > 0),
    notes,
  };
}

/** The room just large enough for its racks and equipment, plus the margin all round. */
function roomSize(
  rackInputs: readonly RackInput[],
  racks: ReadonlyMap<string, RackPlacement>,
  devices: readonly DeviceInput[],
  spec: LayoutSpec,
  equipmentX: number,
  hasEquipment: boolean,
): { w: number; d: number } {
  const sizeOf = new Map(
    rackInputs.map((r) => [r.id, r.size ?? { w: spec.rackWidth, d: spec.rackDepth }]),
  );
  let right = 0;
  let back = spec.margin + (hasEquipment ? spec.equipmentZone : 0);
  for (const [id, p] of racks) {
    const size = sizeOf.get(id) as { w: number; d: number };
    const turned = p.rotation === 90 || p.rotation === 270;
    right = Math.max(right, p.x + (turned ? size.d : size.w));
    back = Math.max(back, p.y + (turned ? size.w : size.d));
  }
  const placed = devices.filter((d) => d.at && d.footprint);
  for (const d of placed) {
    right = Math.max(right, (d.at as { x: number }).x + (d.footprint as { w: number }).w);
    back = Math.max(back, (d.at as { y: number }).y + (d.footprint as { d: number }).d);
  }
  const columns = Math.max(0, ...[...racks.values()].map((r) => r.column));
  const gridRight = spec.margin + columns * spec.rackWidth;
  return {
    w: Math.max(Math.max(right, gridRight) + spec.margin, equipmentX + spec.margin),
    d: back + spec.margin,
  };
}
