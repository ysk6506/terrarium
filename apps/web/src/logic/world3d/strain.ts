/**
 * How hard the machine is struggling, as a level the moving extras (people, visitors, air, the slow turn)
 * follow (REQ-036). They never stop: a struggling machine gets half as many of them, then half again, and
 * they move less often. The level goes down quickly when frames are late and comes back slowly when frames
 * are fine again, so it does not flicker between two levels.
 */

/** The lightest level: an eighth of everything (one at least), but still moving. */
export const MAX_LEVEL = 3;
/** A frame longer than this counts against the machine, seconds (25 frames a second). */
export const SLOW_FRAME_S = 0.04;
/** Fast frames pay back slow time at this rate: a machine that is late more than a fifth of the time is struggling. */
export const PAYBACK = 0.25;
/** Seconds of slow frames that cost one level. */
export const DROP_AFTER_S = 1.2;
/** Seconds of fast frames in a row that earn a level back, to begin with. */
export const RISE_AFTER_S = 6;
/** The wait for a level back grows after each drop that follows a rise, up to this many seconds. */
export const RISE_AFTER_MAX_S = 48;
/** From this level on the slow turn of the camera waits. */
export const SPIN_STOPS_AT = 2;

export type Level = 0 | 1 | 2 | 3;

/** A drop this soon (seconds) after a rise means the machine cannot hold the higher level. */
const RELAPSE_S = 30;

/** Counts slow and fast frames and says which level the machine is at. */
export class Strain {
  private current: Level = 0;
  private slow = 0;
  private fast = 0;
  private wait = RISE_AFTER_S;
  private sinceRise = Number.POSITIVE_INFINITY;

  get level(): Level {
    return this.current;
  }

  /** Feed one frame's length (seconds); returns the level after it. */
  frame(dt: number): Level {
    this.sinceRise += dt;
    if (dt > SLOW_FRAME_S) {
      this.fast = 0;
      this.slow += dt;
      if (this.slow >= DROP_AFTER_S && this.current < MAX_LEVEL) this.drop();
    } else {
      this.slow = Math.max(0, this.slow - dt * PAYBACK);
      this.fast += dt;
      if (this.fast >= this.wait && this.current > 0) this.rise();
    }
    return this.current;
  }

  private drop(): void {
    this.current = (this.current + 1) as Level;
    this.slow = 0;
    if (this.sinceRise < RELAPSE_S) this.wait = Math.min(RISE_AFTER_MAX_S, this.wait * 2);
  }

  private rise(): void {
    this.current = (this.current - 1) as Level;
    this.fast = 0;
    this.sinceRise = 0;
    if (this.current === 0) this.wait = RISE_AFTER_S;
  }

  reset(): void {
    this.current = 0;
    this.slow = 0;
    this.fast = 0;
    this.wait = RISE_AFTER_S;
    this.sinceRise = Number.POSITIVE_INFINITY;
  }
}

/** How many of `total` things to show at a level: half for each level, never none while there are some. */
export function shownAt(total: number, level: number): number {
  if (total <= 0) return 0;
  return Math.max(1, Math.ceil(total / 2 ** level));
}

/**
 * How many of the things numbered `first` to `first + count - 1` (puffs, arrows: numbered across all paths of
 * a room) stay at a level: every 2^level-th of all of them. The total halves for each level, never to none,
 * and what stays is spread over every path instead of leaving a few puffs on each.
 */
export function keptAmong(first: number, count: number, level: number): number {
  if (count <= 0) return 0;
  const stride = 2 ** Math.max(0, level);
  return Math.floor((first + count - 1) / stride) - Math.floor((first - 1) / stride);
}

/** Frames' worth of waiting between two updates of what moves, as a multiple of the usual step. */
const STEP_FACTORS = [1, 2, 3, 4] as const;

/** Seconds between two updates of what moves at a level: longer when struggling, never forever. */
export function stepAt(baseS: number, level: number): number {
  return baseS * (STEP_FACTORS[Math.min(MAX_LEVEL, Math.max(0, level))] as number);
}

/** Whether the slow turn of the camera goes on at this level. */
export const spinsAt = (level: number): boolean => level < SPIN_STOPS_AT;

/** Who stays when there are fewer people: the walkers first (engineers), then the technician, the manager last. */
const STAYS_FIRST: Readonly<Record<string, number>> = { engineer: 0, technician: 1, manager: 2 };

/** The ids of the people to show at a level; at least one, and a walker if there is one. */
export function peopleKept(
  people: readonly { readonly id: number; readonly role: string }[],
  level: number,
): ReadonlySet<number> {
  const order = [...people].sort(
    (a, b) => (STAYS_FIRST[a.role] ?? 3) - (STAYS_FIRST[b.role] ?? 3) || a.id - b.id,
  );
  return new Set(order.slice(0, shownAt(people.length, level)).map((p) => p.id));
}
