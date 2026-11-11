/**
 * The seed is the unit of statistics (ADR-0158). Runs of one seed start from the same world flow, so they are not
 * independent samples of the world: they are first folded into one value per seed, and the intervals, rates and
 * ranks are worked out over those values. With one run per seed this is the run itself, so the numbers of an
 * experiment that does not repeat are what they always were.
 */
import { ratio, type Summary, summarize } from "./stats";

/** The runs of one seed, in the order they came. */
export interface SeedGroup<T> {
  readonly seed: number;
  readonly items: readonly T[];
}

/** Runs gathered by seed, seeds in the order they first appear: the same seed from several experiments is one group. */
export function groupBySeed<T extends { readonly seed: number }>(
  runs: readonly T[],
): SeedGroup<T>[] {
  const groups = new Map<number, T[]>();
  for (const run of runs) groups.set(run.seed, [...(groups.get(run.seed) ?? []), run]);
  return [...groups].map(([seed, items]) => ({ seed, items }));
}

/** The mean of a list that has something in it. */
export const meanOf = (xs: readonly number[]): number => xs.reduce((s, v) => s + v, 0) / xs.length;

/** One mean per seed of the numbers `pick` finds; a seed with none is left out. */
export function seedMeans<T>(
  groups: readonly SeedGroup<T>[],
  pick: (item: T) => number | null | undefined,
): number[] {
  const out: number[] = [];
  for (const group of groups) {
    const values = group.items.map(pick).filter((v): v is number => typeof v === "number");
    if (values.length > 0) out.push(meanOf(values));
  }
  return out;
}

/** Mean and 95% interval over the seed means (degrees of freedom: seeds − 1); `n` is the number of seeds. */
export const seedSummary = <T>(
  groups: readonly SeedGroup<T>[],
  pick: (item: T) => number | null | undefined,
): Summary | undefined => summarize(seedMeans(groups, pick));

/** The mean over seeds of each seed's share of runs for which `test` holds (0 with no seeds). */
export function seedRate<T>(groups: readonly SeedGroup<T>[], test: (item: T) => boolean): number {
  if (groups.length === 0) return 0;
  return ratio(
    groups.reduce((s, g) => s + g.items.filter(test).length / g.items.length, 0),
    groups.length,
  );
}

/**
 * How much the score moves when nothing but the agent's luck differs: the pooled standard deviation within seeds,
 * over the seeds that have two runs or more. Absent when no seed does.
 */
export function withinSeedSpread<T>(
  groups: readonly SeedGroup<T>[],
  pick: (item: T) => number | null | undefined,
): { readonly spread: number; readonly seeds: number } | undefined {
  let squares = 0;
  let freedom = 0;
  let seeds = 0;
  for (const group of groups) {
    const values = group.items.map(pick).filter((v): v is number => typeof v === "number");
    if (values.length < 2) continue;
    const m = meanOf(values);
    squares += values.reduce((s, v) => s + (v - m) ** 2, 0);
    freedom += values.length - 1;
    seeds += 1;
  }
  return freedom === 0
    ? undefined
    : { spread: Math.round(Math.sqrt(squares / freedom) * 100) / 100, seeds };
}

/** Seeds whose runs ended both ways, passed and not passed: the same situation, two outcomes. */
export const splitSeeds = <T>(
  groups: readonly SeedGroup<T>[],
  passed: (item: T) => boolean,
): number =>
  groups.filter((g) => g.items.some(passed) && g.items.some((item) => !passed(item))).length;
