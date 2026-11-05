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
  outlineOf,
  type RoomPurpose,
  roomLocalRects,
  roomPurposeOf,
} from "@terrarium/core/world";
import { type EquipBox, equipOf } from "./equip";
import { type BayDecor, bayDecor } from "./fab";
import { type CoolingMode, hallMode, racksIn } from "./modes";
import {
  type Bounds,
  type Box,
  boundsOf,
  boundsOfBox,
  boxOf,
  overlapBounds,
  type Pt,
} from "./plan";
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
  /** The body of the room: its first rectangle. A room with pieces is larger; see `rects`. */
  readonly w: number;
  readonly d: number;
  /** The floor as rectangles in the room's frame (the body's corner is 0, 0): one for a plain room (ADR-0080). */
  readonly rects?: readonly Bounds[];
  /** The walls' line: the outline of the floor, corners in order, counter-clockwise with z down. */
  readonly outline?: readonly Pt[];
  /** The box round the whole floor; it reaches below zero when a piece lies left of or above the body. */
  readonly bounds?: Bounds;
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

type Floor = Pick<RoomScene, "w" | "d" | "rects" | "outline" | "bounds">;

/** The floor's rectangles; a scene made without pieces is its body. */
export const rectsOfScene = (s: Floor): readonly Bounds[] =>
  s.rects ?? [{ x0: 0, z0: 0, x1: s.w, z1: s.d }];

/** The floor's outline, corners in order. */
export const outlineOfScene = (s: Floor): readonly Pt[] =>
  s.outline ?? [
    { x: 0, z: 0 },
    { x: s.w, z: 0 },
    { x: s.w, z: s.d },
    { x: 0, z: s.d },
  ];

/** The box round the whole floor. */
export const boundsOfScene = (s: Floor): Bounds => s.bounds ?? { x0: 0, z0: 0, x1: s.w, z1: s.d };

/** Whether a point lies on the floor of the room (any piece, edge included). */
export function insideScene(scene: Floor, x: number, z: number): boolean {
  return rectsOfScene(scene).some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
}

/** Building columns on a grid, left out where they would stand in a rack or a machine or off the floor. */
function columnsOf(
  floor: readonly Bounds[],
  taken: readonly Bounds[],
): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  const box = unionOfBounds(floor);
  const x0 =
    Math.ceil((box.x0 - COLUMN_PITCH_M / 2) / COLUMN_PITCH_M) * COLUMN_PITCH_M + COLUMN_PITCH_M / 2;
  const z0 =
    Math.ceil((box.z0 - COLUMN_PITCH_M / 2) / COLUMN_PITCH_M) * COLUMN_PITCH_M + COLUMN_PITCH_M / 2;
  for (let x = x0; x < box.x1; x += COLUMN_PITCH_M)
    for (let z = z0; z < box.z1; z += COLUMN_PITCH_M) {
      const c = { x0: x - 0.4, z0: z - 0.4, x1: x + 0.4, z1: z + 0.4 };
      const onFloor = floor.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
      if (onFloor && !taken.some((t) => overlapBounds(t, c))) out.push({ x, z });
    }
  return out;
}

function unionOfBounds(list: readonly Bounds[]): Bounds {
  return boundsOf(
    list.flatMap((b) => [
      { x: b.x0, z: b.z0 },
      { x: b.x1, z: b.z1 },
    ]),
  );
}

/** The back wall's longest stretch: where the sprinkler main runs. */
export function backWall(scene: Floor): {
  readonly x0: number;
  readonly x1: number;
  readonly z: number;
} {
  const outline = outlineOfScene(scene);
  const bounds = boundsOfScene(scene);
  let best = { x0: bounds.x0, x1: bounds.x1, z: bounds.z0 };
  let length = -1;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i] as Pt;
    const b = outline[(i + 1) % outline.length] as Pt;
    if (Math.abs(a.z - bounds.z0) > 1e-6 || Math.abs(b.z - bounds.z0) > 1e-6) continue;
    const len = Math.abs(b.x - a.x);
    if (len > length) {
      length = len;
      best = { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z: bounds.z0 };
    }
  }
  return best;
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
  const local = roomLocalRects(room);
  const rects = local.map((r) => ({ x0: r.x, z0: r.y, x1: r.x + r.w, z1: r.y + r.d }));
  const outline = outlineOf(local).map((p) => ({ x: p.x, z: p.y }));
  return {
    id: room.id,
    name: room.name,
    purpose,
    ...(mode ? { mode } : {}),
    w: box.w,
    d: box.d,
    rects,
    outline,
    bounds: unionOfBounds(rects),
    floorY,
    sets,
    pods,
    equipment,
    rows: purpose === "data_hall" ? rowsOf(sets) : [],
    pipes: pipesOf(equipment, pods, sets),
    columns: columnsOf(rects, taken),
    ...(purpose === "cleanroom" ? { bay: bayDecor(room.id, box.w, box.d) } : {}),
    racks: racks.length,
    servers: sets.reduce((n, s) => n + s.servers.reduce((a, b) => a + b, 0), 0),
  };
}

/**
 * The outline pulled in by `margin` metres all round: where the heat wash and the glow of the floor end, a hand's
 * width short of the walls. Rectilinear outlines only, counter-clockwise (the room on the left of each side).
 */
export function insetOutline(outline: readonly Pt[], margin: number): Pt[] {
  const n = outline.length;
  return outline.map((p, i) => {
    const before = outline[(i + n - 1) % n] as Pt;
    const after = outline[(i + 1) % n] as Pt;
    const inward = (a: Pt, b: Pt): Pt => {
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      return { x: -(b.z - a.z) / len, z: (b.x - a.x) / len };
    };
    const n1 = inward(before, p);
    const n2 = inward(p, after);
    return { x: p.x + (n1.x + n2.x) * margin, z: p.z + (n1.z + n2.z) * margin };
  });
}
