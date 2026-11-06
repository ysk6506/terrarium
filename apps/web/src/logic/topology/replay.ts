/**
 * The calculation of the time bar and the agent's pulse (REQ-078 step 2, ADR-0084 items 5 and 8). One bar serves the
 * run page, the result page, the side-by-side view and the builder's "돌려 보기": it is a position in seconds on a
 * line with up to five kinds of marks, and it moves by the clock, by the keys and by a drag. The functions are
 * pure so that a test can read every rule.
 */
import type { Catalog } from "@terrarium/core/catalog";
import type { RunWho } from "@terrarium/core/contract";
import {
  callLabel,
  callWhen,
  clockText,
  impactOf,
  type Mark,
  type ReplayState,
  replaySource,
  restingSource,
  type ServersMoved,
  spanOf,
  stateAt,
  type TopologySource,
} from "@terrarium/core/topology";
import type { BlueprintIndex, RunEvent, ToolEvent } from "@terrarium/core/world";

/** World seconds that pass in one real second; ten by default (a nine-minute run plays in under a minute). */
export const SPEEDS: readonly number[] = [5, 10, 30, 60];
export const DEFAULT_SPEED = 10;
/** How long the ring and the bubble stay after a call; the "touching" state stays until the next call. */
export const PULSE_MS = 3000;
/** Seconds one arrow key moves the bar. */
export const KEY_STEP_S = 5;

/** The words a screen reader gets for the bar: "4분 20초 / 9분 30초". */
export const valueText = (t: number, duration: number): string =>
  `${clockText(t)} / ${clockText(duration)}`;

export const clamp = (t: number, duration: number): number => Math.max(0, Math.min(duration, t));

/** Where the bar goes for a key: the arrows by a step, Home and End to the ends; nothing for any other key. */
export function keyedT(
  key: string,
  t: number,
  duration: number,
  step = KEY_STEP_S,
): number | undefined {
  if (key === "ArrowRight" || key === "ArrowUp") return clamp(t + step, duration);
  if (key === "ArrowLeft" || key === "ArrowDown") return clamp(t - step, duration);
  if (key === "Home") return 0;
  if (key === "End") return duration;
  return undefined;
}

/** Where on the line (0 to 1) a pointer at `x` is, for a line that starts at `left` and is `width` wide. */
export const ratioOf = (x: number, left: number, width: number): number =>
  width <= 0 ? 0 : Math.max(0, Math.min(1, (x - left) / width));

/** The bar after `ms` of the clock at `speed`: where it is and whether it ran out. */
export function advance(
  t: number,
  ms: number,
  speed: number,
  duration: number,
): { readonly t: number; readonly done: boolean } {
  const next = t + (ms / 1000) * speed;
  return next >= duration ? { t: duration, done: true } : { t: next, done: false };
}

/** The share of the line (0 to 100) a moment is at. */
export const pct = (t: number, duration: number): number =>
  duration <= 0 ? 0 : Math.max(0, Math.min(100, (t / duration) * 100));

/** A mark with where it sits on the line and which row its label is on, so that neighbours do not overlap. */
export interface Tick {
  readonly mark: Mark;
  readonly at: number;
  readonly row: 0 | 1;
}

/** Marks closer than this share of the line put their labels on different rows. */
const CROWDED = 14;

export function ticks(marks: readonly Mark[], duration: number): Tick[] {
  let last = Number.NEGATIVE_INFINITY;
  let row: 0 | 1 = 1;
  return [...marks]
    .sort((a, b) => a.t - b.t)
    .map((mark) => {
      const at = pct(mark.t, duration);
      row = at - last < CROWDED ? (row === 0 ? 1 : 0) : 0;
      last = at;
      return { mark, at, row };
    });
}

/** The index of the frame nearest to a moment (the builder's run is a list of frames, not a line). */
export function nearestFrame(frames: readonly { readonly t: number }[], t: number): number {
  let best = 0;
  frames.forEach((f, i) => {
    if (Math.abs(f.t - t) < Math.abs((frames[best]?.t ?? 0) - t)) best = i;
  });
  return best;
}

/** What the speech bubble says: who, what, when. */
export interface Bubble {
  readonly who: string;
  readonly call: string;
  readonly when: string;
  /** A look is light blue; a change is dark blue with a ring. */
  readonly effect: "read" | "write";
  readonly failed: boolean;
}

export const whoText = (who: RunWho): string => `${who.harness} · ${who.model ?? who.agent}`;

export function bubbleOf(
  last: ToolEvent | undefined,
  who: RunWho,
  origin: number,
  nameOf: (id: string) => string,
): Bubble | undefined {
  if (!last) return undefined;
  return {
    who: whoText(who),
    call: callLabel(last, nameOf),
    when: callWhen(last, origin),
    effect: last.effect === "act" ? "write" : "read",
    failed: !last.ok,
  };
}

/** The run at a moment: the board's source, and what the agent last touched. */
export interface Moment {
  readonly source: TopologySource;
  readonly state: ReplayState;
}

/** The moment `t` seconds into a run (`origin` is where the run starts on the world's clock). */
export function momentAt(
  index: BlueprintIndex,
  catalog: Catalog,
  events: readonly RunEvent[],
  origin: number,
  t: number,
): Moment {
  const state = stateAt(events, origin + t);
  return { source: replaySource(restingSource(index, catalog), state), state };
}

/**
 * The servers in the impact range just before the agent first acted (or at the end, if it never did) and when the run
 * closed: the "108 → 0" of the first line. It reads the board twice, so it is worked out once per run.
 */
export function serversMoved(
  index: BlueprintIndex,
  catalog: Catalog,
  events: readonly RunEvent[],
  firstAct: number | undefined,
): ServersMoved {
  const { end } = spanOf(events);
  const base = restingSource(index, catalog);
  const servers = (t: number) => impactOf(replaySource(base, stateAt(events, t))).servers;
  const at = firstAct === undefined ? end : firstAct - 0.001;
  return { before: servers(at), after: servers(end), at };
}

/** The marks with their times counted from the start of the run, as the bar draws them. */
export function relative(marks: readonly Mark[], origin: number): Mark[] {
  return marks.map((m) => ({ ...m, t: m.t - origin, at: m.at.map((a) => a - origin) }));
}
