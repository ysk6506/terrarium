/**
 * Pieces of making an experiment that need no store: which filters a query maps to, how a fork changes a recipe, which
 * runs a plan makes. Split from experiments.ts to keep that file short.
 */
import type { ExperimentQueryParams, ForkRequest, RecipeRequest } from "@terrarium/core/contract";
import { type ExperimentFilter, normalizeTools, type Recipe } from "@terrarium/core/experiments";
import { DEFAULT_PERMISSION, rulesOf } from "@terrarium/core/session";

export const asIssues = (problems: readonly string[], path = "recipe") =>
  problems.map((message) => ({ path, message }));

const FILTER_KEYS = ["owner", "worldId", "scenarioId", "benchmarkKey", "parentId", "meta"] as const;

/** The parts of a query the store can filter on; the text search is called `q` in an address and `text` in the store. */
export function filterOf(query: ExperimentQueryParams): ExperimentFilter {
  const filter: Record<string, string> = {};
  for (const key of FILTER_KEYS) if (query[key]) filter[key] = query[key];
  if (query.q) filter.text = query.q;
  return filter;
}

/**
 * What a fork changes in the recipe. Finding the runbook is a tool the agent needs, so a change of the tools or of the
 * runbook choice leaves the tool list agreeing with it: "찾게 함" has the finder, any other choice does not.
 */
export function forkChange(parent: Recipe, change: ForkRequest["change"]): Partial<Recipe> {
  const sop = change.sop ?? parent.sop;
  const tools = change.tools ?? (change.sop ? parent.tools : undefined);
  if (!tools) return change;
  const wanted = sop === "search" ? [...tools, FINDER] : tools.filter((t) => t !== FINDER);
  return { ...change, tools: normalizeTools(wanted) };
}

/** The choices of a recipe that are left out when not made, so an experiment that does not use them reads as it always did. */
export function optionsOf(req: RecipeRequest): Partial<Recipe> {
  return {
    ...(req.escalation ? { escalation: req.escalation } : {}),
    ...(req.faultScope ? { faultScope: req.faultScope } : {}),
    ...(req.sop ? { sop: req.sop } : {}),
    ...(req.domains && req.domains.length > 0 ? { domains: req.domains } : {}),
    ...(req.leadTimes ? { leadTimes: req.leadTimes } : {}),
    ...(req.operation ? { operation: req.operation } : {}),
    // the default level and no rules are left out, so an experiment that chose neither reads as it always did
    ...(req.permission && req.permission !== DEFAULT_PERMISSION
      ? { permission: req.permission }
      : {}),
    ...(req.rules && req.rules.length > 0 ? { rules: rulesOf(req) } : {}),
  };
}

export const FINDER = "search_runbooks";

/** One run to make: which seed, and which time that seed is run (from 1). */
export interface RunPlan {
  readonly seed: number;
  readonly repeat: number;
}

/**
 * The runs of the given rounds over the given seeds, a round at a time: when an experiment is stopped halfway,
 * every seed it got to has the same number of runs, give or take one round.
 */
export function planOf(
  seeds: readonly number[],
  firstRepeat: number,
  lastRepeat: number,
): RunPlan[] {
  const out: RunPlan[] = [];
  for (let repeat = firstRepeat; repeat <= lastRepeat; repeat++)
    for (const seed of seeds) out.push({ seed, repeat });
  return out;
}

/** An operation follows the clock driver; the session is synced to the wall clock at real speed (ADR-0094). */
export const REAL_TIME = { kind: "realtime", speed: 1 } as const;
