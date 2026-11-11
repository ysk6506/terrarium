/** One experiment's standing in a list: how far it is, and how it scored. */
import { groupBySeed, meanOf, seedMeans } from "@terrarium/core/analysis";
import type { ExperimentSummary } from "@terrarium/core/contract";
import {
  type Experiment,
  experimentStatus,
  progressOf,
  type RunRecord,
} from "@terrarium/core/experiments";

/** Pass rate and mean score over seeds, not runs (ADR-0158): a seed's runs are folded into one value first. */
export function summarize(experiment: Experiment, runs: readonly RunRecord[]): ExperimentSummary {
  const groups = groupBySeed(runs.filter((r) => r.status === "completed" && r.result));
  const scores = seedMeans(groups, (r) => r.result?.score.total);
  const rates = seedMeans(groups, (r) => (r.result?.score.passed ? 1 : 0));
  return {
    experiment,
    status: experimentStatus(runs),
    progress: progressOf(runs),
    passRate: rates.length === 0 ? 0 : meanOf(rates),
    ...(scores.length > 0 ? { meanScore: Math.round(meanOf(scores) * 10) / 10 } : {}),
  };
}
