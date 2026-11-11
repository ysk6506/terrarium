/**
 * Benchmark leaderboards (REQ-039). Only experiments of one benchmark set — the same world and
 * scenario versions, scoring, time policy and product versions — are ranked together. Within a set,
 * runs of the same configuration (harness × agent × toolset) are pooled across experiments and
 * people, and pooled by seed (ADR-0158): the same seed from several experiments is one situation, so it counts
 * once. A configuration needs a few different seeds before it gets a rank.
 */
import { type Experiment, physicsOf } from "@terrarium/core/experiments";
import type { ExperimentAnalysis } from "./experiment";
import type { RunAnalysis } from "./run";
import { groupBySeed, seedRate, seedSummary } from "./seeds";
import type { Summary } from "./stats";

/** Different seeds with a completed run that a configuration needs before it is ranked (ADR-0158 item 4). */
export const MIN_SEEDS_TO_RANK = 3;

export interface LeaderboardRow {
  /** 1-based; equal results share a rank. Undefined until the configuration has enough seeds. */
  readonly rank?: number;
  readonly harnessId: string;
  readonly agentId: string;
  readonly tools: readonly string[];
  readonly runs: number;
  /** Different seeds among those runs: what the numbers below are over, and what the rank needs. */
  readonly seeds: number;
  /** Mean over seeds of each seed's share of passed runs. */
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
  /** The physics fingerprint of every run on this board (REQ-113): runs on other physics are on another board. */
  readonly physics: string;
  readonly title: string;
  readonly snapshot: Experiment["snapshot"];
  readonly time: Experiment["recipe"]["time"];
  readonly rows: readonly LeaderboardRow[];
  readonly runs: number;
}

const configKey = (e: Experiment) =>
  `${e.recipe.harnessId}|${e.recipe.agentId}|${[...e.recipe.tools].sort().join(",")}`;

function row(group: readonly ExperimentAnalysis[]): LeaderboardRow {
  const runs: RunAnalysis[] = group.flatMap((a) => a.runs.filter((r) => r.status === "completed"));
  const newest = [...group].sort((a, b) =>
    b.experiment.createdAt.localeCompare(a.experiment.createdAt),
  )[0] as ExperimentAnalysis;
  const e = newest.experiment;
  const groups = groupBySeed(runs);
  return {
    harnessId: e.recipe.harnessId,
    agentId: e.recipe.agentId,
    tools: e.recipe.tools,
    runs: runs.length,
    seeds: groups.length,
    passRate: seedRate(groups, (r) => r.passed),
    ...defined({
      score: seedSummary(groups, (r) => r.score),
      calls: seedSummary(groups, (r) => r.efficiency.investigationCalls),
      timeToDiagnosis: seedSummary(groups, (r) => r.diagnosis.afterSeconds),
      tokens: seedSummary(
        groups,
        (r) => (r.efficiency.inputTokens ?? 0) + (r.efficiency.outputTokens ?? 0) || undefined,
      ),
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

function ranked(rows: LeaderboardRow[], minSeeds: number): LeaderboardRow[] {
  const eligible = rows.filter((r) => r.seeds >= minSeeds).sort(compareRows);
  const out: LeaderboardRow[] = [];
  eligible.forEach((r, i) => {
    const prev = out[i - 1];
    const tied = prev !== undefined && compareRows(prev, r) === 0;
    out.push({ ...r, rank: tied ? (prev.rank as number) : i + 1 });
  });
  const rest = rows
    .filter((r) => r.seeds < minSeeds)
    .sort((a, b) => b.seeds - a.seeds || b.runs - a.runs || compareRows(a, b));
  return [...out, ...rest];
}

/** Leaderboards, one per benchmark set, busiest set first. */
export function buildLeaderboards(
  analyses: readonly ExperimentAnalysis[],
  minSeeds = MIN_SEEDS_TO_RANK,
): Leaderboard[] {
  // only runs on the same physics are ranked together (REQ-113): the key of a set is the benchmark key and the fingerprint
  const sets = new Map<string, ExperimentAnalysis[]>();
  for (const a of analyses) {
    const set = `${a.experiment.benchmarkKey}|${physicsOf(a.experiment)}`;
    sets.set(set, [...(sets.get(set) ?? []), a]);
  }
  const boards = [...sets.values()].map((members) => {
    const key = (members[0] as ExperimentAnalysis).experiment.benchmarkKey;
    const configs = new Map<string, ExperimentAnalysis[]>();
    for (const a of members)
      configs.set(configKey(a.experiment), [...(configs.get(configKey(a.experiment)) ?? []), a]);
    const rows = ranked([...configs.values()].map(row), minSeeds);
    const first = members[0] as ExperimentAnalysis;
    return {
      benchmarkKey: key,
      physics: physicsOf((members[0] as ExperimentAnalysis).experiment),
      title: `${first.experiment.snapshot.worldName} · ${first.experiment.snapshot.scenarioName}`,
      snapshot: first.experiment.snapshot,
      time: first.experiment.recipe.time,
      rows,
      runs: rows.reduce((s, r) => s + r.runs, 0),
    };
  });
  return boards.sort((a, b) => b.runs - a.runs || a.title.localeCompare(b.title));
}
