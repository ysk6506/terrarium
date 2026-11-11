/**
 * Making an experiment (REQ-030) and making one from another (REQ-040). The form keeps a draft; this
 * checks it with the same rules the server uses, turns it into a request, and for a fork shows exactly
 * what will differ from the original before anything runs.
 */
import type { CreateExperimentRequest, ForkRequest } from "@terrarium/core/contract";
import {
  type Experiment,
  MAX_REPEATS,
  MAX_SEEDS,
  normalizeTools,
  OPERATION_SCENARIO_ID,
  type Recipe,
  type RecipeChange,
  recipeDiff,
  recipeProblems,
  seedsUpTo,
  sizeProblemsOf,
} from "@terrarium/core/experiments";
import { BUILTIN_PROFILES } from "@terrarium/core/profiles";
import { type ScenarioDoc, scopeCheck } from "@terrarium/core/scenario";
import {
  DEFAULT_AUTO_REPLY,
  DEFAULT_OPERATION,
  DEFAULT_TIME,
  type EscalationPolicy,
  type FaultScope,
  type OperationConfig,
  operationProblem,
  type SopMode,
  type TimePolicy,
} from "@terrarium/core/session";
import {
  DEFAULT_TOOLSET,
  OPT_IN_TOOLS,
  TOOL_SPECS,
  type ToolCategory,
  type ToolSpec,
  toolsForDomains,
} from "@terrarium/core/tools";
import {
  DEFAULT_LEAD_SETTINGS,
  type Domain,
  isDefaultLeadSettings,
  type LeadTimeSettings,
} from "@terrarium/core/world";
import { SLOT_PENDING_PROBLEM } from "./connection-places";

import { type MetaRow, metadataOf } from "./connections";
import { DEFAULT_REPEATS, RECOMMENDED_RUNS, repeatsRange, runsRange } from "./how-words";

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
  /** How many times each seed is run (ADR-0158); 1 is the usual and is left out of the recipe. */
  readonly repeats: number;
  readonly time: TimePolicy;
  readonly profiles: { readonly vcenter?: string; readonly vrops?: string };
  /** The domains the experiment is responsible for (REQ-093); none means every domain is its own. */
  readonly domains: readonly Domain[];
  /** Vendor SLA, spare parts and surcharge; left out, the defaults of the lead-time table. */
  readonly leadTimes?: LeadTimeSettings;
  /** `name=value` pairs attached to the experiment to tell results apart (REQ-052). */
  readonly metadata: readonly MetaRow[];
  /** What happens when the agent asks a person for help (REQ-081). */
  readonly escalation: EscalationPolicy;
  /** Whether faults are limited to what the given tools can solve (REQ-080). */
  readonly faultScope: FaultScope;
  /** Whether the agent gets the scenario's runbook (REQ-082). */
  readonly sop: SopMode;
  /** An operation instead of one incident (REQ-090): set, the scenario is not chosen. */
  readonly operation?: OperationConfig;
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
  repeats: DEFAULT_REPEATS,
  time: DEFAULT_TIME,
  profiles: {},
  domains: [],
  metadata: [],
  escalation: { mode: "auto", reply: DEFAULT_AUTO_REPLY },
  faultScope: "all",
  sop: "none",
});

const OPTIONAL_TOOLS: readonly string[] = [
  ...TOOL_SPECS.filter((t) => t.optional).map((t) => t.name),
  ...OPT_IN_TOOLS,
];

/**
 * Choosing the domains an experiment is responsible for turns on their tools (and `escalate` with `events_since`);
 * choosing none puts the usual set back. The optional tools the person switched on stay as they were.
 */
export function setDomains(draft: Draft, domains: readonly Domain[]): Draft {
  const kept = draft.tools.filter(
    (t) => OPTIONAL_TOOLS.includes(t) && t !== "escalate" && t !== "events_since",
  );
  const base = domains.length > 0 ? toolsForDomains(domains, TOOL_SPECS) : [...DEFAULT_TOOLSET];
  const { leadTimes: _drop, ...rest } = draft;
  const next = { ...rest, domains, tools: [...new Set([...base, ...kept])] };
  return domains.length > 0 && draft.leadTimes ? { ...next, leadTimes: draft.leadTimes } : next;
}

/** Change one of the vendor and spare-part settings; back to the defaults, nothing is kept. */
export function setLeadTimes(draft: Draft, change: Partial<LeadTimeSettings> | undefined): Draft {
  const merged = change === undefined ? undefined : { ...draft.leadTimes, ...change };
  const { leadTimes: _drop, ...rest } = draft;
  return merged && !isDefaultLeadSettings(merged) ? { ...rest, leadTimes: merged } : rest;
}

/** Whether a setting differs from the default: the form marks it. */
export const leadChanged = (draft: Draft, key: keyof LeadTimeSettings): boolean =>
  draft.leadTimes?.[key] !== undefined && draft.leadTimes[key] !== DEFAULT_LEAD_SETTINGS[key];

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

/** Repeats go in the recipe only above one, so an experiment that does not repeat reads as it always did. */
const repeatsPart = (draft: Draft) => (draft.repeats > 1 ? { repeats: draft.repeats } : {});

