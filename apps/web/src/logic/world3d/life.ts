/**
 * Life on the site (REQ-006, REQ-036): cars, delivery trucks and fuel tankers on the roads, people
 * walking between car park and door, cats on the lawns, water deer and raccoon dogs crossing the grass.
 * A pure plaything: where an agent stands is a function of the time, so there is nothing to keep in
 * step, it costs nothing while nobody watches, and the same land always has the same visitors. Nothing
 * here reads or changes the world; it is scenery with a little charm.
 */

import { standable } from "./campus-plan";
import { type Bounds, boundsOfBox, centreOf, inflate, insidePolygon, type Pt, unit } from "./plan";
import type { SiteScene } from "./site";

export type LifeKind =
  | "sedan"
  | "suv"
  | "van"
  | "truck"
  | "tanker"
  | "person"
  | "cat"
  | "deer"
  | "raccoon"
  | "bird";

export const VEHICLE_KINDS: readonly LifeKind[] = ["sedan", "suv", "van", "truck", "tanker"];
export const isVehicle = (k: LifeKind): boolean => VEHICLE_KINDS.includes(k);

export interface Agent {
  readonly id: number;
  readonly kind: LifeKind;
  /** 0..1: picks the paint or the coat. */
  readonly tone: number;
  readonly path: readonly Pt[];
  /** Cumulative length at each path point, metres. */
  readonly cum: readonly number[];
  readonly length: number;
  readonly speed: number;
  /** Seconds it stands at either end of its path. */
  readonly dwell: number;
  /** Where in its day it starts, seconds. */
  readonly offset: number;
  /** Metres to the right of the path's centre line (traffic keeps right). */
  readonly lane: number;
}

export interface LifePose {
  readonly x: number;
  readonly z: number;
  /** Turn about the vertical axis, radians; 0 faces +z. */
  readonly rot: number;
  readonly moving: boolean;
  /** Metres travelled along the path, for the stride or the wheels. */
  readonly phase: number;
}

export interface LifeOptions {
  readonly seed?: number;
  /** 0..1.5: how busy the place is. */
  readonly density?: number;
}

/** The most agents a site ever gets, whatever its size: the view stays light. */
export const MAX_AGENTS = 140;

interface Spec {
  readonly speed: readonly [number, number];
  readonly dwell: readonly [number, number];
  readonly lane: number;
}

const SPECS: Readonly<Record<LifeKind, Spec>> = {
  sedan: { speed: [6, 9], dwell: [15, 50], lane: 2 },
  suv: { speed: [5.5, 8], dwell: [15, 50], lane: 2 },
  van: { speed: [5, 7.5], dwell: [20, 50], lane: 2 },
  truck: { speed: [4, 6], dwell: [20, 60], lane: 2 },
  tanker: { speed: [3.5, 5], dwell: [30, 80], lane: 2 },
  person: { speed: [1.1, 1.5], dwell: [4, 40], lane: 0 },
  cat: { speed: [0.7, 1.2], dwell: [20, 70], lane: 0 },
  deer: { speed: [1.6, 2.6], dwell: [8, 40], lane: 0 },
  raccoon: { speed: [0.9, 1.5], dwell: [6, 30], lane: 0 },
  bird: { speed: [0.5, 0.9], dwell: [10, 30], lane: 0 },
};

const lerp = (r: readonly [number, number], t: number): number => r[0] + (r[1] - r[0]) * t;

function agentOf(id: number, kind: LifeKind, path: readonly Pt[], seed: number): Agent | undefined {
  if (path.length < 2) return undefined;
  const cum = [0];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1] as Pt;
    const b = path[i] as Pt;
    cum.push((cum[i - 1] as number) + Math.hypot(b.x - a.x, b.z - a.z));
  }
  const length = cum[cum.length - 1] as number;
  if (length < 2) return undefined;
  const spec = SPECS[kind];
  return {
    id,
    kind,
    tone: unit(id * 7 + seed, 13),
    path,
    cum,
    length,
    speed: lerp(spec.speed, unit(id, seed + 1)),
    dwell: lerp(spec.dwell, unit(id + 5, seed + 2)),
    offset: unit(id * 3, seed + 3) * 600,
    lane: spec.lane,
  };
}

