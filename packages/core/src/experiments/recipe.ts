/**
 * Recipes: checking them, and the benchmark key that decides which experiments are compared
 * (REQ-031, REQ-039). Harness, agent and tools are what an experiment compares, so they are not in
 * the key; everything that changes the task itself is.
 */

import { hashValue } from "@terrarium/core/kernel";
import { DEFAULT_FINGERPRINT } from "@terrarium/core/physics/slots";
import { operationKey, operationProblem } from "@terrarium/core/session";
import { TOOL_NAMES } from "@terrarium/core/tools";
import { isDefaultLeadSettings, resolveLeadSettings } from "@terrarium/core/world";
import type { Recipe, Snapshot } from "./model";

/** Seeds in one experiment: the situations compared. */
export const MAX_SEEDS = 20;
/** Times one seed is run (ADR-0158). */
export const MAX_REPEATS = 10;
/**
 * Runs in one experiment, seeds × repeats (ADR-0158): three times the 20 it was when a run was a seed, so the largest
 * experiment of before can still be repeated three times, and a run costs the same as ever.
 */
export const MAX_RUNS = 60;
export const MAX_REPLY = 1000;
export const DEFAULT_SEEDS: readonly number[] = [1, 2, 3];

export interface RecipeContext {
  /** Known product-version keys for vCenter and vROps. */
  readonly profiles: { readonly vcenter: readonly string[]; readonly vrops: readonly string[] };
  /** Agents the chosen harness offers, when known. */
  readonly agents?: readonly string[];
}

/** How many times each seed runs; a recipe from before repeats existed runs each once. */
export const repeatsOf = (recipe: Pick<Recipe, "repeats">): number => recipe.repeats ?? 1;

/** The runs an experiment is made of: seeds × repeats. */
export const runCountOf = (recipe: Pick<Recipe, "seeds" | "repeats">): number =>
  recipe.seeds.length * repeatsOf(recipe);

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

/** The size of an experiment against the limits: seeds, repeats and the runs they make. Empty when it fits. */
export function sizeProblems(recipe: Pick<Recipe, "seeds" | "repeats">): string[] {
  const { seeds } = recipe;
  const repeats = repeatsOf(recipe);
  const out: string[] = [];
  if (seeds.length > MAX_SEEDS)
    out.push(`시드는 한 실험에 ${MAX_SEEDS}개까지예요 (지금 ${seeds.length}개)`);
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > MAX_REPEATS)
    out.push(`같은 조건은 시드마다 1~${MAX_REPEATS}번 돌릴 수 있어요`);
  else if (seeds.length * repeats > MAX_RUNS)
    out.push(
      `실행은 한 실험에 ${MAX_RUNS}번까지예요 (시드 ${seeds.length}개 × ${repeats}번 = ${seeds.length * repeats}번)`,
    );
  return out;
}

function seedProblems(recipe: Pick<Recipe, "seeds" | "repeats">): string[] {
  const { seeds } = recipe;
  if (seeds.length === 0) return ["시드를 하나 이상 정해야 해요"];
  const out = sizeProblems(recipe);
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

function humanProblems(recipe: Recipe): string[] {
  const out: string[] = [];
  const mode = recipe.escalation?.mode;
  if (mode !== undefined && !["wait", "auto", "fail"].includes(mode))
    out.push(`알 수 없는 에스컬레이션 처리 '${mode}'`);
  if ((recipe.escalation?.reply ?? "").length > MAX_REPLY)
    out.push(`정해 둔 답은 ${MAX_REPLY}자까지 쓸 수 있어요`);
  if (recipe.faultScope !== undefined && !["inside", "all"].includes(recipe.faultScope))
    out.push(`알 수 없는 고장 범위 '${recipe.faultScope}'`);
  if (recipe.sop !== undefined && !["none", "given", "search"].includes(recipe.sop))
    out.push(`알 수 없는 절차서 방식 '${recipe.sop}'`);
  if (recipe.tools.includes("search_runbooks") && recipe.sop !== "search")
    out.push("절차서 찾기 툴은 절차서를 '찾게 함'으로 할 때만 써요");
  return out;
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

/** An operation needs a valid config and a way to pull the news: without `events_since` the agent can only list what is up. */
function operationProblems(recipe: Recipe): string[] {
  if (!recipe.operation) return [];
  const own = operationProblem(recipe.operation);
  return [
    ...(own ? [own] : []),
    ...(recipe.tools.includes("events_since")
      ? []
      : ["운영에는 새 사건 보기(events_since) 툴이 있어야 해요. 툴 고르기에서 켜 주세요"]),
  ];
}

/** Problems with a recipe, in Korean; empty when it can run. */
export function recipeProblems(recipe: Recipe, ctx: RecipeContext): string[] {
  const out = [
    ...toolProblems(recipe.tools),
    ...seedProblems(recipe),
    ...timeProblems(recipe.time),
    ...humanProblems(recipe),
    ...profileProblems(recipe, ctx),
    ...operationProblems(recipe),
  ];
  if (!recipe.harnessId) out.push("하네스를 골라야 해요");
  if (!recipe.agentId) out.push("에이전트를 골라야 해요");
  else if (ctx.agents && !ctx.agents.includes(recipe.agentId))
    out.push(`하네스에 '${recipe.agentId}' 에이전트가 없어요`);
  return out;
}

/** The physics an experiment ran on (REQ-113); experiments made before the fingerprint existed ran on `v1`. */
export const physicsOf = (e: { readonly snapshot: Snapshot }): string =>
  e.snapshot.physics ?? DEFAULT_FINGERPRINT;

/** The comparable task: same world and scenario versions, same scoring, same time and product versions. */
export function benchmarkKey(
  snapshot: Snapshot,
  recipe: Pick<Recipe, "time" | "profiles" | "domains" | "leadTimes" | "faultScope" | "operation">,
): string {
  // domains and lead times change the task, so they are in the key; unset they leave the key as it always was
  const scope =
    (recipe.domains && recipe.domains.length > 0) ||
    (recipe.leadTimes && !isDefaultLeadSettings(recipe.leadTimes))
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
    // a world with other physics is another task, even before its digest says so (REQ-113); the default leaves the key as it was
    ...(snapshot.physics && snapshot.physics !== DEFAULT_FINGERPRINT
      ? { physics: snapshot.physics }
      : {}),
    profiles: { vcenter: recipe.profiles.vcenter ?? null, vrops: recipe.profiles.vrops ?? null },
    // which faults can happen shapes the task; how escalation is answered and whether a runbook is given are
    // conditions of the agent, like its tools, so they stay out of the key (only where set, so old keys stay)
    ...(recipe.faultScope === "inside" ? { faultScope: "inside" } : {}),
    // an operation is a different task for each length, pace, fault source and rate; its instruction is a
    // condition of the agent and stays out, like the tools
    ...(recipe.operation ? { operation: operationKey(recipe.operation) } : {}),
  });
}

/** Tools in catalog order without duplicates, so equal toolsets compare equal. */
export function normalizeTools(tools: readonly string[]): string[] {
  const wanted = new Set(tools);
  return TOOL_NAMES.filter((t) => wanted.has(t));
}
