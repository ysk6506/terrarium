/**
 * How a cat or a bird answers a click (REQ-105, ADR-0128): a small state machine that is a pure function of
 * the seconds since the click. The cat stretches with its tail swishing, meows, walks a few metres, sits,
 * and walks back to where it was; the bird flaps up about 3 m, circles once and lands close by. With less
 * motion asked for nothing moves and the answer is the sound and the one-line text alone. Nothing here
 * touches the world: it is the plaything of the site layer.
 */
import { standable } from "./campus-plan";
import type { CampusPlan } from "./campus-plan-types";
import type { Pt } from "./plan";

export type ReactiveKind = "cat" | "bird";

export type CatPhase = "idle" | "stretch" | "meow" | "walk" | "sit" | "return";
export type BirdPhase = "idle" | "flap" | "circle" | "land";
export type Phase = CatPhase | BirdPhase;

/** Seconds of each phase of a cat's answer, in order. */
export const CAT_TIMES = { stretch: 1.2, meow: 0.6, walk: 2.4, sit: 3, return: 2.4 } as const;
/** Seconds of each phase of a bird's answer, in order. */
export const BIRD_TIMES = { flap: 1, circle: 2.4, land: 1.2 } as const;
/** How far a cat walks before it sits, metres. */
export const CAT_WALK_M = 3;
/** How high a bird climbs, and the radius of its circle, metres. */
export const BIRD_RISE_M = 3;
export const BIRD_RADIUS_M = 2.5;
/** How far from where it rose a bird lands, metres. */
export const BIRD_LAND_M = 2;
/** How long the one-line text stays, seconds. */
export const SAY_S = 2;

export const TEXT: Readonly<Record<ReactiveKind, string>> = { cat: "야옹", bird: "짹" };

/** The pose of an animal relative to where it was when it was clicked, in its own frame (z forward). */
export interface Frame {
  readonly phase: Phase;
  /** Metres along the walking direction, and to its left. */
  readonly forward: number;
  readonly side: number;
  readonly y: number;
  /** Nose down (radians, positive) or up (negative). */
  readonly pitch: number;
  /** Extra turn about the vertical axis, radians. */
  readonly yaw: number;
  /** 0: still faces the way it was facing, 1: faces the way it walks. */
  readonly facing: number;
  /** 0..1: turned right round to come back. */
  readonly reverse: number;
  /** Tail swing, radians. */
  readonly tail: number;
  /** Wing swing, radians. */
  readonly flap: number;
  /** 0..1: how far down into a sit. */
  readonly sit: number;
  readonly done: boolean;
}

const REST: Frame = {
  phase: "idle",
  forward: 0,
  side: 0,
  y: 0,
  pitch: 0,
  yaw: 0,
  facing: 0,
  reverse: 0,
  tail: 0,
  flap: 0,
  sit: 0,
  done: true,
};

const smooth = (u: number): number => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
};

/** Seconds a whole answer lasts; none when motion is reduced. */
export function totalOf(kind: ReactiveKind, calm: boolean): number {
  if (calm) return 0;
  const times = kind === "cat" ? CAT_TIMES : BIRD_TIMES;
  return Object.values(times).reduce((a, b) => a + b, 0);
}

function catFrame(t: number): Frame {
  const { stretch, meow, walk, sit } = CAT_TIMES;
  const swish = Math.sin(t * 9) * 0.7;
  if (t < stretch) {
    const u = t / stretch;
    return {
      ...REST,
      phase: "stretch",
      pitch: 0.4 * Math.sin(Math.PI * u),
      tail: swish,
      done: false,
    };
  }
  if (t < stretch + meow) {
    const u = (t - stretch) / meow;
    return {
      ...REST,
      phase: "meow",
      pitch: -0.25 * Math.sin(Math.PI * u),
      tail: swish,
      done: false,
    };
  }
  const w0 = stretch + meow;
  if (t < w0 + walk) {
    const u = (t - w0) / walk;
    return {
      ...REST,
      phase: "walk",
      forward: CAT_WALK_M * smooth(u),
      y: 0.05 * Math.abs(Math.sin(u * 14)),
      facing: smooth(u * 6),
      tail: Math.sin(t * 3) * 0.2,
      done: false,
    };
  }
  const s0 = w0 + walk;
  if (t < s0 + sit) {
    const u = (t - s0) / sit;
    return {
      ...REST,
      phase: "sit",
      forward: CAT_WALK_M,
      facing: 1,
      sit: smooth(u * 4) * smooth((1 - u) * 4),
      tail: Math.sin(t * 2) * 0.3,
      done: false,
    };
  }
  const r0 = s0 + sit;
  if (t < r0 + CAT_TIMES.return) {
    const u = (t - r0) / CAT_TIMES.return;
    return {
      ...REST,
      phase: "return",
      forward: CAT_WALK_M * (1 - smooth(u)),
      y: 0.05 * Math.abs(Math.sin(u * 14)),
      facing: 1,
      reverse: smooth(u * 8) * smooth((1 - u) * 8),
      tail: Math.sin(t * 3) * 0.2,
      done: false,
    };
  }
  return REST;
}

