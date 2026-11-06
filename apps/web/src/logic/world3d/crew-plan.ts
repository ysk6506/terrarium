/**
 * What the people of a room do (REQ-074, ADR-0078): each alarm on a machine, and each run that acted on one,
 * sends the nearest free engineer there on foot; a long critical alarm brings the technician from the door;
 * when it is over everyone walks back. All of it is a function of the clock and of the state of the world, so
 * nothing is kept in step. Plans are worked out once for each state and remembered only to save the work.
 */
import { along, onAisle, type Poly, routeOf } from "./crew-route";
import {
  type Crew,
  type CrewOptions,
  type CrewPerson,
  type CrewSituation,
  type CrewState,
  type CrewWorld,
  NO_TROUBLE,
  TECHNICIAN_AFTER_S,
  WALK_MPS,
} from "./crew-types";
import type { Pt } from "./plan";

const gap = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.z - b.z);

/** The spot in front of a machine where a person stands to work on it; `other` is the spot of a second person, beside the first. */
export function spotOf(crew: Crew, id: string, other = false): Pt | undefined {
  const dev = crew.devices.get(id);
  if (!dev) return undefined;
  const key = other ? `${id}#2` : id;
  const known = crew.spots.get(key);
  if (known) return known;
  const near = crew.aisles.map((a) => onAisle(a, dev)).sort((p, q) => gap(p, dev) - gap(q, dev))[0];
  const sides: Pt[] = [
    { x: dev.x, z: dev.z + dev.d / 2 + 0.8 },
    { x: dev.x, z: dev.z - dev.d / 2 - 0.8 },
    { x: dev.x + dev.w / 2 + 0.8, z: dev.z },
    { x: dev.x - dev.w / 2 - 0.8, z: dev.z },
  ];
  const ordered = near ? [...sides].sort((p, q) => gap(p, near) - gap(q, near)) : sides;
  const first = ordered.find((p) => crew.grid.free(p.x, p.z)) ??
    crew.grid.nearestFree(dev) ?? { x: dev.x, z: dev.z + dev.d / 2 + 0.8 };
  crew.spots.set(id, first);
  let spot = first;
  if (other) {
    const beside = [
      [0.9, 0],
      [-0.9, 0],
      [0, 0.9],
      [0, -0.9],
      [1.5, 0],
      [-1.5, 0],
    ] as const;
    const at = beside
      .map(([dx, dz]) => ({ x: first.x + dx, z: first.z + dz }))
      .find((p) => crew.grid.free(p.x, p.z));
    spot = at ?? { x: first.x + 0.6, z: first.z + 0.6 };
  }
  crew.spots.set(key, spot);
  return spot;
}

interface Task {
  readonly device: string;
  readonly spot: Pt;
  readonly forAgent: boolean;
  readonly critical: boolean;
  readonly ageS: number;
}

/** What needs a person, most pressing first: machines before racks (the cause before what it did), critical before warning, longest first. */
function tasksOf(crew: Crew, world: CrewWorld): Task[] {
  const by = new Map<string, Task>();
  const put = (device: string, agent: boolean, critical: boolean, ageS: number) => {
    const spot = spotOf(crew, device);
    if (!spot) return;
    const old = by.get(device);
    by.set(device, {
      device,
      spot,
      forAgent: agent || (old?.forAgent ?? false),
      critical: critical || (old?.critical ?? false),
      ageS: Math.max(ageS, old?.ageS ?? 0),
    });
  };
  for (const a of world.alarms) put(a.device, false, a.severity === "critical", a.ageS);
  for (const a of world.activity) put(a.device, true, false, 0);
  const rank = (t: Task) => (crew.devices.get(t.device)?.rack ? 1 : 0);
  return [...by.values()].sort(
    (p, q) =>
      rank(p) - rank(q) ||
      Number(q.critical) - Number(p.critical) ||
      q.ageS - p.ageS ||
      p.device.localeCompare(q.device),
  );
}

