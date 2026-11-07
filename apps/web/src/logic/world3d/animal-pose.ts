/**
 * Where a clicked cat or bird is while it answers (REQ-105, ADR-0128). The animal's own day is a function
 * of time (`poseAt`); an answer holds that clock still, plays `reactionOf` in the
 * animal's own frame on top of the held pose, and when it is over lets the day go on from where it was held.
 * A cat ends where it started. A bird ends a couple of metres away, and stays there.
 */
import {
  BIRD_LAND_M,
  CAT_WALK_M,
  type ReactiveKind,
  reactionOf,
  totalOf,
  walkDir,
} from "./animal-react";
import type { CampusPlan } from "./campus-plan-types";
import { type Agent, type LifePose, poseAt } from "./life";

interface Poke {
  readonly kind: ReactiveKind;
  readonly start: number;
  /** The animal's own clock when it was clicked. */
  readonly held: number;
  readonly heading: number;
  readonly dir: number;
  /** 0 when there was nowhere to walk to: the cat then answers on the spot. */
  readonly reach: number;
}

/** An animal as it is drawn: the pose of the body, how far it is off the ground, tilted, and the swing of its tail and wings. */
export interface Placed {
  readonly x: number;
  readonly z: number;
  readonly rot: number;
  readonly moving: boolean;
  readonly phase: number;
  readonly y: number;
  readonly pitch: number;
  readonly tail: number;
  readonly flap: number;
  readonly sit: number;
  readonly answering: boolean;
}

const lerpAngle = (a: number, b: number, k: number): number => {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * k;
};

export class Reactions {
  private readonly pokes = new Map<number, Poke>();
  private readonly held = new Map<number, number>();
  private readonly moved = new Map<number, { x: number; z: number }>();

  constructor(private readonly plan: CampusPlan) {}

  get busy(): boolean {
    return this.pokes.size > 0;
  }

  /** Start an answer; with less motion there is nothing to play, so nothing starts. */
  start(a: Agent, now: number, calm: boolean): boolean {
    if ((a.kind !== "cat" && a.kind !== "bird") || this.pokes.has(a.id)) return false;
    if (calm) return true;
    const kind = a.kind;
    const here = this.base(a, now);
    const metres = kind === "cat" ? CAT_WALK_M : BIRD_LAND_M;
    const dir = walkDir(this.plan, here, here.rot, metres);
    this.pokes.set(a.id, {
      kind,
      start: now,
      held: now - (this.held.get(a.id) ?? 0),
      heading: here.rot,
      dir: dir ?? here.rot,
      reach: dir === undefined && kind === "cat" ? 0 : 1,
    });
    return true;
  }

  private base(a: Agent, t: number): LifePose {
    const p = poseAt(a, t - (this.held.get(a.id) ?? 0));
    const away = this.moved.get(a.id);
    return away ? { ...p, x: p.x + away.x, z: p.z + away.z } : p;
  }

  private finish(a: Agent, poke: Poke, now: number): void {
    this.pokes.delete(a.id);
    this.held.set(a.id, (this.held.get(a.id) ?? 0) + (now - poke.start));
    if (poke.kind === "bird") {
      const was = this.moved.get(a.id) ?? { x: 0, z: 0 };
      this.moved.set(a.id, {
        x: was.x + Math.sin(poke.dir) * BIRD_LAND_M,
        z: was.z + Math.cos(poke.dir) * BIRD_LAND_M,
      });
    }
  }

  /** The animal at time `t`: its day, or its day held still with the answer on top. */
  placed(a: Agent, t: number): Placed {
    const poke = this.pokes.get(a.id);
    if (poke && t - poke.start >= totalOf(poke.kind, false)) this.finish(a, poke, t);
    const live = this.pokes.get(a.id);
    if (!live)
      return { ...this.base(a, t), y: 0, pitch: 0, tail: 0, flap: 0, sit: 0, answering: false };
    const f = reactionOf(live.kind, t - live.start, false);
    const origin = poseAt(a, live.held);
    const away = this.moved.get(a.id) ?? { x: 0, z: 0 };
    const fx = Math.sin(live.dir);
    const fz = Math.cos(live.dir);
    const k = live.reach;
    return {
      x: origin.x + away.x + (fx * f.forward + fz * f.side) * k,
      z: origin.z + away.z + (fz * f.forward - fx * f.side) * k,
      rot: lerpAngle(live.heading, live.dir, f.facing) + f.yaw + Math.PI * f.reverse,
      moving: f.phase === "walk" || f.phase === "return",
      phase: f.forward * 2,
      y: f.y,
      pitch: f.pitch,
      tail: f.tail,
      flap: f.flap,
      sit: f.sit,
      answering: true,
    };
  }
}
