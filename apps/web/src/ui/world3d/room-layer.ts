/**
 * One server room (or electrical, battery, mechanical, network room) built into its floor: the raised
 * floor with perforated tiles in the cold aisles, partition walls under a glass band, columns, the
 * containment around each aisle, the busway, cable trays and coolant headers overhead, a sprinkler
 * main, the equipment standing in it, and its racks. Every room in the world gets the layout its own
 * blueprint has — a hall with no containment simply has none (REQ-043, REQ-044, REQ-047).
 */
import { world3d } from "../../logic";
import { indoorEquip } from "./equip-layer";
import type { Kit } from "./parts";
import type { RackFleet } from "./racks-layer";

type RoomScene = world3d.RoomScene;
type PlacedRoom = world3d.PlacedRoom;

const { RAISED_FLOOR_M, ROOM_HEIGHT_M, BUSWAY_Y } = world3d;
const CURB_M = 1.3;
const WALL_M = 0.2;
const POD_H_M = 2.3;

export interface FloorCtx {
  readonly k: Kit;
  /** Walls, roofs, doors and posts: kept apart so they can be taken away to look at a rack. */
  readonly cover: Kit;
  readonly fleet: RackFleet;
}

/** The floor: one slab for each rectangle of the room, tiles running on across the seam (there is no wall or line there). */
function floor(k: Kit, s: RoomScene): void {
  const { b, m } = k;
  const raised = s.purpose === "data_hall";
  const clean = s.purpose === "cleanroom";
  for (const r of world3d.rectsOfScene(s))
    b.box(raised ? m.raisedFloor : clean ? m.cleanFloor : m.concrete, {
      x: (r.x0 + r.x1) / 2,
      z: (r.z0 + r.z1) / 2,
      w: r.x1 - r.x0,
      d: r.z1 - r.z0,
      h: raised ? RAISED_FLOOR_M : 0.12,
      tile: raised || clean ? 0.6 : 6,
      shadow: false,
    });
}

type Pt = { readonly x: number; readonly z: number };

/** One side of the outline: its ends, which way the room lies from it, and whether its ends are convex corners. */
interface Side {
  readonly a: Pt;
  readonly b: Pt;
  readonly len: number;
  readonly lengthwise: boolean;
  /** The unit step from the line into the room. */
  readonly inward: Pt;
  readonly startConvex: boolean;
  readonly endConvex: boolean;
}

/** The sides of the room's outline (counter-clockwise, the room on the left of each). */
function sidesOf(outline: readonly Pt[]): Side[] {
  const n = outline.length;
  const out: Side[] = [];
  const turn = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.z - q.z) - (q.z - p.z) * (r.x - q.x);
  for (let i = 0; i < n; i++) {
    const a = outline[i] as Pt;
    const b = outline[(i + 1) % n] as Pt;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    out.push({
      a,
      b,
      len,
      lengthwise: Math.abs(dx) > Math.abs(dz),
      inward: { x: -dz / len, z: dx / len },
      startConvex: turn(outline[(i + n - 1) % n] as Pt, a, b) > 0,
      endConvex: turn(a, b, outline[(i + 2) % n] as Pt) > 0,
    });
  }
  return out;
}

/** A side as the box that lies along it, `thick` wide, on the room's side (+1) or outside it (-1); horizontal sides reach `reach` past convex corners. */
function band(side: Side, thick: number, toward: 1 | -1, reach = 0) {
  const lo = side.lengthwise ? Math.min(side.a.x, side.b.x) : Math.min(side.a.z, side.b.z);
  const hi = side.lengthwise ? Math.max(side.a.x, side.b.x) : Math.max(side.a.z, side.b.z);
  const startIsLo = side.lengthwise ? side.a.x < side.b.x : side.a.z < side.b.z;
  const loConvex = startIsLo ? side.startConvex : side.endConvex;
  const hiConvex = startIsLo ? side.endConvex : side.startConvex;
  const from = lo - (side.lengthwise && loConvex ? reach : 0);
  const to = hi + (side.lengthwise && hiConvex ? reach : 0);
  const middle = (from + to) / 2;
  const length = to - from;
  const offX = side.inward.x * toward * (thick / 2);
  const offZ = side.inward.z * toward * (thick / 2);
  return side.lengthwise
    ? { x: middle, z: side.a.z + offZ, w: length, d: thick }
    : { x: side.a.x + offX, z: middle, w: thick, d: length };
}

