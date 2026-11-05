/**
 * People in the server room (REQ-074, ADR-0078): one or two engineers who walk the aisles, a manager
 * at the desk of a control room (or by the door), and a technician who comes in when something big
 * stays broken. Like the visitors of the site (`life.ts`) where each stands is a function of the time,
 * so nothing is kept in step; unlike them it also reads the world: an alarm on a machine, or a run that
 * acted on one, sends the nearest engineer there on foot, and the person works in front of it until it
 * clears. They are scenery: nothing here changes the world. This file makes the people of a room; what
 * they do is in `crew-plan.ts`.
 */
import {
  type Aisle,
  aislesOf,
  equipBlocks,
  Grid,
  onAisle,
  podBlocks,
  polyOf,
  rackBlocks,
} from "./crew-route";
import type { Crew, CrewPerson, CrewRole, Desk, Dev } from "./crew-types";
import { type Bounds, type Pt, unit } from "./plan";
import type { RoomScene } from "./room";

export { crewAt, nextWorld, spotOf } from "./crew-plan";
export {
  type Crew,
  type CrewActivity,
  type CrewAlarm,
  type CrewOptions,
  type CrewPerson,
  type CrewPose,
  type CrewRole,
  type CrewSituation,
  type CrewState,
  type CrewWorld,
  type Desk,
  NO_TROUBLE,
  TECHNICIAN_AFTER_S,
  WALK_MPS,
} from "./crew-types";

const MAX_PEOPLE = 4;
const DESK: Desk = { x: 0, z: 0, w: 1.6, d: 0.8 };

function deskOf(scene: RoomScene, grid: Grid): Desk | undefined {
  if (scene.purpose !== "noc") return undefined;
  const r = scene.rects?.[0] ?? { x0: 0, z0: 0, x1: scene.w, z1: scene.d };
  for (let x = r.x0 + 1.6; x < r.x1 - 1.6; x += 1.2)
    for (let z = r.z0 + 1; z < Math.min(r.z1 - 1, r.z0 + 4); z += 0.6)
      if ([-0.8, 0, 0.8].every((o) => grid.free(x + o, z)) && grid.free(x, z + 1))
        return { ...DESK, x, z };
  return undefined;
}

function doorOf(scene: RoomScene, grid: Grid): Pt {
  const rects = scene.rects ?? [{ x0: 0, z0: 0, x1: scene.w, z1: scene.d }];
  const low = [...rects].sort((p, q) => q.z1 - p.z1)[0] as Bounds;
  const mid = (low.x0 + low.x1) / 2;
  for (let off = 0; off < (low.x1 - low.x0) / 2; off += 0.3)
    for (const x of [mid + off, mid - off])
      for (const back of [0.5, 0.9, 1.4])
        if (grid.free(x, low.z1 - back)) return { x, z: low.z1 - back };
  return { x: mid, z: low.z1 - 0.5 };
}

const free = (grid: Grid, p: Pt, fallback: Pt): Pt => {
  for (const [dx, dz] of [
    [0, 0],
    [1.2, -0.6],
    [-1.2, -0.6],
    [2.4, -1],
    [-2.4, -1],
  ] as const)
    if (grid.free(p.x + dx, p.z + dz)) return { x: p.x + dx, z: p.z + dz };
  return fallback;
};

function people(
  scene: RoomScene,
  grid: Grid,
  aisles: readonly Aisle[],
  seed: number,
): CrewPerson[] {
  const door = doorOf(scene, grid);
  const desk = deskOf(scene, grid);
  const out: CrewPerson[] = [];
  const count = aisles.length >= 2 && scene.purpose === "data_hall" ? 2 : 1;
  const base = (id: number, role: CrewRole): Omit<CrewPerson, "home" | "homeRot" | "sits"> => ({
    id,
    role,
    tone: unit(id * 7 + seed, 13),
    speed: 1 + unit(id, seed + 1) * 0.3,
    dwell: 3 + unit(id + 5, seed + 2) * 7,
    offset: unit(id * 3, seed + 3) * 600,
  });
  for (let k = 0; k < count; k++) {
    const line = aisles[Math.min(aisles.length - 1, Math.floor((k * aisles.length) / count))];
    const home = line ? onAisle(line, door) : door;
    out.push({
      ...base(out.length, "engineer"),
      ...(line ? { patrol: polyOf([line.a, line.b]) } : {}),
      home,
      homeRot: 0,
      sits: false,
    });
  }
  out.push(
    desk
      ? {
          ...base(out.length, "manager"),
          home: { x: desk.x, z: desk.z + desk.d / 2 + 0.35 },
          homeRot: Math.PI,
          sits: true,
        }
      : {
          ...base(out.length, "manager"),
          home: free(grid, { x: door.x + 1.4, z: door.z - 0.9 }, door),
          homeRot: Math.PI,
          sits: false,
        },
  );
  out.push({ ...base(out.length, "technician"), home: door, homeRot: Math.PI, sits: false });
  return out.slice(0, MAX_PEOPLE);
}

function devicesOf(scene: RoomScene): Map<string, Dev> {
  const out = new Map<string, Dev>();
  for (const set of scene.sets)
    for (const [i, id] of set.ids.entries()) {
      const turn = Math.abs(Math.sin(set.at[i * 4 + 3] as number)) > 0.7;
      out.set(id, {
        x: set.at[i * 4] as number,
        z: set.at[i * 4 + 2] as number,
        w: turn ? set.kind.d : set.kind.w,
        d: turn ? set.kind.w : set.kind.d,
        rack: true,
      });
    }
  for (const e of scene.equipment)
    if (e.style !== "busway") out.set(e.id, { x: e.x, z: e.z, w: e.w, d: e.d, rack: false });
  return out;
}

/** The people of a room: at most four, and the same people every time for the same room and seed. */
export function crewOf(scene: RoomScene, seed = 7): Crew {
  const grid = new Grid(scene, [...rackBlocks(scene), ...equipBlocks(scene), ...podBlocks(scene)]);
  const desk = deskOf(scene, grid);
  if (desk)
    grid.block({
      x0: desk.x - desk.w / 2,
      z0: desk.z - desk.d / 2,
      x1: desk.x + desk.w / 2,
      z1: desk.z + desk.d / 2,
    });
  const aisles = aislesOf(scene, grid, rackBlocks(scene));
  return {
    scene,
    people: people(scene, grid, aisles, seed),
    door: doorOf(scene, grid),
    ...(desk ? { desk } : {}),
    grid,
    aisles,
    devices: devicesOf(scene),
    spots: new Map(),
  };
}
