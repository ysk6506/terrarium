/**
 * Benchmark leaderboards (REQ-039). Only experiments of one benchmark set — the same world and
 * scenario versions, scoring, time policy and product versions — are ranked together. Within a set,
 * runs of the same configuration (harness × agent × toolset) are pooled across experiments and
 * people; a configuration needs a few runs before it gets a rank.
 */
import type { Experiment } from "@terrarium/core/experiments";
import type { ExperimentAnalysis } from "./experiment";
import type { RunAnalysis } from "./run";
import { ratio, type Summary, summarize } from "./stats";

export const MIN_RUNS_TO_RANK = 3;

export interface LeaderboardRow {
  /** 1-based; equal results share a rank. Undefined until the configuration has enough runs. */
  readonly rank?: number;
  readonly harnessId: string;
  readonly agentId: string;
  readonly tools: readonly string[];
  readonly runs: number;
  readonly passRate: number;
  readonly score?: Summary;
  readonly calls?: Summary;
  readonly timeToDiagnosis?: Summary;
  readonly tokens?: Summary;
  readonly owners: readonly string[];
  readonly experimentIds: readonly string[];
  /** The most recent experiment of this configuration. */
  readonly latest: string;
}

export interface Leaderboard {
  readonly benchmarkKey: string;
  readonly title: string;
  readonly snapshot: Experiment["snapshot"];
  readonly time: Experiment["recipe"]["time"];
  readonly rows: readonly LeaderboardRow[];
  readonly runs: number;
}

const configKey = (e: Experiment) =>
  `${e.recipe.harnessId}|${e.recipe.agentId}|${[...e.recipe.tools].sort().join(",")}`;
const num = (xs: readonly (number | null | undefined)[]) =>
  xs.filter((x): x is number => typeof x === "number");

function row(group: readonly ExperimentAnalysis[]): LeaderboardRow {
  const runs: RunAnalysis[] = group.flatMap((a) => a.runs.filter((r) => r.status === "completed"));
  const newest = [...group].sort((a, b) =>
    b.experiment.createdAt.localeCompare(a.experiment.createdAt),
  )[0] as ExperimentAnalysis;
  const e = newest.experiment;
  const tokens = num(
    runs.map(
      (r) => (r.efficiency.inputTokens ?? 0) + (r.efficiency.outputTokens ?? 0) || undefined,
    ),
  );
  return {
    harnessId: e.recipe.harnessId,
    agentId: e.recipe.agentId,
    tools: e.recipe.tools,
    runs: runs.length,
    passRate: ratio(runs.filter((r) => r.passed).length, runs.length),
    ...defined({
      score: summarize(num(runs.map((r) => r.score))),
      calls: summarize(runs.map((r) => r.efficiency.investigationCalls)),
      timeToDiagnosis: summarize(num(runs.map((r) => r.diagnosis.afterSeconds))),
      tokens: summarize(tokens),
    }),
    owners: [...new Set(group.map((a) => a.experiment.owner))].sort(),
    experimentIds: group.map((a) => a.experiment.id).sort(),
    latest: e.id,
  };
}

function defined<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Higher score, then higher pass rate, then faster diagnosis, then fewer calls. */
function compareRows(a: LeaderboardRow, b: LeaderboardRow): number {
  return (
    (b.score?.mean ?? -1) - (a.score?.mean ?? -1) ||
    b.passRate - a.passRate ||
    (a.timeToDiagnosis?.mean ?? Number.POSITIVE_INFINITY) -
      (b.timeToDiagnosis?.mean ?? Number.POSITIVE_INFINITY) ||
    (a.calls?.mean ?? 0) - (b.calls?.mean ?? 0)
  );
}

function ranked(rows: LeaderboardRow[], minRuns: number): LeaderboardRow[] {
  const eligible = rows.filter((r) => r.runs >= minRuns).sort(compareRows);
  const out: LeaderboardRow[] = [];
  eligible.forEach((r, i) => {
    const prev = out[i - 1];
    const tied = prev !== undefined && compareRows(prev, r) === 0;
    out.push({ ...r, rank: tied ? (prev.rank as number) : i + 1 });
  });
  const rest = rows
    .filter((r) => r.runs < minRuns)
    .sort((a, b) => b.runs - a.runs || compareRows(a, b));
  return [...out, ...rest];
}

/** Leaderboards, one per benchmark set, busiest set first. */
export function buildLeaderboards(
  analyses: readonly ExperimentAnalysis[],
  minRuns = MIN_RUNS_TO_RANK,
): Leaderboard[] {
  const sets = new Map<string, ExperimentAnalysis[]>();
  for (const a of analyses)
    sets.set(a.experiment.benchmarkKey, [...(sets.get(a.experiment.benchmarkKey) ?? []), a]);
  const boards = [...sets].map(([key, members]) => {
    const configs = new Map<string, ExperimentAnalysis[]>();
    for (const a of members)
      configs.set(configKey(a.experiment), [...(configs.get(configKey(a.experiment)) ?? []), a]);
    const rows = ranked([...configs.values()].map(row), minRuns);
    const first = members[0] as ExperimentAnalysis;
    return {
      benchmarkKey: key,
      title: `${first.experiment.snapshot.worldName} · ${first.experiment.snapshot.scenarioName}`,
      snapshot: first.experiment.snapshot,
      time: first.experiment.recipe.time,
      rows,
      runs: rows.reduce((s, r) => s + r.runs, 0),
    };
  });
  return boards.sort((a, b) => b.runs - a.runs || a.title.localeCompare(b.title));
}