/** A cleanroom's process tools in their bays and the hoist rail down every aisle: scenery, the world does not model them. */
function bay(k: Kit, s: RoomScene): void {
  if (!s.bay) return;
  const { b, m } = k;
  const bodies = [m.white, m.galv, m.solid("#dfe8ec", 0.6, 0.1)];
  const rail = m.solid("#f2b134", 0.6, 0.2);
  const y = s.floorY;
  for (const t of s.bay.tools) {
    const body = bodies[Math.min(bodies.length - 1, Math.floor(t.tone * bodies.length))] ?? m.white;
    b.box(body, { x: t.x, z: t.z, w: t.w, d: t.d, h: t.h, y, round: 0.08 });
    b.box(m.dark, {
      x: t.x,
      z: t.z,
      w: t.w * 0.7,
      d: t.d * 0.6,
      h: 0.25,
      y: y + t.h,
      shadow: false,
    });
    b.box(m.solid("#4f86b8", 0.6, 0.1), {
      x: t.x,
      z: t.z + t.d / 2 + 0.02,
      w: t.w * 0.8,
      d: 0.04,
      h: 0.35,
      y: y + 1.2,
      shadow: false,
    });
  }
  for (const r of s.bay.rails) {
    b.box(rail, {
      x: (r.x0 + r.x1) / 2,
      z: r.z,
      w: r.x1 - r.x0,
      d: 0.16,
      h: 0.1,
      y: y + 3.4,
      shadow: false,
    });
    for (let x = r.x0 + 2; x < r.x1; x += 8)
      b.box(m.steel, {
        x,
        z: r.z,
        w: 0.05,
        d: 0.05,
        h: ROOM_HEIGHT_M - 3.5,
        y: y + 3.5,
        shadow: false,
      });
  }
}

function trim(k: Kit, s: RoomScene): void {
  const { b, m } = k;
  const colour = s.mode ? world3d.MODE_COLORS[s.mode] : world3d.PURPOSE_COLORS[s.purpose];
  const mat = m.solid(colour ?? "#9a8f7c", 0.7, 0);
  const t = 0.16;
  // A moulding lies just inside every side of the outline.
  for (const side of sidesOf(world3d.outlineOfScene(s)))
    b.box(mat, { ...band(side, t, 1), h: 0.03, y: s.floorY, shadow: false });
}

/** The walls follow the outline: a curb with a glass band above, outside each side, closing the convex corners. */
function walls(k: Kit, s: RoomScene): void {
  const { b, m } = k;
  for (const side of sidesOf(world3d.outlineOfScene(s))) {
    const { x, z, w, d } = band(side, WALL_M, -1, WALL_M);
    b.box(m.wall, { x, z, w, d, h: CURB_M, tile: 16 });
    b.box(m.trim, { x, z, w: w + 0.04, d: d + 0.04, h: 0.06, y: CURB_M });
    b.box(m.glassPane, {
      x,
      z,
      w: w * 0.99,
      d: d * 0.5,
      h: ROOM_HEIGHT_M - CURB_M,
      y: CURB_M + 0.06,
      shadow: false,
    });
  }
}

function columns(k: Kit, s: RoomScene): void {
  for (const c of s.columns)
    k.b.box(k.m.trim, { x: c.x, z: c.z, w: 0.5, d: 0.5, h: ROOM_HEIGHT_M, round: 0.05 });
}

const aisleBox = (e: { x0: number; x1: number; z0: number; z1: number }) => ({
  x: (e.x0 + e.x1) / 2,
  z: (e.z0 + e.z1) / 2,
  w: e.x1 - e.x0,
  d: e.z1 - e.z0,
});

