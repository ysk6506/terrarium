/**
 * The failure-rate table of operation mode (REQ-090, ADR-0094 item 1): for each fault, how many world hours one piece
 * of equipment of its kind runs on average before it happens (MTBF, at the "보통" preset). The numbers are the
 * simulator's own, shorter than a vendor's datasheet, so that an eight-hour shift in a mid-sized world sees a few
 * incidents. They are data: the same table drives the generator, the guide and the experiment screen.
 */
import { HAZARD_ROWS } from "@terrarium/core/physics/slots";
import type { EntityKind, FaultType } from "@terrarium/core/world";

export interface Mtbf {
  readonly type: FaultType;
  /** The equipment kinds it can happen to. */
  readonly kinds: readonly EntityKind[];
  /** World hours per piece of equipment, at "보통". */
  readonly hours: number;
}

export const MTBF_TABLE: readonly Mtbf[] = HAZARD_ROWS as readonly Mtbf[];

/**
 * How busy each hour of the day is, relative to the day's average (the world has no workload pattern of its own, so
 * this is the default: busy by day, quiet by night). Hour 0 is midnight of the world's clock.
 */
export const DAY_PATTERN: readonly number[] = [
  0.4, 0.3, 0.3, 0.3, 0.4, 0.6, 0.9, 1.3, 1.6, 1.8, 1.8, 1.6, 1.4, 1.6, 1.8, 1.8, 1.6, 1.4, 1.1,
  0.9, 0.8, 0.6, 0.5, 0.4,
];

/** The pattern's weight at a world time (seconds), the clock starting at midnight. */
export function dayWeight(t: number, pattern: readonly number[] = DAY_PATTERN): number {
  const hour = Math.floor((((t % 86_400) + 86_400) % 86_400) / 3_600);
  return pattern[hour] ?? 1;
}
