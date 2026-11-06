/**
 * What people leave on the platform besides experiments (REQ-101, ADR-0122): a heart on a world, a mark that a scenario
 * passed the 변별력 점검, and the titles people earned. All three are small facts with a time; the screens count them.
 */

/** One person's heart on one world. One per person per world; taking it back deletes the row. */
export interface WorldLike {
  readonly worldId: string;
  readonly user: string;
  readonly at: string;
}

/** A 변별력 점검 that was run on a scenario, and whether it came back with nothing to fix. */
export interface CalibrationMark {
  readonly scenarioId: string;
  /** The scenario as it was when checked. */
  readonly digest: string;
  readonly at: string;
  readonly clean: boolean;
}

/** A title someone earned. Once written it is never taken back, even if what earned it is deleted later. */
export interface TitleAward {
  readonly user: string;
  readonly key: string;
  readonly earnedAt: string;
}
