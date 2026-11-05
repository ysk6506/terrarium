/**
 * One room as the 3D view draws it (REQ-006, REQ-043, REQ-044, REQ-047): its racks grouped by kind,
 * the containments around the aisles, the cooling, power and plant equipment standing in it, and the
 * overhead runs (busway, coolant headers). The room's own frame has its corner at (0, 0), x to the
 * right, z toward the viewer, y up from the slab.
 */
import type { Catalog } from "@terrarium/core/catalog";
import {
  type BlueprintIndex,
  type Entity,
  type RoomPurpose,
  roomPurposeOf,
} from "@terrarium/core/world";
import { type EquipBox, equipOf } from "./equip";
import { type BayDecor, bayDecor } from "./fab";
import { type CoolingMode, hallMode, racksIn } from "./modes";
import { type Bounds, type Box, boundsOfBox, boxOf, overlapBounds } from "./plan";
import { type RackPlace, type RackSet, rackSets } from "./racks";

/** Height of the raised floor in a data hall, metres. */
export const RAISED_FLOOR_M = 0.6;
/** Height of a room's walls above its slab, metres. */
export const ROOM_HEIGHT_M = 4.2;

export interface Pod extends Box {
  readonly aisle: "cold" | "hot";
  /** The aisle that is closed in: between the two rows (or in front of / behind a single row). */
  readonly enclosure: Bounds;
  readonly rackIds: readonly string[];
}

/** A run of racks in a line, with an overhead busway above it. */
export interface Row {
  readonly x0: number;
  readonly x1: number;
  readonly z: number;
}

export interface Pipe {
  readonly a: readonly [number, number, number];
  readonly b: readonly [number, number, number];
  readonly kind: "supply" | "return";
}

export interface RoomScene {
  readonly id: string;
  readonly name: string;
  readonly purpose: RoomPurpose;
  readonly mode?: CoolingMode;
  readonly w: number;
  readonly d: number;
  readonly floorY: number;
  readonly sets: readonly RackSet[];
  readonly pods: readonly Pod[];
  readonly equipment: readonly EquipBox[];
  readonly rows: readonly Row[];
  readonly pipes: readonly Pipe[];
  readonly columns: ReadonlyArray<{ readonly x: number; readonly z: number }>;
  /** The tools and rails drawn in a cleanroom. */
  readonly bay?: BayDecor;
  readonly racks: number;
  readonly servers: number;
}

const COLUMN_PITCH_M = 12;
const RACK_ROW_TOLERANCE_M = 0.2;

/** A row's own busway height above the slab, metres. */
export const BUSWAY_Y = 3.55;
const HEADER_Y = 3.3;

function enclosureOf(pod: Entity, catalog: Catalog, racks: readonly Box[], aisle: string): Bounds {
  const p = boxOf(pod, catalog) as Box;
  const own = boundsOfBox(p);
  if (racks.length === 0) return own;
  const zc = p.z;
  const above = racks.filter((r) => r.z < zc);
  const below = racks.filter((r) => r.z >= zc);
  const edge = (list: readonly Box[], dir: 1 | -1) =>
    list.length === 0
      ? undefined
      : (dir === 1 ? Math.max : Math.min)(...list.map((r) => r.z + (dir * r.d) / 2));
  const top = edge(above, 1);
  const bottom = edge(below, -1);
  if (top !== undefined && bottom !== undefined && bottom > top)
    return { x0: own.x0, z0: top, x1: own.x1, z1: bottom };
  // A single row: its front aisle (cold) or its back aisle (hot) is the one that is closed.
  const row = above.length > 0 ? above : below;
  const rowTop = Math.min(...row.map((r) => r.z - r.d / 2));
  const rowBottom = Math.max(...row.map((r) => r.z + r.d / 2));
  const faceBelow = above.length > 0 === (aisle === "cold");
  return faceBelow
    ? { x0: own.x0, z0: rowBottom, x1: own.x1, z1: Math.min(own.z1, rowBottom + 1.2) }
    : { x0: own.x0, z0: Math.max(own.z0, rowTop - 1.2), x1: own.x1, z1: rowTop };
}

function podsOf(index: BlueprintIndex, catalog: Catalog, roomId: string): Pod[] {
  return index.childrenOf(roomId, "containment").flatMap((pod) => {
    const box = boxOf(pod, catalog);
    if (!box) return [];
    const racks = index.childrenOf(pod.id, "rack");
    const rackBoxes = racks
      .flatMap((r) => boxOf(r, catalog) ?? [])
      .map((b) => ({
        ...b,
        ...boundsToBox(boundsOfBox(b)),
      }));
    const aisle = pod.props.aisle === "hot" ? "hot" : "cold";
    return [
      {
        ...box,
        aisle,
        enclosure: enclosureOf(pod, catalog, rackBoxes, aisle),
        rackIds: racks.map((r) => r.id),
      },
    ];
  });
}

/** An axis-aligned bounds as a centred box (width and depth along the plan axes). */
function boundsToBox(b: Bounds): { x: number; z: number; w: number; d: number } {
  return { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, w: b.x1 - b.x0, d: b.z1 - b.z0 };
}