/** One person's errand: walk the way, then stay. `back` walks to the patrol (or the door) and carries on from there. */
interface Errand {
  readonly kind: "go" | "back";
  readonly way: Poly;
  readonly device?: string;
  readonly forAgent: boolean;
  /** For another team's hand-off (REQ-093). */
  readonly forPartner?: boolean;
  readonly toDoor: boolean;
  /** Seconds the patrol is moved on by when the walk back ends, so the person takes it up where they arrived. */
  readonly shift: number;
}

type Plan = ReadonlyMap<number, Errand>;

const plans = new WeakMap<Crew, WeakMap<CrewWorld, Plan>>();

const mod = (a: number, n: number): number => ((a % n) + n) % n;

type Patrol = { x: number; z: number; rot: number; walking: boolean };

/** Where a person is on a patrol at clock time `t`, heading, and whether walking. */
function patrolAt(p: CrewPerson, t: number, shift = 0): Patrol {
  const line = p.patrol;
  if (!line) return { ...p.home, rot: p.homeRot, walking: false };
  const travel = line.length / p.speed;
  const period = 2 * (travel + p.dwell);
  const tt = mod(t + p.offset + shift, period);
  if (tt < travel) return { ...along(line, tt * p.speed), walking: true };
  if (tt < travel + p.dwell) return { ...along(line, line.length), walking: false };
  if (tt < 2 * travel + p.dwell) {
    const a = along(line, line.length - (tt - travel - p.dwell) * p.speed);
    return { x: a.x, z: a.z, rot: a.rot + Math.PI, walking: true };
  }
  const a = along(line, 0);
  return { x: a.x, z: a.z, rot: a.rot + Math.PI, walking: false };
}

/** The nearest point of a patrol line to a spot, and how far along the line it is. */
function nearestOn(line: Poly, p: Pt): { at: Pt; s: number } {
  const a = line.pts[0] as Pt;
  const b = line.pts[line.pts.length - 1] as Pt;
  const len2 = (b.x - a.x) ** 2 + (b.z - a.z) ** 2 || 1;
  const k = Math.min(
    1,
    Math.max(0, ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / len2),
  );
  return { at: { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k }, s: k * line.length };
}

interface Env {
  readonly crew: Crew;
  readonly world: CrewWorld;
  /** Where each person is, and whether in the room at all, when this state begins. */
  readonly start: (p: CrewPerson) => Pt & { readonly present: boolean };
}

const go = (way: Poly, task: Task | undefined, forAgent = task?.forAgent ?? false): Errand => ({
  kind: "go",
  way,
  ...(task ? { device: task.device } : {}),
  forAgent,
  toDoor: false,
  shift: 0,
});

/** The nearest engineer who is still free goes to each task, the most pressing task first. */
function sendEngineers(env: Env, tasks: readonly Task[], out: Map<number, Errand>): void {
  const { crew, start } = env;
  const free = crew.people.filter((p) => p.role === "engineer");
  for (const task of tasks) {
    const who = free
      .map((p) => ({ p, d: gap(start(p), task.spot) }))
      .sort((a, b) => a.d - b.d || a.p.id - b.p.id)[0];
    if (!who) return;
    free.splice(free.indexOf(who.p), 1);
    const way = routeOf(crew.scene, crew.grid, crew.aisles, start(who.p), task.spot);
    out.set(who.p.id, go(way, task));
  }
}

