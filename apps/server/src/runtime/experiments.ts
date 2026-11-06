/**
 * Experiments (REQ-030, REQ-040): create, fork, add runs, cancel, and the views people look at.
 * A recipe is checked against what really exists — the harness's agents, product versions, a
 * scenario that runs on that world — before a single run is queued.
 */
import {
  analyzeExperiment,
  type ExperimentAnalysis,
  type Telemetry,
} from "@terrarium/core/analysis";
import {
  type AddRunsRequest,
  type CreateExperimentRequest,
  type ExperimentQueryParams,
  type ExperimentSummary,
  type ExperimentView,
  type ForkRequest,
  InvalidInputError,
  type RecipeRequest,
  type RunSummary,
  UnavailableError,
} from "@terrarium/core/contract";
import {
  benchmarkKey,
  DEFAULT_SEEDS,
  type Experiment,
  type ExperimentFilter,
  experimentStatus,
  forkExperiment,
  isTerminal,
  newRun,
  normalizeTools,
  progressOf,
  type Recipe,
  type RunRecord,
  recipeProblems,
  type Snapshot,
  type Subject,
  seedsUpTo,
} from "@terrarium/core/experiments";
import { InvalidValueError } from "@terrarium/core/kernel";
import { ORACLE_VERSION } from "@terrarium/core/oracle";
import { BUILTIN_PROFILES } from "@terrarium/core/profiles";
import { hasErrors, type ScenarioDoc, scopeCheck } from "@terrarium/core/scenario";
import { DEFAULT_TIME } from "@terrarium/core/session";
import type { AgentVersions } from "./agent-versions";
import { must, ownerOnly, type PlatformContext, type Viewer } from "./context";
import type { Dispatcher } from "./dispatcher";
import { summaryOf } from "./executor";
import type { Scenarios } from "./scenarios";
import { present, subjectOf } from "./subject";

const PROFILE_KEYS = {
  vcenter: BUILTIN_PROFILES.filter((p) => p.protocol === "vcenter").map((p) => p.key),
  vrops: BUILTIN_PROFILES.filter((p) => p.protocol === "vrops").map((p) => p.key),
};

const asIssues = (problems: readonly string[], path = "recipe") =>
  problems.map((message) => ({ path, message }));

const FILTER_KEYS = ["owner", "worldId", "scenarioId", "benchmarkKey", "parentId", "meta"] as const;

/** The parts of a query the store can filter on; the text search is called `q` in an address and `text` in the store. */
function filterOf(query: ExperimentQueryParams): ExperimentFilter {
  const filter: Record<string, string> = {};
  for (const key of FILTER_KEYS) if (query[key]) filter[key] = query[key];
  if (query.q) filter.text = query.q;
  return filter;
}

export function summarize(experiment: Experiment, runs: readonly RunRecord[]): ExperimentSummary {
  const done = runs.filter((r) => r.status === "completed" && r.result);
  const scores = done
    .map((r) => r.result?.score.total)
    .filter((s): s is number => typeof s === "number");
  return {
    experiment,
    status: experimentStatus(runs),
    progress: progressOf(runs),
    passRate:
      done.length === 0 ? 0 : done.filter((r) => r.result?.score.passed).length / done.length,
    ...(scores.length > 0
      ? { meanScore: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 }
      : {}),
  };
}

/**
 * What a fork changes in the recipe. Finding the runbook is a tool the agent needs, so a change of the tools or of the
 * runbook choice leaves the tool list agreeing with it: "찾게 함" has the finder, any other choice does not.
 */
function forkChange(parent: Recipe, change: ForkRequest["change"]): Partial<Recipe> {
  const sop = change.sop ?? parent.sop;
  const tools = change.tools ?? (change.sop ? parent.tools : undefined);
  if (!tools) return change;
  const wanted = sop === "search" ? [...tools, FINDER] : tools.filter((t) => t !== FINDER);
  return { ...change, tools: normalizeTools(wanted) };
}

