/**
 * The picture of an experiment's score (ADR-0171): one dot for each finished run on a 0–100 line, runs with the
 * same score (or nearly) piled in one column. A passed run is a filled circle and a failed one a hollow square, so
 * the two differ in shape and in lightness, not in hue alone.
 */
import type { RunSummary } from "@terrarium/core/contract";
import { PASS_MARK } from "@terrarium/core/oracle";

export type DotKind = "pass" | "fail";

/** A dot is a run: its id is what the dot is keyed by. */
export interface Dot {
  readonly runId: string;
  readonly kind: DotKind;
}

/** One column of dots at one place on the line. */
export interface DotStack {
  /** Where on the 0–100 line, in points. */
  readonly at: number;
  /** Failed runs first (the bottom of the pile), then passed ones. */
  readonly dots: readonly Dot[];
}

/** Scores this close share a column: the width of a dot on a phone, in points. */
export const BIN_POINTS = 4;

/** The line the pass sits on. The core's constant, never retyped. */
export const PASS_LINE = PASS_MARK;

export interface DotCounts {
  readonly pass: number;
  readonly fail: number;
}

const clampScore = (s: number): number => Math.min(100, Math.max(0, s));

/** Finished runs with a score, folded into columns left to right. */
export function dotStacks(runs: readonly RunSummary[]): DotStack[] {
  const bins = new Map<number, { score: number; kind: DotKind; runId: string }[]>();
  for (const r of runs) {
    if (r.status !== "completed" || r.score === null) continue;
    const score = clampScore(r.score);
    const bin = Math.floor(score / BIN_POINTS);
    bins.set(bin, [
      ...(bins.get(bin) ?? []),
      { score, kind: r.passed ? "pass" : "fail", runId: r.id },
    ]);
  }
  return [...bins]
    .sort(([a], [b]) => a - b)
    .map(([, own]) => ({
      at: own.reduce((s, d) => s + d.score, 0) / own.length,
      dots: [...own]
        .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "fail" ? -1 : 1))
        .map((d) => ({ runId: d.runId, kind: d.kind })),
    }));
}

export function dotCounts(stacks: readonly DotStack[]): DotCounts {
  const all = stacks.flatMap((s) => s.dots);
  return {
    pass: all.filter((d) => d.kind === "pass").length,
    fail: all.filter((d) => d.kind === "fail").length,
  };
}

/** The tallest column: what the plot's height and the size of its dots follow. */
export const tallest = (stacks: readonly DotStack[]): number =>
  Math.max(0, ...stacks.map((s) => s.dots.length));

/** What a screen reader hears for the plot: the counts, the pass line and where the scores lie. */
export function plotLabel(runs: readonly RunSummary[], stacks: readonly DotStack[]): string {
  const c = dotCounts(stacks);
  const scores = runs
    .filter((r) => r.status === "completed" && r.score !== null)
    .map((r) => r.score as number);
  const range =
    scores.length === 0
      ? ""
      : ` 점수는 ${Math.min(...scores).toFixed(1)}점에서 ${Math.max(...scores).toFixed(1)}점까지예요.`;
  return `실행 ${c.pass + c.fail}번의 점수 분포. 합격 ${c.pass}번, 불합격 ${c.fail}번. 합격선은 ${PASS_LINE}점이에요.${range}`;
}

/** The three things the legend says. */
export function legendItems(c: DotCounts): readonly { kind: DotKind | "note"; text: string }[] {
  return [
    { kind: "pass", text: `합격 ${c.pass}번` },
    { kind: "fail", text: `불합격 ${c.fail}번` },
    { kind: "note", text: "점 하나가 실행 한 번이에요" },
  ];
}
