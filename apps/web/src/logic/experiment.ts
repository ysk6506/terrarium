/**
 * Making an experiment (REQ-030) and making one from another (REQ-040). The form keeps a draft; this
 * checks it with the same rules the server uses, turns it into a request, and for a fork shows exactly
 * what will differ from the original before anything runs.
 */
import type { CreateExperimentRequest, ForkRequest } from "@terrarium/core/contract";
import {
  type Experiment,
  MAX_SEEDS,
  normalizeTools,
  type Recipe,
  type RecipeChange,
  recipeDiff,
  recipeProblems,
  seedsUpTo,
} from "@terrarium/core/experiments";
import { BUILTIN_PROFILES } from "@terrarium/core/profiles";
import { type ScenarioDoc, scopeCheck } from "@terrarium/core/scenario";
import {
  DEFAULT_AUTO_REPLY,
  DEFAULT_TIME,
  type EscalationPolicy,
  type FaultScope,
  type SopMode,
  type TimePolicy,
} from "@terrarium/core/session";
import {
  DEFAULT_TOOLSET,
  TOOL_SPECS,
  type ToolCategory,
  type ToolSpec,
} from "@terrarium/core/tools";

import { type MetaRow, metadataOf } from "./connections";
import { RECOMMENDED_RUNS, runsRange } from "./how-words";

export interface Draft {
  readonly name: string;
  readonly note: string;
  readonly worldId?: string;
  readonly scenarioId?: string;
  readonly harnessId?: string;
  readonly agentId?: string;
  readonly tools: readonly string[];
  /** Runs with seeds 1..n, so experiments in one benchmark set face the same draws. */
  readonly runs: number;
  readonly time: TimePolicy;
  readonly profiles: { readonly vcenter?: string; readonly vrops?: string };
  /** `name=value` pairs attached to the experiment to tell results apart (REQ-052). */
  readonly metadata: readonly MetaRow[];
  /** What happens when the agent asks a person for help (REQ-081). */
  readonly escalation: EscalationPolicy;
  /** Whether faults are limited to what the given tools can solve (REQ-080). */
  readonly faultScope: FaultScope;
  /** Whether the agent gets the scenario's runbook (REQ-082). */
  readonly sop: SopMode;
}

/** The tool that finds a runbook: on exactly when the agent is made to find it. */
export const FINDER = "search_runbooks";

const metaRows = (m: Readonly<Record<string, string>> | undefined): MetaRow[] =>
  Object.entries(m ?? {}).map(([key, value]) => ({ key, value }));

const sameMeta = (a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>) =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.entries(a).every(([k, v]) => b[k] === v);

export const emptyDraft = (): Draft => ({
  name: "",
  note: "",
  tools: [...DEFAULT_TOOLSET],
  runs: RECOMMENDED_RUNS,
  time: DEFAULT_TIME,
  profiles: {},
  metadata: [],
  escalation: { mode: "auto", reply: DEFAULT_AUTO_REPLY },
  faultScope: "all",
  sop: "none",
});

export const PROFILE_CHOICES = {
  vcenter: BUILTIN_PROFILES.filter((p) => p.protocol === "vcenter").map((p) => p.key),
  vrops: BUILTIN_PROFILES.filter((p) => p.protocol === "vrops").map((p) => p.key),
};

export const TOOL_CATEGORY_LABELS: Readonly<Record<ToolCategory, string>> = {
  observe: "살펴보기",
  protocol: "장비 API 그대로 (Redfish·vCenter·vROps)",
  act: "조치하기",
  answer: "답하기",
};

/** The tools in the order the form lists them: by what they are for. */
export function toolGroups(): {
  readonly category: ToolCategory;
  readonly label: string;
  readonly tools: readonly ToolSpec[];
}[] {
  return (Object.keys(TOOL_CATEGORY_LABELS) as ToolCategory[]).map((category) => ({
    category,
    label: TOOL_CATEGORY_LABELS[category],
    tools: TOOL_SPECS.filter((t) => t.category === category),
  }));
}