/** Racks in a line share a z and a facing; each line gets one busway. */
function rowsOf(sets: readonly RackSet[]): Row[] {
  const lines = new Map<number, { x0: number; x1: number; z: number }>();
  for (const set of sets)
    for (let i = 0; i < set.ids.length; i++) {
      const x = set.at[i * 4] as number;
      const z = set.at[i * 4 + 2] as number;
      const half = (set.kind.w + 0.05) / 2;
      const key = Math.round(z / RACK_ROW_TOLERANCE_M);
      const line = lines.get(key);
      if (line) {
        line.x0 = Math.min(line.x0, x - half);
        line.x1 = Math.max(line.x1, x + half);
      } else lines.set(key, { x0: x - half, x1: x + half, z });
    }
  return [...lines.values()];
}

function pipesOf(
  equipment: readonly EquipBox[],
  pods: readonly Pod[],
  sets: readonly RackSet[],
): Pipe[] {
  const pipes: Pipe[] = [];
  const wet = equipment.filter((e) => e.wet && e.style !== "busway");
  if (wet.length === 0) return pipes;
  const header = 0.55;
  const x0 = Math.min(...wet.map((e) => e.x)) - 1;
  const x1 = Math.max(...wet.map((e) => e.x)) + 1;
  pipes.push(
    { a: [x0, HEADER_Y, header], b: [x1, HEADER_Y, header], kind: "supply" },
    { a: [x0, HEADER_Y, header + 0.4], b: [x1, HEADER_Y, header + 0.4], kind: "return" },
  );
  for (const e of wet) {
    pipes.push(
      { a: [e.x - 0.3, e.h, e.z], b: [e.x - 0.3, HEADER_Y, header], kind: "supply" },
      { a: [e.x + 0.3, e.h, e.z], b: [e.x + 0.3, HEADER_Y, header + 0.4], kind: "return" },
    );
  }
  // Pods that hold liquid-cooled racks or tanks get a branch from the headers.
  const liquid = new Set(
    sets.filter((s) => s.kind.form === "dlc" || s.kind.form === "tank").flatMap((s) => s.ids),
  );
  for (const pod of pods) {
    if (!pod.rackIds.some((id) => liquid.has(id))) continue;
    const top = pod.z - pod.d / 2;
    pipes.push(
      { a: [pod.x - 0.2, HEADER_Y, header], b: [pod.x - 0.2, HEADER_Y, top], kind: "supply" },
      { a: [pod.x + 0.2, HEADER_Y, header + 0.4], b: [pod.x + 0.2, HEADER_Y, top], kind: "return" },
    );
  }
  return pipes;
}

/** Building columns on a grid, left out where they would stand in a rack or a machine. */
function columnsOf(
  w: number,
  d: number,
  taken: readonly Bounds[],
): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  for (let x = COLUMN_PITCH_M / 2; x < w; x += COLUMN_PITCH_M)
    for (let z = COLUMN_PITCH_M / 2; z < d; z += COLUMN_PITCH_M) {
      const c = { x0: x - 0.4, z0: z - 0.4, x1: x + 0.4, z1: z + 0.4 };
      if (!taken.some((t) => overlapBounds(t, c))) out.push({ x, z });
    }
  return out;
}

function equipmentIn(index: BlueprintIndex, catalog: Catalog, room: Entity, y: number): EquipBox[] {
  const direct = index.childrenOf(room.id);
  const inPods = index
    .childrenOf(room.id, "containment")
    .flatMap((c) => index.childrenOf(c.id))
    .filter((e) => e.kind === "cooling_unit");
  return [...direct, ...inPods].flatMap((e) =>
    ["cooling_unit", "cdu", "ups", "power_panel"].includes(e.kind)
      ? (equipOf(catalog, e, 0, y, 0) ?? [])
      : [],
  );
}

export function roomScene(
  index: BlueprintIndex,
  catalog: Catalog,
  roomId: string,
): RoomScene | undefined {
  const room = index.find(roomId);
  if (!room || room.kind !== "room") return undefined;
  const box = boxOf(room, catalog);
  if (!box) return undefined;
  const purpose = roomPurposeOf(room);
  const floorY = purpose === "data_hall" ? RAISED_FLOOR_M : 0.12;
  const racks = racksIn(index, room.id);
  const places: RackPlace[] = racks.map((rack) => ({ rack, ox: 0, oy: floorY, oz: 0 }));
  const sets = rackSets(index, catalog, places);
  const equipment = equipmentIn(index, catalog, room, floorY);
  const pods = podsOf(index, catalog, room.id);
  const taken = [
    ...equipment.map(boundsOfBox),
    ...sets.flatMap((s) =>
      s.ids.map((_, i) => {
        const x = s.at[i * 4] as number;
        const z = s.at[i * 4 + 2] as number;
        return { x0: x - s.kind.w, z0: z - s.kind.d, x1: x + s.kind.w, z1: z + s.kind.d };
      }),
    ),
  ];
  const mode = purpose === "data_hall" ? hallMode(index, catalog, room) : undefined;
  return {
    id: room.id,
    name: room.name,
    purpose,
    ...(mode ? { mode } : {}),
    w: box.w,
    d: box.d,
    floorY,
    sets,
    pods,
    equipment,
    rows: purpose === "data_hall" ? rowsOf(sets) : [],
    pipes: pipesOf(equipment, pods, sets),
    columns: columnsOf(box.w, box.d, taken),
    ...(purpose === "cleanroom" ? { bay: bayDecor(room.id, box.w, box.d) } : {}),
    racks: racks.length,
    servers: sets.reduce((n, s) => n + s.servers.reduce((a, b) => a + b, 0), 0),
  };
}