const FINDER = "search_runbooks";

export class Experiments {
  constructor(
    private readonly ctx: PlatformContext,
    private readonly scenarios: Scenarios,
    private readonly dispatcher: Dispatcher,
    private readonly versions: AgentVersions,
  ) {}

  async get(id: string): Promise<Experiment> {
    return must(await this.ctx.store.getExperiment(id), `실험 ${id}`);
  }

  /** What a recipe points at, checked: the world, a runnable scenario on it, the harness's agents. */
  private async resolve(recipe: Recipe): Promise<{ snapshot: Snapshot; subject: Subject }> {
    const world = must(await this.ctx.store.getWorld(recipe.worldId), `세계 ${recipe.worldId}`);
    const scenario = must(
      await this.ctx.store.getScenario(recipe.scenarioId),
      `시나리오 ${recipe.scenarioId}`,
    );
    if (scenario.worldId !== world.id)
      throw new InvalidValueError(
        `시나리오 '${scenario.name}'은 다른 세계(${scenario.worldId})의 것이에요`,
      );
    const issues = await this.scenarios.issuesOf(scenario.doc);
    if (hasErrors(issues))
      throw new InvalidInputError(
        `시나리오 '${scenario.name}'에 고칠 곳이 있어 실행할 수 없어요`,
        issues
          .filter((i) => i.severity === "error")
          .map((i) => ({ path: "recipe.scenarioId", message: i.message })),
      );
    this.checkScope(recipe, scenario.doc, scenario.name);
    const subject = await this.checkRecipe(recipe);
    return {
      snapshot: {
        worldDigest: world.digest,
        worldName: world.name,
        scenarioDigest: scenario.digest,
        scenarioName: scenario.name,
        oracle: ORACLE_VERSION,
      },
      subject,
    };
  }

  /** With faults limited to the given tools, a scenario those tools cannot solve is refused, with the missing tool. */
  private checkScope(recipe: Recipe, doc: ScenarioDoc, name: string): void {
    if (recipe.faultScope !== "inside") return;
    const scope = scopeCheck(doc, recipe.tools);
    if (!scope.inScope)
      throw new InvalidInputError(`시나리오 '${name}'은 준 툴로 풀 수 없어요: ${scope.reason}`, [
        { path: "recipe.faultScope", message: scope.reason ?? "준 툴 밖의 시나리오예요" },
      ]);
  }

  /** A fork on the same scenario version still has to be solvable with the tools it now gives. */
  private async checkKeptScope(target: Recipe, snapshot: Snapshot): Promise<void> {
    if (target.faultScope !== "inside") return;
    const doc = await this.ctx.store.scenarioVersion(target.scenarioId, snapshot.scenarioDigest);
    if (doc) this.checkScope(target, doc, snapshot.scenarioName);
  }

  /** The harness answers and has the agent; returns who that is, to keep with the experiment (REQ-052). */
  private async checkRecipe(recipe: Recipe): Promise<Subject> {
    const harness = must(this.ctx.harnesses.get(recipe.harnessId), `하네스 '${recipe.harnessId}'`);
    const agents = await harness.agents().catch((err: Error) => {
      throw new UnavailableError(
        `하네스 '${harness.info.name}'에 연결할 수 없어요: ${err.message}`,
      );
    });
    const problems = recipeProblems(recipe, {
      profiles: PROFILE_KEYS,
      agents: agents.map((a) => a.id),
    });
    if (problems.length > 0)
      throw new InvalidInputError("실험 조건을 확인해 주세요", asIssues(problems));
    return subjectOf(
      harness.info,
      agents.find((a) => a.id === recipe.agentId),
      this.ctx.harnesses.metadata?.(harness.info.id),
    );
  }