/** Whoever is away from the patrol and has nothing to do now walks back: to the patrol, or (a technician) out the door. */
function sendBack(env: Env, out: Map<number, Errand>): void {
  const { crew, start } = env;
  const from = env.world.from ?? 0;
  const route = (a: Pt, b: Pt) => routeOf(crew.scene, crew.grid, crew.aisles, a, b);
  for (const p of crew.people) {
    const at = start(p);
    if (out.has(p.id) || p.role === "manager") continue;
    if (p.role === "technician") {
      if (at.present)
        out.set(p.id, {
          kind: "back",
          way: route(at, crew.door),
          forAgent: false,
          toDoor: true,
          shift: 0,
        });
      continue;
    }
    if (gap(at, patrolAt(p, from)) < 0.4) continue;
    const line = p.patrol;
    const dest = line ? nearestOn(line, at) : { at: p.home, s: 0 };
    const way = route(at, dest.at);
    const arrive = from + way.length / WALK_MPS;
    const period = line ? 2 * (line.length / p.speed + p.dwell) : 1;
    const shift = line ? dest.s / p.speed - mod(arrive + p.offset, period) : 0;
    out.set(p.id, { kind: "back", way, forAgent: false, toDoor: false, shift });
  }
}

function build(env: Env): Plan {
  const { crew } = env;
  const out = new Map<number, Errand>();
  const tasks = tasksOf(crew, env.world);
  sendEngineers(env, tasks, out);
  const call = tasks.find((t) => t.critical && t.ageS > TECHNICIAN_AFTER_S);
  const tech = crew.people.find((p) => p.role === "technician");
  const spot = call ? spotOf(crew, call.device, true) : undefined;
  // the hand-off of a team comes first: its engineer is the one who walks in from the door
  const partner = env.world.partners?.find((p) => spotOf(crew, p.device, true));
  const partnerSpot = partner ? spotOf(crew, partner.device, true) : undefined;
  if (partner && tech && partnerSpot)
    out.set(tech.id, {
      ...go(routeOf(crew.scene, crew.grid, crew.aisles, crew.door, partnerSpot), undefined, false),
      device: partner.device,
      forPartner: true,
    });
  else if (call && tech && spot)
    out.set(tech.id, go(routeOf(crew.scene, crew.grid, crew.aisles, crew.door, spot), call, false));
  sendBack(env, out);
  return out;
}

function planOf(crew: Crew, world: CrewWorld): Plan {
  let held = plans.get(crew);
  if (!held) {
    held = new WeakMap();
    plans.set(crew, held);
  }
  const known = held.get(world);
  if (known) return known;
  const earlier = world.before;
  const from = world.from ?? 0;
  const prior = earlier ? planOf(crew, earlier) : undefined;
  const start: Env["start"] = (p) => {
    if (earlier && prior) return stateIn(crew, earlier, prior, p, from, false);
    return p.role === "technician"
      ? { ...crew.door, present: false }
      : { ...patrolAt(p, from), present: true };
  };
  const plan = build({ crew, world, start });
  held.set(world, plan);
  return plan;
}

const stateOf = (
  p: CrewPerson,
  extra: Partial<CrewState> & Pick<CrewState, "x" | "z" | "rot" | "pose" | "situation">,
): CrewState => ({
  id: p.id,
  role: p.role,
  tone: p.tone,
  present: true,
  forAgent: false,
  ...extra,
});

/** A person walking back to the patrol (or out the door), or arrived there. */
function backState(crew: Crew, p: CrewPerson, e: Errand, ctx: Walk): CrewState {
  const tech = p.role === "technician";
  if (!ctx.arrived)
    return stateOf(p, {
      ...ctx.at,
      pose: ctx.still ? "stand" : "walk",
      situation: tech ? "technician" : "patrol",
    });
  if (e.toDoor)
    return stateOf(p, {
      ...crew.door,
      rot: p.homeRot,
      pose: "stand",
      situation: "technician",
      present: false,
    });
  const now = patrolAt(p, ctx.still ? 0 : ctx.t, e.shift);
  return stateOf(p, {
    x: now.x,
    z: now.z,
    rot: now.rot,
    pose: now.walking ? "walk" : "stand",
    situation: "patrol",
  });
}

/** What a person on the way to a machine is doing: going, working there, or doing it for an agent. */
function situationOf(p: CrewPerson, e: Errand, arrived: boolean): CrewSituation {
  if (e.forPartner) return "partner";
  if (e.forAgent) return "agent";
  if (p.role === "technician") return "technician";
  return arrived ? "working" : "going";
}