export function toggleTool(draft: Draft, tool: string, on: boolean): Draft {
  if (tool === "submit_diagnosis") return draft;
  const tools = on ? [...new Set([...draft.tools, tool])] : draft.tools.filter((t) => t !== tool);
  // finding the runbook and "찾게 함" are one choice seen from two places
  if (tool === FINDER)
    return { ...draft, tools, sop: on ? "search" : draft.sop === "search" ? "none" : draft.sop };
  return { ...draft, tools };
}

/** Choose how the runbook is offered; "찾게 함" turns the finder on and any other choice turns it off. */
export function setSop(draft: Draft, sop: SopMode): Draft {
  const rest = draft.tools.filter((t) => t !== FINDER);
  return { ...draft, sop, tools: sop === "search" ? [...rest, FINDER] : rest };
}

/** Set many tools at once (an area, "필요한 것만 켜기", a saved set); the finder keeps the runbook choice in step. */
export function withTools(draft: Draft, tools: readonly string[]): Draft {
  const has = tools.includes(FINDER);
  const sop = has ? "search" : draft.sop === "search" ? "none" : draft.sop;
  return { ...draft, tools: [...tools], sop };
}

/** The recipe the draft stands for, once world, scenario, harness and agent are chosen. */
export function recipeOf(draft: Draft): Recipe | undefined {
  if (!draft.worldId || !draft.scenarioId || !draft.harnessId || !draft.agentId) return undefined;
  return {
    worldId: draft.worldId,
    scenarioId: draft.scenarioId,
    harnessId: draft.harnessId,
    agentId: draft.agentId,
    tools: normalizeTools(draft.tools),
    seeds: seedsUpTo(draft.runs),
    time: draft.time,
    profiles: draft.profiles,
    // only where they matter, so an experiment that does not use them reads as it always did
    ...(draft.tools.includes("ask_human") ? { escalation: draft.escalation } : {}),
    ...(draft.faultScope === "inside" ? { faultScope: draft.faultScope } : {}),
    ...(draft.sop !== "none" ? { sop: draft.sop } : {}),
  };
}

export type Step = "what" | "who" | "how";

/** The recipe's own problems, sorted to the step of the form where they are fixed. */
function recipeSteps(
  draft: Draft,
  agents: readonly string[] | undefined,
  who: string[],
  how: string[],
): void {
  const recipe = recipeOf(draft);
  if (!recipe) {
    if (normalizeTools(draft.tools).filter((t) => t !== "submit_diagnosis").length === 0)
      how.push("조사에 쓸 툴을 하나 이상 골라 주세요 (진단 제출은 늘 포함돼요)");
    return;
  }
  for (const p of recipeProblems(recipe, {
    profiles: PROFILE_CHOICES,
    ...(agents ? { agents } : {}),
  }))
    (p.includes("에이전트") || p.includes("하네스") ? who : how).push(p);
}

/** How many tools the experiment gives: the ones chosen, and the answer that is always there. */
export const countTools = (draft: Draft): number =>
  new Set([...draft.tools, "submit_diagnosis"]).size;

/**
 * What is still missing or wrong, by step of the form. Empty everywhere means it can start. With faults limited to
 * the given tools, a scenario those tools cannot solve is a problem of step 1.
 */
export function draftProblems(
  draft: Draft,
  agents?: readonly string[],
  scenario?: ScenarioDoc,
): Readonly<Record<Step, readonly string[]>> {
  const what: string[] = [];
  const who: string[] = [];
  const how: string[] = [];
  if (!draft.worldId) what.push("세계를 골라 주세요");
  if (!draft.scenarioId) what.push("시나리오를 골라 주세요");
  if (draft.faultScope === "inside" && scenario) {
    const scope = scopeCheck(scenario, [...draft.tools, "submit_diagnosis"]);
    if (!scope.inScope)
      what.push(
        `준 툴 안에서만으로는 이 시나리오를 못 풀어요: ${(scope.reason ?? "").replaceAll("`", "")}`,
      );
  }
  if (!draft.harnessId) who.push("하네스를 골라 주세요");
  else if (!draft.agentId) who.push("에이전트를 골라 주세요");
  if (draft.runs < 1 || draft.runs > MAX_SEEDS) how.push(runsRange(MAX_SEEDS));
  recipeSteps(draft, agents, who, how);
  return { what, who, how: [...new Set(how)] };
}