  private recipeOf(req: RecipeRequest): Recipe {
    // finding the runbook is a tool the agent needs, so choosing "찾게 함" gives it
    const tools = normalizeTools(
      req.sop === "search" ? [...req.tools, "search_runbooks"] : req.tools,
    );
    return {
      worldId: req.worldId,
      scenarioId: req.scenarioId,
      harnessId: req.harnessId,
      agentId: req.agentId,
      tools,
      seeds: req.seeds ?? (req.runs ? seedsUpTo(req.runs) : [...DEFAULT_SEEDS]),
      time: req.time ?? DEFAULT_TIME,
      profiles: req.profiles ?? {},
      ...(req.escalation ? { escalation: req.escalation } : {}),
      ...(req.faultScope ? { faultScope: req.faultScope } : {}),
      ...(req.sop ? { sop: req.sop } : {}),
      ...(req.domains && req.domains.length > 0 ? { domains: req.domains } : {}),
      ...(req.leadTimes ? { leadTimes: req.leadTimes } : {}),
    };
  }

  /** Store the experiment and its runs, and queue them. */
  private async launch(
    experiment: Experiment,
    seeds: readonly number[],
    firstIndex = 0,
  ): Promise<void> {
    await this.ctx.store.putExperiment(experiment);
    // A connection with experiments on it is in use: its removal clock starts over (REQ-051).
    await this.ctx.harnesses.touch?.(experiment.recipe.harnessId);
    for (const [i, seed] of seeds.entries()) {
      const index = firstIndex + i;
      const run = newRun(
        this.ctx.stamps.id("r"),
        experiment.id,
        index,
        seed,
        this.ctx.stamps.now(),
      );
      await this.ctx.store.putRun(run);
      this.dispatcher.enqueue(run, experiment);
    }
  }

  async create(viewer: Viewer, req: CreateExperimentRequest): Promise<ExperimentView> {
    const recipe = this.recipeOf(req.recipe);
    const { snapshot, subject } = await this.resolve(recipe);
    const experiment: Experiment = {
      id: this.ctx.stamps.id("e"),
      name: req.name,
      owner: viewer.name,
      createdAt: this.ctx.stamps.now(),
      recipe,
      snapshot,
      benchmarkKey: benchmarkKey(snapshot, recipe),
      ...(req.note ? { note: req.note } : {}),
      ...(present(req.metadata) ? { metadata: req.metadata } : {}),
      subject,
      agentVersion: await this.versions.observe(viewer, subject),
    };
    await this.launch(experiment, recipe.seeds);
    return this.view(viewer, experiment.id);
  }

  async fork(viewer: Viewer, id: string, req: ForkRequest): Promise<ExperimentView> {
    const parent = await this.get(id);
    const change = forkChange(parent.recipe, req.change);
    const target = { ...parent.recipe, ...change };
    // Same world and scenario: the same versions the parent ran. Another one: its current version.
    const sameTask =
      target.worldId === parent.recipe.worldId && target.scenarioId === parent.recipe.scenarioId;
    if (sameTask) await this.checkKeptScope(target, parent.snapshot);
    const resolved = sameTask ? undefined : await this.resolve(target);
    const snapshot = resolved?.snapshot ?? parent.snapshot;
    // A fork runs the agent as it is now, which may differ from the parent's agent (REQ-053).
    const subject = resolved?.subject ?? (await this.checkRecipe(target));
    const forked = forkExperiment(
      parent,
      change,
      {
        id: this.ctx.stamps.id("e"),
        owner: viewer.name,
        createdAt: this.ctx.stamps.now(),
        ...(req.name ? { name: req.name } : {}),
        ...(req.note ? { note: req.note } : {}),
        ...(req.metadata ? { metadata: req.metadata } : {}),
        subject,
      },
      snapshot,
    );
    // Looked at only now: a fork that is refused for changing nothing leaves the agent's versions alone.
    const child = { ...forked, agentVersion: await this.versions.observe(viewer, subject) };
    await this.launch(child, child.recipe.seeds);
    return this.view(viewer, child.id);
  }