/** Where an agent is at time `t` (seconds): out along its path, a pause, back, a pause, again. */
export function poseAt(a: Agent, t: number): LifePose {
  const travel = a.length / a.speed;
  const period = 2 * (travel + a.dwell);
  let tt = (t + a.offset) % period;
  if (tt < 0) tt += period;
  let s = 0;
  let dir: 1 | -1 = -1;
  let moving = false;
  if (tt < travel) {
    s = tt * a.speed;
    dir = 1;
    moving = true;
  } else if (tt < travel + a.dwell) {
    s = a.length;
    dir = 1;
  } else if (tt < 2 * travel + a.dwell) {
    s = a.length - (tt - travel - a.dwell) * a.speed;
    moving = true;
  }
  return place(a, s, dir, moving);
}

/** The point `s` metres along an agent's path. */
function pointAt(a: Agent, s: number): Pt {
  let i = 1;
  while (i < a.cum.length - 1 && (a.cum[i] as number) < s) i++;
  const p0 = a.path[i - 1] as Pt;
  const p1 = a.path[i] as Pt;
  const seg = (a.cum[i] as number) - (a.cum[i - 1] as number);
  const k = seg > 0 ? Math.min(1, Math.max(0, (s - (a.cum[i - 1] as number)) / seg)) : 0;
  return { x: p0.x + (p1.x - p0.x) * k, z: p0.z + (p1.z - p0.z) * k };
}

/** How far ahead and behind the heading is read, so a corner is taken as a curve. */
const LOOK_M = 2.5;
/** Within this distance of either end of its path a vehicle is on the centre line, so turning round is smooth. */
const FADE_M = 6;

function place(a: Agent, s: number, dir: 1 | -1, moving: boolean): LifePose {
  const here = pointAt(a, s);
  const behind = pointAt(a, Math.max(0, s - LOOK_M));
  const ahead = pointAt(a, Math.min(a.length, s + LOOK_M));
  let dx = (ahead.x - behind.x) * dir;
  let dz = (ahead.z - behind.z) * dir;
  const n = Math.hypot(dx, dz) || 1;
  dx /= n;
  dz /= n;
  const lane = a.lane * Math.min(1, Math.min(s, a.length - s) / FADE_M);
  return {
    x: here.x - dz * lane,
    z: here.z + dx * lane,
    rot: Math.atan2(dx, dz),
    moving,
    phase: s,
  };
}

function crosses(a: Pt, b: Pt, boxes: readonly Bounds[]): boolean {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 3);
  for (let i = 0; i <= steps; i++) {
    const x = a.x + ((b.x - a.x) * i) / steps;
    const z = a.z + ((b.z - a.z) * i) / steps;
    if (boxes.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1)) return true;
  }
  return false;
}

/** Whether a straight walk between two points keeps inside the land all the way. */
function stays(a: Pt, b: Pt, outline: readonly Pt[]): boolean {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2);
  for (let i = 0; i <= steps; i++)
    if (
      !insidePolygon(
        { x: a.x + ((b.x - a.x) * i) / steps, z: a.z + ((b.z - a.z) * i) / steps },
        outline,
      )
    )
      return false;
  return true;
}

interface Ctx {
  readonly site: SiteScene;
  readonly solids: readonly Bounds[];
  readonly seed: number;
  readonly out: Agent[];
}

/** Add an agent unless the group it belongs to (which ends at `until` agents) is full. */
function add(ctx: Ctx, kind: LifeKind, path: readonly Pt[], until = MAX_AGENTS): void {
  if (ctx.out.length >= Math.min(until, MAX_AGENTS)) return;
  const a = agentOf(ctx.out.length, kind, path, ctx.seed);
  if (a) ctx.out.push(a);
}

const CAR_KINDS: readonly LifeKind[] = ["sedan", "suv", "sedan", "van"];