/** The recipe the draft stands for, once world, scenario, harness and agent are chosen. */
export function recipeOf(draft: Draft): Recipe | undefined {
  const scenarioId = draft.operation ? OPERATION_SCENARIO_ID : draft.scenarioId;
  if (!draft.worldId || !scenarioId || !draft.harnessId || !draft.agentId) return undefined;
  return {
    worldId: draft.worldId,
    scenarioId,
    harnessId: draft.harnessId,
    agentId: draft.agentId,
    tools: normalizeTools(draft.tools),
    seeds: seedsUpTo(draft.runs),
    ...repeatsPart(draft),
    time: draft.time,
    profiles: draft.profiles,
    // only where they matter, so an experiment that does not use them reads as it always did
    ...(draft.tools.includes("ask_human") ? { escalation: draft.escalation } : {}),
    ...(draft.faultScope === "inside" ? { faultScope: draft.faultScope } : {}),
    ...(draft.sop !== "none" ? { sop: draft.sop } : {}),
    ...(draft.domains.length > 0 ? { domains: draft.domains } : {}),
    ...(draft.leadTimes ? { leadTimes: draft.leadTimes } : {}),
    ...(draft.operation ? { operation: draft.operation } : {}),
  };
}

/** The tools an operation starts with on top of the usual ones. */
const OPERATION_TOOLS: readonly string[] = [
  "events_since",
  "wait",
  "list_alarms",
  "service_status",
];

/** Switch between one incident and an operation; an operation starts as eight real-time hours at "보통". */
export function setKind(draft: Draft, operation: boolean): Draft {
  const { operation: _drop, scenarioId: _scenario, ...rest } = draft;
  if (!operation) return rest;
  // an operation is watched by pulling: the news and the waiting are what it is made of
  const tools = [...new Set([...rest.tools, ...OPERATION_TOOLS])];
  return { ...rest, tools, operation: DEFAULT_OPERATION };
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

/** What is wrong with the choice of scenario or operation. */
function whatProblems(draft: Draft, scenario: ScenarioDoc | undefined): string[] {
  const out: string[] = [];
  if (!draft.scenarioId && !draft.operation) out.push("시나리오를 골라 주세요");
  const opProblem = draft.operation && operationProblem(draft.operation);
  if (opProblem) out.push(opProblem);
  if (draft.faultScope === "inside" && scenario) {
    const scope = scopeCheck(scenario, [...draft.tools, "submit_diagnosis"]);
    if (!scope.inScope)
      out.push(
        `준 툴 안에서만으로는 이 시나리오를 못 풀어요: ${(scope.reason ?? "").replaceAll("`", "")}`,
      );
  }
  return out;
}

/**
 * What is still missing or wrong, by step of the form. Empty everywhere means it can start. With faults limited to
 * the given tools, a scenario those tools cannot solve is a problem of step 1.
 */
/** The size of the experiment against the limits, in the words of the form: seeds first, then repeats, then both. */
function sizeProblemsOfDraft(draft: Draft): string[] {
  if (draft.runs < 1 || draft.runs > MAX_SEEDS) return [runsRange(MAX_SEEDS)];
  if (!Number.isInteger(draft.repeats) || draft.repeats < 1 || draft.repeats > MAX_REPEATS)
    return [repeatsRange()];
  return sizeProblemsOf(draft.runs, draft.repeats);
}

/** How many runs the draft makes, seeds times repeats. */
export const runCount = (draft: Draft): number => draft.runs * draft.repeats;

export function draftProblems(
  draft: Draft,
  agents?: readonly string[],
  scenario?: ScenarioDoc,
  slotPending = false,
): Readonly<Record<Step, readonly string[]>> {
  const what: string[] = [];
  const who: string[] = [];
  const how: string[] = [];
  if (!draft.worldId) what.push("세계를 골라 주세요");
  what.push(...whatProblems(draft, scenario));
  if (!draft.harnessId) who.push("하네스를 골라 주세요");
  else if (!draft.agentId) who.push("에이전트를 골라 주세요");
  else if (slotPending) who.push(SLOT_PENDING_PROBLEM);
  how.push(...sizeProblemsOfDraft(draft));
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
      ...(recipe.repeats ? { repeats: recipe.repeats } : {}),
      time: recipe.time,
      profiles: recipe.profiles,
      ...(recipe.escalation ? { escalation: recipe.escalation } : {}),
      ...(recipe.faultScope ? { faultScope: recipe.faultScope } : {}),
      ...(recipe.sop ? { sop: recipe.sop } : {}),
      ...(recipe.domains ? { domains: [...recipe.domains] } : {}),
      ...(recipe.leadTimes ? { leadTimes: recipe.leadTimes } : {}),
      ...(recipe.operation ? { operation: recipe.operation } : {}),
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
    repeats: r.repeats ?? DEFAULT_REPEATS,
    time: r.time,
    profiles: r.profiles,
    domains: r.domains ?? [],
    ...(r.leadTimes ? { leadTimes: r.leadTimes } : {}),
    metadata: metaRows(parent.metadata),
    escalation: r.escalation ?? { mode: "auto", reply: DEFAULT_AUTO_REPLY },
    faultScope: r.faultScope ?? "all",
    sop: r.sop ?? "none",
    ...(r.operation ? { operation: r.operation } : {}),
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
    domains: [],
    leadTimes: {},
    repeats: DEFAULT_REPEATS,
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
  return changes.some((c) =>
    ["worldId", "scenarioId", "time", "profiles", "domains", "leadTimes", "operation"].includes(
      c.field,
    ),
  );
}