export const isReady = (problems: Readonly<Record<Step, readonly string[]>>) =>
  problems.what.length + problems.who.length + problems.how.length === 0;

/** A name when people leave it empty: what was tested and by whom. */
export function suggestedName(scenarioName?: string, agentName?: string): string {
  return [scenarioName, agentName].filter(Boolean).join(", ") || "새 실험";
}

export function toRequest(draft: Draft, fallbackName: string): CreateExperimentRequest {
  const recipe = recipeOf(draft);
  if (!recipe) throw new Error("실험 조건이 다 정해지지 않았어요");
  const metadata = metadataOf(draft.metadata);
  return {
    name: draft.name.trim() || fallbackName,
    ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    recipe: {
      worldId: recipe.worldId,
      scenarioId: recipe.scenarioId,
      harnessId: recipe.harnessId,
      agentId: recipe.agentId,
      tools: [...recipe.tools],
      runs: draft.runs,
      time: recipe.time,
      profiles: recipe.profiles,
      ...(recipe.escalation ? { escalation: recipe.escalation } : {}),
      ...(recipe.faultScope ? { faultScope: recipe.faultScope } : {}),
      ...(recipe.sop ? { sop: recipe.sop } : {}),
    },
  };
}

// ── forks ──────────────────────────────────────────────────────────────────────────────────

/** Start a fork from an experiment exactly as it was (REQ-040). */
export function draftFrom(parent: Experiment): Draft {
  const r = parent.recipe;
  return {
    name: `${parent.name} (포크)`,
    note: "",
    worldId: r.worldId,
    scenarioId: r.scenarioId,
    harnessId: r.harnessId,
    agentId: r.agentId,
    tools: [...r.tools],
    runs: r.seeds.length,
    time: r.time,
    profiles: r.profiles,
    metadata: metaRows(parent.metadata),
    escalation: r.escalation ?? { mode: "auto", reply: DEFAULT_AUTO_REPLY },
    faultScope: r.faultScope ?? "all",
    sop: r.sop ?? "none",
  };
}

/** What the fork changes, in words, before it runs. */
export function forkChanges(parent: Experiment, draft: Draft): RecipeChange[] {
  const recipe = recipeOf(draft);
  return recipe ? recipeDiff(parent.recipe, recipe) : [];
}

export function toForkRequest(parent: Experiment, draft: Draft): ForkRequest {
  const recipe = recipeOf(draft);
  if (!recipe) throw new Error("실험 조건이 다 정해지지 않았어요");
  const change: Record<string, unknown> = {};
  // a setting that went back to its default is sent as that default, so the fork does not keep the parent's
  const back: Partial<Record<keyof Recipe, unknown>> = {
    escalation: { mode: "auto" },
    faultScope: "all",
    sop: "none",
  };
  for (const c of recipeDiff(parent.recipe, recipe))
    change[c.field] = recipe[c.field] ?? back[c.field];
  const metadata = metadataOf(draft.metadata);
  return {
    change: change as ForkRequest["change"],
    // Left out when it is the parent's, so the fork keeps it.
    ...(sameMeta(metadata, parent.metadata ?? {}) ? {} : { metadata }),
    ...(draft.name.trim() && draft.name.trim() !== `${parent.name} (포크)`
      ? { name: draft.name.trim() }
      : {}),
    ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
  };
}

/** The benchmark set changes when the task changes (world, scenario, time, product versions). */
export function leavesBenchmarkSet(changes: readonly RecipeChange[]): boolean {
  return changes.some((c) => ["worldId", "scenarioId", "time", "profiles"].includes(c.field));
}