function birdFrame(t: number): Frame {
  const { flap, circle, land } = BIRD_TIMES;
  const beat = Math.sin(t * 38) * 0.9;
  if (t < flap) {
    const u = smooth(t / flap);
    return {
      ...REST,
      phase: "flap",
      y: BIRD_RISE_M * u,
      pitch: -0.3,
      flap: beat,
      facing: 1,
      done: false,
    };
  }
  if (t < flap + circle) {
    const u = (t - flap) / circle;
    const a = 2 * Math.PI * u;
    return {
      ...REST,
      phase: "circle",
      forward: BIRD_RADIUS_M * Math.sin(a),
      side: BIRD_RADIUS_M * (1 - Math.cos(a)),
      y: BIRD_RISE_M + 0.15 * Math.sin(a * 3),
      yaw: -a,
      flap: Math.sin(t * 20) * 0.7,
      facing: 1,
      done: false,
    };
  }
  if (t < flap + circle + land) {
    const u = (t - flap - circle) / land;
    return {
      ...REST,
      phase: "land",
      forward: BIRD_LAND_M * smooth(u),
      y: BIRD_RISE_M * (1 - smooth(u)),
      pitch: 0.25 * (1 - u),
      flap: Math.sin(t * 30) * 0.9 * (1 - u * 0.7),
      facing: 1,
      done: false,
    };
  }
  return { ...REST, forward: BIRD_LAND_M, facing: 1 };
}

/** The frame of an answer `t` seconds after the click; a still, finished one when motion is reduced or it is over. */
export function reactionOf(kind: ReactiveKind, t: number, calm: boolean): Frame {
  if (calm || t < 0) return REST;
  if (t >= totalOf(kind, false))
    return kind === "bird" ? { ...REST, forward: BIRD_LAND_M, facing: 1 } : REST;
  return kind === "cat" ? catFrame(t) : birdFrame(t);
}

/** When, after the click, the sound starts and the text shows; and the text. */
export interface Cues {
  readonly soundAt: number;
  readonly textAt: number;
  readonly textFor: number;
  readonly text: string;
}

export function cuesOf(kind: ReactiveKind, calm: boolean): Cues {
  // A cat meows after its stretch; with less motion there is no stretch to wait for.
  const at = kind === "cat" && !calm ? CAT_TIMES.stretch : 0;
  return { soundAt: at, textAt: at, textFor: SAY_S, text: TEXT[kind] };
}

const SAMPLES_M = 0.5;

/**
 * A direction (radians, 0 faces +z) in which an animal can walk `metres` over ground it may stand on, trying
 * the way it faces first, then to either side, then back; none when it is boxed in.
 */
export function walkDir(
  plan: CampusPlan,
  from: Pt,
  facing: number,
  metres: number,
): number | undefined {
  for (const turn of [0, Math.PI / 2, -Math.PI / 2, Math.PI / 4, -Math.PI / 4, Math.PI]) {
    const a = facing + turn;
    let ok = true;
    for (let d = SAMPLES_M; d <= metres + 1e-9 && ok; d += SAMPLES_M)
      ok = standable(plan, { x: from.x + Math.sin(a) * d, z: from.z + Math.cos(a) * d }, 0.6);
    if (ok) return a;
  }
  return undefined;
}
