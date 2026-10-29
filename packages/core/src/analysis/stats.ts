/** Small statistics for results: a few runs per experiment, so intervals use Student's t. */

export interface Summary {
  readonly n: number;
  readonly mean: number;
  readonly median: number;
  readonly stdev: number;
  readonly min: number;
  readonly max: number;
  /** Half-width of the 95% confidence interval of the mean (0 for a single value). */
  readonly ci95: number;
}

/** Two-sided 95% t critical values for 1..30 degrees of freedom; beyond that, 1.96. */
const T95 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145,
  2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048,
  2.045, 2.042,
];

export function tCritical(df: number): number {
  return df >= 1 && df <= T95.length ? (T95[df - 1] as number) : 1.96;
}

const round = (v: number, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits;

export function summarize(values: readonly number[]): Summary | undefined {
  const n = values.length;
  if (n === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = n > 1 ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
  const stdev = Math.sqrt(variance);
  const mid = Math.floor(n / 2);
  const median =
    n % 2 === 1
      ? (sorted[mid] as number)
      : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
  return {
    n,
    mean: round(mean),
    median: round(median),
    stdev: round(stdev),
    min: sorted[0] as number,
    max: sorted[n - 1] as number,
    ci95: n > 1 ? round((tCritical(n - 1) * stdev) / Math.sqrt(n)) : 0,
  };
}

/** Whether two means differ beyond their 95% intervals (a conservative, explainable test). */
export function clearlyDifferent(a: Summary, b: Summary): boolean {
  if (a.n < 2 || b.n < 2) return false;
  return a.mean - a.ci95 > b.mean + b.ci95 || b.mean - b.ci95 > a.mean + a.ci95;
}

export const ratio = (part: number, whole: number): number =>
  whole === 0 ? 0 : round(part / whole, 4);