function goState(crew: Crew, p: CrewPerson, e: Errand, ctx: Walk): CrewState {
  const { at, arrived, still } = ctx;
  const base = {
    ...(e.device ? { device: e.device } : {}),
    forAgent: e.forAgent,
    ...(e.forPartner ? { forPartner: true } : {}),
    situation: situationOf(p, e, arrived),
    x: at.x,
    z: at.z,
  };
  if (!arrived) return stateOf(p, { ...base, rot: at.rot, pose: still ? "stand" : "walk" });
  const dev = e.device ? crew.devices.get(e.device) : undefined;
  const face = dev ? Math.atan2(dev.x - at.x, dev.z - at.z) : at.rot;
  return stateOf(p, { ...base, rot: face, pose: still ? "stand" : "work" });
}

interface Walk {
  readonly at: Pt & { readonly rot: number };
  readonly arrived: boolean;
  readonly still: boolean;
  readonly t: number;
}

function onErrand(
  crew: Crew,
  p: CrewPerson,
  e: Errand,
  t: number,
  world: CrewWorld,
  still: boolean,
): CrewState {
  const walked = still ? e.way.length : Math.max(0, t - (world.from ?? 0)) * WALK_MPS;
  const ctx: Walk = { at: along(e.way, walked), arrived: walked >= e.way.length, still, t };
  return e.kind === "back" ? backState(crew, p, e, ctx) : goState(crew, p, e, ctx);
}

/** One person under one state of the world at clock time `t`. */
function stateIn(
  crew: Crew,
  world: CrewWorld,
  plan: Plan,
  p: CrewPerson,
  t: number,
  still: boolean,
): CrewState {
  const e = plan.get(p.id);
  if (e) return onErrand(crew, p, e, t, world, still);
  if (p.role === "technician")
    return stateOf(p, {
      ...crew.door,
      rot: p.homeRot,
      pose: "stand",
      situation: "technician",
      present: false,
    });
  if (p.role === "manager")
    return stateOf(p, {
      ...p.home,
      rot: p.homeRot,
      pose: p.sits ? "sit" : "stand",
      situation: "manager",
    });
  const now = patrolAt(p, still ? 0 : t);
  return stateOf(p, {
    x: now.x,
    z: now.z,
    rot: now.rot,
    pose: now.walking && !still ? "walk" : "stand",
    situation: "patrol",
  });
}

/** Where everyone is at clock time `t` (seconds), given what is the matter. A pure function of both. */
export function crewAt(
  crew: Crew,
  t: number,
  world: CrewWorld = NO_TROUBLE,
  opts: CrewOptions = {},
): CrewState[] {
  const plan = planOf(crew, world);
  return crew.people.map((p) => stateIn(crew, world, plan, p, t, opts.still ?? false));
}

/** How many earlier states a world remembers, so people walk on from where they were. */
const MEMORY = 4;

/** The state that follows `prev` when the matter changes at clock time `from`. */
export function nextWorld(
  prev: CrewWorld | undefined,
  trouble: Pick<CrewWorld, "alarms" | "activity" | "partners">,
  from: number,
): CrewWorld {
  const keep = (w: CrewWorld | undefined, depth: number): CrewWorld | undefined =>
    w && depth > 0
      ? {
          alarms: w.alarms,
          activity: w.activity,
          ...(w.partners ? { partners: w.partners } : {}),
          ...(w.from === undefined ? {} : { from: w.from }),
          ...(w.before ? { before: keep(w.before, depth - 1) as CrewWorld } : {}),
        }
      : undefined;
  const before = keep(prev, MEMORY);
  return {
    alarms: trouble.alarms,
    activity: trouble.activity,
    ...(trouble.partners ? { partners: trouble.partners } : {}),
    from,
    ...(before ? { before } : {}),
  };
}