/** The floor of each aisle: perforated tiles in a cold one, a warm floor in a hot one. */
function podFloors(k: Kit, s: RoomScene): void {
  const { b, m } = k;
  for (const pod of s.pods) {
    const cold = pod.aisle === "cold";
    b.sheet(cold ? m.coldTiles : m.hot, {
      ...aisleBox(pod.enclosure),
      y: RAISED_FLOOR_M + 0.012,
      tile: cold ? 0.6 : undefined,
    });
  }
}

/** Containment: a roof over each aisle, end doors and posts. */
function podCover(k: Kit, s: RoomScene): void {
  const { b, m } = k;
  for (const pod of s.pods) {
    const e = pod.enclosure;
    const at = aisleBox(e);
    b.box(pod.aisle === "cold" ? m.cold : m.hot, {
      ...at,
      h: 0.05,
      y: RAISED_FLOOR_M + POD_H_M,
      shadow: false,
    });
    for (const ex of [e.x0, e.x1]) {
      b.box(m.ghost, {
        x: ex,
        z: at.z,
        w: 0.04,
        d: at.d,
        h: POD_H_M - 0.1,
        y: RAISED_FLOOR_M,
        shadow: false,
      });
      for (const ez of [e.z0, e.z1])
        b.box(m.dark, { x: ex, z: ez, w: 0.07, d: 0.07, h: POD_H_M, y: RAISED_FLOOR_M });
    }
  }
}

/** Busway over each row of racks, with a cable tray beside it, hung from the slab above. */
function overhead(k: Kit, s: RoomScene): void {
  const { b, m } = k;
  for (const row of s.rows) {
    const w = row.x1 - row.x0;
    const x = (row.x0 + row.x1) / 2;
    b.box(m.power, { x, z: row.z, w, d: 0.3, h: 0.2, y: BUSWAY_Y, round: 0.04 });
    b.box(m.tray, { x, z: row.z + 0.55, w, d: 0.4, h: 0.07, y: BUSWAY_Y - 0.4 });
    for (let hx = row.x0 + 1; hx < row.x1; hx += 3)
      b.box(m.steel, {
        x: hx,
        z: row.z,
        w: 0.04,
        d: 0.04,
        h: ROOM_HEIGHT_M - BUSWAY_Y - 0.2,
        y: BUSWAY_Y + 0.2,
        shadow: false,
      });
  }
  for (const p of s.pipes) b.pipe(p.kind === "supply" ? m.supply : m.returning, p.a, p.b, 0.07);
}

/** The red sprinkler main along the back wall, with a head every few metres. */
function sprinkler(k: Kit, s: RoomScene): void {
  const { b, m } = k;
  const red = m.solid("#d9433a", 0.5, 0.1);
  const wall = world3d.backWall(s);
  b.pipe(
    red,
    [wall.x0 + 0.3, ROOM_HEIGHT_M - 0.3, wall.z + 0.4],
    [wall.x1 - 0.3, ROOM_HEIGHT_M - 0.3, wall.z + 0.4],
    0.06,
    {
      shadow: false,
    },
  );
  for (let x = wall.x0 + 3; x < wall.x1 - 1; x += 6)
    b.cyl(red, {
      x,
      z: wall.z + 0.4,
      r: 0.04,
      h: 0.25,
      y: ROOM_HEIGHT_M - 0.55,
      seg: 6,
      shadow: false,
    });
}

/** Build one room into the floor, in the room's own place. */
export function buildRoom(ctx: FloorCtx, room: PlacedRoom): void {
  const { k, cover, fleet } = ctx;
  const s = room.scene;
  cover.b.frame(room.x, room.z, 0, () => {
    walls(cover, s);
    podCover(cover, s);
  });
  k.b.frame(room.x, room.z, 0, () => {
    floor(k, s);
    trim(k, s);
    columns(k, s);
    podFloors(k, s);
    overhead(k, s);
    sprinkler(k, s);
    bay(k, s);
    for (const e of s.equipment) if (e.style !== "busway") indoorEquip(k, e);
  });
  for (const set of s.sets) fleet.add(set, { x: room.x, y: 0, z: room.z });
}