/** What drives to a place: fuel tankers to the generators, trucks to plant and docks, cars to the offices. */
function vehiclesFor(ctx: Ctx, count: number, limit: number): void {
  const { site } = ctx;
  const until = ctx.out.length + limit;
  for (const [n, route] of site.roads.routes.entries()) {
    const yard = site.yards.find((y) => y.id === route.id);
    const kinds: LifeKind[] =
      yard?.kind === "generators"
        ? ["tanker"]
        : yard
          ? ["truck", "van"]
          : ["truck", CAR_KINDS[n % CAR_KINDS.length] as LifeKind, "sedan"];
    for (let i = 0; i < count; i++) {
      const kind = kinds[(n + i) % kinds.length] as LifeKind;
      add(ctx, kind, route.line, until);
    }
  }
}

/**
 * A short walk from a building's door toward its car park, and a guard by the gate. They end where the lot begins:
 * a car park (its bays and its lane) is not ground a visitor stands on, so nobody spawns in it and nobody walks across
 * it (REQ-108, ADR-0131).
 */
function peopleFor(ctx: Ctx, perBuilding: number, limit: number): void {
  const { site } = ctx;
  const until = ctx.out.length + limit;
  for (const [n, b] of site.buildings.entries()) {
    const e = site.plan.entrances.find((x) => x.id === b.id);
    const lot = site.plan.parking.find((l) => l.forId === b.id);
    const door: Pt = e ? { x: e.door.x, z: e.door.z } : { x: b.x, z: b.z + b.d / 2 };
    const far: Pt = lot ? centreOf(lot.area) : { x: door.x + 24 * (n % 2 ? 1 : -1), z: door.z + 8 };
    for (let i = 0; i < perBuilding; i++) {
      const side = (unit(n, i) - 0.5) * 6;
      // They start on the apron beside the door, off the road, and walk toward the lot until they reach its edge.
      const from = standableNear(site, { x: door.x + side, z: door.z + 1.2 }, door);
      const end = walkTowards(site, from, { x: far.x + side * 0.4, z: far.z - 4 });
      if (standable(site.plan, from) && Math.hypot(end.x - from.x, end.z - from.z) >= MIN_WALK_M)
        add(ctx, "person", [from, end], until);
    }
  }
  const g = site.gate;
  add(
    ctx,
    "person",
    [
      standableNear(site, { x: g.x + 3, z: g.z - 12 }, g),
      standableNear(site, { x: g.x + 6, z: g.z - 13 }, g),
    ],
    until + 1,
  );
}

/** The shortest walk worth drawing. */
const MIN_WALK_M = 2;

/** The farthest point on the straight way from `a` to `b` that a visitor can stand on, every step of it. */
function walkTowards(site: SiteScene, a: Pt, b: Pt): Pt {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
  let last = a;
  for (let i = 1; i <= steps; i++) {
    const p = { x: a.x + ((b.x - a.x) * i) / steps, z: a.z + ((b.z - a.z) * i) / steps };
    if (!standable(site.plan, p) || !insidePolygon(p, site.outline)) break;
    last = p;
  }
  return last;
}

/** The point if a visitor can stand there, else the nearest ring point around it that they can. */
function standableNear(site: SiteScene, p: Pt, about: Pt): Pt {
  if (standable(site.plan, p)) return p;
  for (let r = 2; r <= 24; r += 2)
    for (let k = 0; k < 12; k++) {
      const q = {
        x: p.x + Math.cos((k * Math.PI) / 6) * r,
        z: p.z + Math.sin((k * Math.PI) / 6) * r,
      };
      if (standable(site.plan, q) && insidePolygon(q, site.outline)) return q;
    }
  return about;
}

/** Whether a walk from one point to the other is over ground a visitor may stand on, all the way. */
function clearWalk(site: SiteScene, a: Pt, b: Pt): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
  for (let i = 0; i <= steps; i++) {
    const p = { x: a.x + ((b.x - a.x) * i) / steps, z: a.z + ((b.z - a.z) * i) / steps };
    if (!standable(site.plan, p) || !insidePolygon(p, site.outline)) return false;
  }
  return true;
}