  async addRuns(viewer: Viewer, id: string, req: AddRunsRequest): Promise<ExperimentView> {
    const experiment = await this.get(id);
    ownerOnly(viewer, experiment.owner, "실행 더하기");
    const runs = await this.ctx.store.listRuns(id);
    const used = new Set(runs.map((r) => r.seed));
    const top = Math.max(0, ...used);
    const seeds = req.seeds ?? Array.from({ length: req.count ?? 1 }, (_, i) => top + i + 1);
    const again = seeds.filter((s) => used.has(s));
    if (again.length > 0)
      throw new InvalidInputError("이미 돌린 시드예요", [
        { path: "seeds", message: `시드 ${again.join(", ")}는 이미 있어요` },
      ]);
    const updated = {
      ...experiment,
      recipe: { ...experiment.recipe, seeds: [...experiment.recipe.seeds, ...seeds] },
    };
    await this.launch(updated, seeds, runs.length);
    return this.view(viewer, id);
  }

  async cancel(viewer: Viewer, id: string): Promise<ExperimentView> {
    const experiment = await this.get(id);
    ownerOnly(viewer, experiment.owner, "실험 멈추기");
    const runs = await this.ctx.store.listRuns(id);
    await Promise.all(
      runs.filter((r) => !isTerminal(r.status)).map((r) => this.dispatcher.cancel(r.id)),
    );
    return this.view(viewer, id);
  }

  async summaryOf(experiment: Experiment): Promise<ExperimentSummary> {
    return summarize(experiment, await this.ctx.store.listRuns(experiment.id));
  }

  async list(query: ExperimentQueryParams): Promise<ExperimentSummary[]> {
    const found = await this.ctx.store.listExperiments(filterOf(query));
    const out: ExperimentSummary[] = [];
    for (const e of found) {
      const summary = await this.summaryOf(e);
      if (query.status === undefined || summary.status === query.status) out.push(summary);
      if (out.length >= (query.limit ?? 50)) break;
    }
    return out;
  }

  /** The experiment analysed (with harness telemetry when given), against its parent's when it is a fork. */
  async analysis(
    experiment: Experiment,
    runs?: readonly RunRecord[],
    telemetry?: ReadonlyMap<string, Telemetry>,
  ): Promise<ExperimentAnalysis> {
    const own = runs ?? (await this.ctx.store.listRuns(experiment.id));
    const parent = experiment.parentId
      ? await this.ctx.store.getExperiment(experiment.parentId)
      : undefined;
    const parentAnalysis = parent
      ? analyzeExperiment({ experiment: parent, runs: await this.ctx.store.listRuns(parent.id) })
      : undefined;
    return analyzeExperiment(
      { experiment, runs: own, ...(telemetry ? { telemetry } : {}) },
      parentAnalysis,
    );
  }

  private async ancestors(experiment: Experiment): Promise<ExperimentSummary[]> {
    const chain: ExperimentSummary[] = [];
    const seen = new Set([experiment.id]);
    for (let id = experiment.parentId; id && !seen.has(id); ) {
      seen.add(id);
      const e = await this.ctx.store.getExperiment(id);
      if (!e) break;
      chain.unshift(await this.summaryOf(e));
      id = e.parentId;
    }
    return chain;
  }

  private runSummary(run: RunRecord): RunSummary {
    const position = run.status === "queued" ? this.dispatcher.positionOf(run.id) : undefined;
    return { ...summaryOf(run), ...(position ? { queuePosition: position } : {}) };
  }

  async view(viewer: Viewer, id: string): Promise<ExperimentView> {
    const experiment = await this.get(id);
    const runs = await this.ctx.store.listRuns(id);
    const forks = await this.ctx.store.listExperiments({ parentId: id });
    const summary = summarize(experiment, runs);
    return {
      ...summary,
      runs: runs.map((r) => this.runSummary(r)),
      analysis: await this.analysis(experiment, runs),
      ancestors: await this.ancestors(experiment),
      forks: await Promise.all(forks.reverse().map((f) => this.summaryOf(f))),
      canCancel: viewer.name === experiment.owner && !isTerminal(summary.status),
    };
  }
}
