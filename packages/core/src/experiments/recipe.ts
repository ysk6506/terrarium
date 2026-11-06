/**
 * Recipes: checking them, and the benchmark key that decides which experiments are compared
 * (REQ-031, REQ-039). Harness, agent and tools are what an experiment compares, so they are not in
 * the key; everything that changes the task itself is.
 */
import { hashValue } from "@terrarium/core/kernel";
import { TOOL_NAMES } from "@terrarium/core/tools";
import { resolveLeadSettings } from "@terrarium/core/world";
import type { Recipe, Snapshot } from "./model";

export const MAX_SEEDS = 20;
export const DEFAULT_SEEDS: readonly number[] = [1, 2, 3];

export interface RecipeContext {
  /** Known product-version keys for vCenter and vROps. */
  readonly profiles: { readonly vcenter: readonly string[]; readonly vrops: readonly string[] };
  /** Agents the chosen harness offers, when known. */
  readonly agents?: readonly string[];
}

/** Seeds 1..n, the default so that experiments in one benchmark set face the same scenario draws. */
export const seedsUpTo = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

function toolProblems(tools: readonly string[]): string[] {
  const unknown = tools.filter((t) => !TOOL_NAMES.includes(t));
  const out = unknown.length > 0 ? [`알 수 없는 툴: ${unknown.join(", ")}`] : [];
  if (tools.filter((t) => t !== "submit_diagnosis").length === 0)
    out.push("조사에 쓸 툴을 하나 이상 골라야 해요 (진단 제출은 늘 포함돼요)");
  if (new Set(tools).size !== tools.length) out.push("같은 툴이 두 번 들어 있어요");
  return out;
}

function seedProblems(seeds: readonly number[]): string[] {
  if (seeds.length === 0) return ["시드를 하나 이상 정해야 해요"];
  const out: string[] = [];
  if (seeds.length > MAX_SEEDS)
    out.push(`실행은 한 실험에 ${MAX_SEEDS}번까지예요 (지금 ${seeds.length}번)`);
  if (seeds.some((s) => !Number.isInteger(s) || s < 0)) out.push("시드는 0 이상의 정수여야 해요");
  if (new Set(seeds).size !== seeds.length) out.push("같은 시드가 두 번 들어 있어요");
  return out;
}

function timeProblems(time: Recipe["time"]): string[] {
  if (time.kind === "lockstep")
    return time.secondsPerCall >= 1 && time.secondsPerCall <= 600
      ? []
      : ["툴 호출당 시간은 1~600초여야 해요"];
  if (time.kind === "realtime")
    return time.speed > 0 && time.speed <= 100 ? [] : ["시간 배속은 0보다 크고 100 이하여야 해요"];
  return [`알 수 없는 시간 정책 '${(time as { kind: string }).kind}'`];
}

function profileProblems(recipe: Recipe, ctx: RecipeContext): string[] {
  const out: string[] = [];
  const { vcenter, vrops } = recipe.profiles;
  if (vcenter !== undefined && !ctx.profiles.vcenter.includes(vcenter))
    out.push(`알 수 없는 vCenter 버전 '${vcenter}'`);
  if (vrops !== undefined && !ctx.profiles.vrops.includes(vrops))
    out.push(`알 수 없는 vROps 버전 '${vrops}'`);
  return out;
}

/** Problems with a recipe, in Korean; empty when it can run. */
export function recipeProblems(recipe: Recipe, ctx: RecipeContext): string[] {
  const out = [
    ...toolProblems(recipe.tools),
    ...seedProblems(recipe.seeds),
    ...timeProblems(recipe.time),
    ...profileProblems(recipe, ctx),
  ];
  if (!recipe.harnessId) out.push("하네스를 골라야 해요");
  if (!recipe.agentId) out.push("에이전트를 골라야 해요");
  else if (ctx.agents && !ctx.agents.includes(recipe.agentId))
    out.push(`하네스에 '${recipe.agentId}' 에이전트가 없어요`);
  return out;
}

/** The comparable task: same world and scenario versions, same scoring, same time and product versions. */
export function benchmarkKey(
  snapshot: Snapshot,
  recipe: Pick<Recipe, "time" | "profiles" | "domains" | "leadTimes">,
): string {
  // domains and lead times change the task, so they are in the key; unset they leave the key as it always was
  const scope =
    (recipe.domains && recipe.domains.length > 0) || recipe.leadTimes
      ? {
          scope: {
            domains: [...(recipe.domains ?? [])].sort(),
            leadTimes: resolveLeadSettings(recipe.leadTimes),
          },
        }
      : {};
  return hashValue({
    ...scope,
    world: snapshot.worldDigest,
    scenario: snapshot.scenarioDigest,
    oracle: snapshot.oracle,
    time: recipe.time,
    profiles: { vcenter: recipe.profiles.vcenter ?? null, vrops: recipe.profiles.vrops ?? null },
  });
}

/** Tools in catalog order without duplicates, so equal toolsets compare equal. */
export function normalizeTools(tools: readonly string[]): string[] {
  const wanted = new Set(tools);
  return TOOL_NAMES.filter((t) => wanted.has(t));
}