function catsFor(ctx: Ctx, count: number, limit: number): void {
  const until = ctx.out.length + limit;
  for (const [n, b] of ctx.site.buildings.entries()) {
    if (n % 2 === 1 && count < 2) continue;
    // A cat lies on the grass at a corner of the building, never on the road or in the lot, and its
    // short stroll stays on grass too.
    const want = { x: b.x + b.w / 2 + 4, z: b.z + b.d / 2 + 4 };
    const corner = standableNear(ctx.site, want, want);
    const steps = [
      { x: 6, z: 2 + unit(n, 4) * 5 },
      { x: -6, z: 2 + unit(n, 4) * 5 },
      { x: 2, z: 6 },
      { x: 2, z: -6 },
    ];
    const to = steps
      .map((d) => ({ x: corner.x + d.x, z: corner.z + d.z }))
      .find((q) => clearWalk(ctx.site, corner, q));
    if (to) add(ctx, "cat", [corner, to], until);
  }
}

/** Two or three small birds hopping on the lawn near the trees, each on ground it may stand on. */
function birdsFor(ctx: Ctx, count: number): void {
  // Birds live near the buildings, where someone can see them.
  const around = inflate(ctx.site.cluster, 90);
  const near = ctx.site.trees.filter(
    (t) => t.x > around.x0 && t.x < around.x1 && t.z > around.z0 && t.z < around.z1,
  );
  if (near.length === 0) return;
  for (let n = 0; n < count; n++) {
    for (let attempt = 0; attempt < 16; attempt++) {
      const t = near[Math.floor(unit(n + 71, attempt) * near.length)] as Pt;
      const a = unit(n, attempt + 9) * Math.PI * 2;
      const from = { x: t.x + Math.cos(a) * 3.5, z: t.z + Math.sin(a) * 3.5 };
      const to = { x: from.x + Math.cos(a + 1) * 3, z: from.z + Math.sin(a + 1) * 3 };
      if (!clearWalk(ctx.site, from, to) || crosses(from, to, ctx.solids)) continue;
      add(ctx, "bird", [from, to]);
      break;
    }
  }
}

/** Water deer and raccoon dogs patrol between trees, never through a building. */
function wildlifeFor(ctx: Ctx, deer: number, raccoons: number): void {
  const trees = ctx.site.trees;
  if (trees.length < 3) return;
  const kinds: LifeKind[] = [...Array(deer).fill("deer"), ...Array(raccoons).fill("raccoon")];
  for (const [n, kind] of kinds.entries()) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const a = trees[Math.floor(unit(n, attempt) * trees.length)] as Pt;
      const near = trees.filter((t) => Math.hypot(t.x - a.x, t.z - a.z) < 50 && t !== a);
      const b = near[Math.floor(unit(n + 31, attempt) * near.length)];
      const c = near[Math.floor(unit(n + 63, attempt) * near.length)];
      if (!b || !c) continue;
      const path = [a, b, c];
      if (crosses(a, b, ctx.solids) || crosses(b, c, ctx.solids)) continue;
      if (!stays(a, b, ctx.site.outline) || !stays(b, c, ctx.site.outline)) continue;
      add(ctx, kind, path);
      break;
    }
  }
}

/** The visitors of a site. */
export function lifeOf(site: SiteScene, opts: LifeOptions = {}): Agent[] {
  const density = Math.max(0, Math.min(1.5, opts.density ?? 1));
  const solids = [
    ...site.buildings.map((b) => inflate(boundsOfBox(b), 3)),
    ...site.yards.map((y) => inflate(y.area, 2)),
  ];
  const ctx: Ctx = { site, solids, seed: opts.seed ?? 11, out: [] };
  if (density === 0 || site.buildings.length + site.yards.length === 0) return [];
  vehiclesFor(ctx, density >= 1 ? 2 : 1, 60);
  peopleFor(ctx, Math.max(1, Math.round(2 * density)), 30);
  catsFor(ctx, Math.round(2 * density), 12);
  const size = Math.min(8, 2 + Math.floor(site.trees.length / 300));
  wildlifeFor(ctx, Math.round(size * density), Math.round(size * 0.8 * density));
  birdsFor(ctx, Math.round((2 + (site.trees.length > 600 ? 1 : 0)) * Math.min(1, density) + 0.01));
  return ctx.out;
}
