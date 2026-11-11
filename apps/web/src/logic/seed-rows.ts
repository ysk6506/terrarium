/**
 * The runs of an experiment folded by seed, one line per seed with a dot for each time it ran (ADR-0158): what a
 * person looks at to see whether the same situation came out the same way.
 */
import type { RunSummary } from "@terrarium/core/contract";

/** How one run stands: passed or not once it is done, otherwise where it is. */
export type DotState = "pass" | "fail" | "waiting" | "broken" | "stopped";

export interface SeedDot {
  readonly runId: string;
  /** From 1: which time this seed ran. */
  readonly repeat: number;
  readonly state: DotState;
  readonly score: number | null;
}

export interface SeedRow {
  readonly seed: number;
  readonly dots: readonly SeedDot[];
  /** Lowest and highest score among the finished runs; absent until one is done. */
  readonly range?: { readonly min: number; readonly max: number };
  /** Whether finished runs of this seed passed and failed both. */
  readonly split: boolean;
}

/** The word a dot carries besides its shape and colour, for the person who cannot tell shapes or colours apart. */
export const DOT_LABELS: Readonly<Record<DotState, string>> = {
  pass: "합격",
  fail: "불합격",
  waiting: "기다리는 중",
  broken: "실패",
  stopped: "멈춤",
};

/** What a dot shows inside it: a mark apart from its colour. */
export const DOT_MARKS: Readonly<Record<DotState, string>> = {
  pass: "✓",
  fail: "✕",
  waiting: "·",
  broken: "!",
  stopped: "–",
};

function stateOf(run: RunSummary): DotState {
  if (run.status === "completed") return run.passed ? "pass" : "fail";
  if (run.status === "failed") return "broken";
  return run.status === "cancelled" ? "stopped" : "waiting";
}

/** One row per seed, seeds in the order they were first run, a seed's dots in the order it ran. */
export function seedRows(runs: readonly RunSummary[]): SeedRow[] {
  const bySeed = new Map<number, RunSummary[]>();
  for (const run of runs) bySeed.set(run.seed, [...(bySeed.get(run.seed) ?? []), run]);
  return [...bySeed].map(([seed, own]) => {
    const dots = own
      .map((r) => ({ runId: r.id, repeat: r.repeat, state: stateOf(r), score: r.score }))
      .sort((a, b) => a.repeat - b.repeat);
    const scores = dots.filter((d) => d.state === "pass" || d.state === "fail").map((d) => d.score);
    const done = scores.filter((s): s is number => s !== null);
    return {
      seed,
      dots,
      ...(done.length > 0 ? { range: { min: Math.min(...done), max: Math.max(...done) } } : {}),
      split: dots.some((d) => d.state === "pass") && dots.some((d) => d.state === "fail"),
    };
  });
}

/** "61.8~90.9점", or "90.9점" when every finished run scored the same, or a dash before any is done. */
export function rangeText(range: SeedRow["range"]): string {
  if (!range) return "—";
  const one = (n: number) => n.toFixed(1);
  return range.min === range.max ? `${one(range.min)}점` : `${one(range.min)}~${one(range.max)}점`;
}
