/**
 * What an experiment says of the level it entrusted and the rules it held the agent to (REQ-123, REQ-125): for each rule,
 * how many times it was broken in a situation, on average. The seed is the unit, as everywhere (ADR-0158); the score is
 * not touched, the rules are a result of their own.
 */
import type { Experiment, RunRecord } from "@terrarium/core/experiments";
import {
  type PermissionLevel,
  permissionOf,
  RULE_LABELS,
  type RuleId,
  rulesOf,
} from "@terrarium/core/session";
import { groupBySeed, meanOf } from "./seeds";

export interface RuleSummary {
  readonly rule: RuleId;
  readonly label: string;
  /** Mean over seeds of each seed's mean number of violations per run. */
  readonly violations: number;
  /** The same for changes the rule could not judge (not violations). */
  readonly undetermined: number;
  /** Seeds with a finished run that this is over. */
  readonly seeds: number;
}

export interface TrustSummary {
  readonly permission: PermissionLevel;
  readonly rules: readonly RuleSummary[];
}

const round = (n: number): number => Math.round(n * 100) / 100;

/** The rules of an experiment: the ones it picked, and the one a level of `view` brings. */
function ruleIds(recipe: Experiment["recipe"]): RuleId[] {
  return [
    ...rulesOf(recipe),
    ...(permissionOf(recipe) === "view" ? (["stay_in_scope"] as const) : []),
  ];
}

/** Per rule, the violations of the finished runs averaged by situation; nothing for an experiment that chose neither a level nor rules. */
export function trustSummary(
  experiment: Experiment,
  runs: readonly RunRecord[],
): { readonly trust: TrustSummary } | Record<string, never> {
  const ids = ruleIds(experiment.recipe);
  if (ids.length === 0) return {};
  const done = runs.flatMap((r) =>
    r.status === "completed" && r.result?.trust ? [{ seed: r.seed, trust: r.result.trust }] : [],
  );
  const groups = groupBySeed(done);
  const mean = (id: RuleId, pick: "violations" | "undetermined"): number => {
    const perSeed = groups.map((g) =>
      meanOf(g.items.map((i) => i.trust.rules.find((x) => x.rule === id)?.[pick].length ?? 0)),
    );
    return perSeed.length === 0 ? 0 : round(meanOf(perSeed));
  };
  return {
    trust: {
      permission: permissionOf(experiment.recipe),
      rules: ids.map((id) => ({
        rule: id,
        label: RULE_LABELS[id],
        violations: mean(id, "violations"),
        undetermined: mean(id, "undetermined"),
        seeds: groups.length,
      })),
    },
  };
}
