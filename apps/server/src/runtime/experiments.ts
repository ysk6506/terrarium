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
  type QuickExperimentRequest,
  type QuickExperimentView,
  type RecipeRequest,
  type RunSummary,
  type ScopeRequest,
  UnavailableError,
} from "@terrarium/core/contract";
import {
  benchmarkKey,
  DEFAULT_SEEDS,
  type Experiment,
  forkExperiment,
  isTerminal,
  newRun,
  normalizeTools,
  OPERATION_SCENARIO_ID,
  type Recipe,
  type RunRecord,
  recipeProblems,
  repeatsOf,
  type Sight,
  type Snapshot,
  type Subject,
  seedsUpTo,
  seen,
  sizeProblems,
} from "@terrarium/core/experiments";
import { hashValue, InvalidValueError } from "@terrarium/core/kernel";
import { ORACLE_VERSION } from "@terrarium/core/oracle";
import { fingerprintOf } from "@terrarium/core/physics/slots";
import { BUILTIN_PROFILES } from "@terrarium/core/profiles";
import { hasErrors, type ScenarioDoc, scopeCheck } from "@terrarium/core/scenario";
import {
  DEFAULT_TIME,
  type OperationConfig,
  operationKey,
  operationProblem,
  paceLabel,
} from "@terrarium/core/session";
import type { Blueprint } from "@terrarium/core/world";
import type { AgentVersions } from "./agent-versions";
import { must, type PlatformContext, type Viewer } from "./context";
import type { Dispatcher } from "./dispatcher";
import { summaryOf } from "./executor";
import {
  asIssues,
  filterOf,
  forkChange,
  optionsOf,
  planOf,
  REAL_TIME,
  type RunPlan,
} from "./experiment-plan";
import { summarize } from "./experiment-summary";
import { quickPlan } from "./experiments-quick";
import { Gate } from "./gate";
import { allow, allowRunOn, mayCancel, mustSee, sightOf, standing } from "./permissions";
import type { Scenarios } from "./scenarios";
import { canChangeScope, changeScope, startingScope } from "./scoping";
import { present, subjectOf } from "./subject";
import type { Titles } from "./titles";

export { summarize };

const PROFILE_KEYS = {
  vcenter: BUILTIN_PROFILES.filter((p) => p.protocol === "vcenter").map((p) => p.key),
  vrops: BUILTIN_PROFILES.filter((p) => p.protocol === "vrops").map((p) => p.key),
};

export class Experiments {
  constructor(
    private readonly ctx: PlatformContext,
    private readonly scenarios: Scenarios,
    private readonly dispatcher: Dispatcher,
    private readonly versions: AgentVersions,
    private readonly titles?: Titles,
  ) {
    this.gate = new Gate(ctx);
  }

  private readonly gate: Gate;

  async get(id: string): Promise<Experiment> {
    return must(await this.ctx.store.getExperiment(id), `실험 ${id}`);
  }

  /** What a recipe points at, checked: the world, a runnable scenario on it, the harness's agents. */
  private async resolve(recipe: Recipe): Promise<{ snapshot: Snapshot; subject: Subject }> {
    const world = must(await this.ctx.store.getWorld(recipe.worldId), `세계 ${recipe.worldId}`);
    if (recipe.operation) return this.resolveOperation(recipe, world);
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
        physics: fingerprintOf(world.blueprint.physics),
      },
      subject,
    };
  }

  /** An operation has no stored scenario: its task is the config itself, so the digest is the config's. */
  private async resolveOperation(
    recipe: Recipe,
    world: { readonly digest: string; readonly name: string; readonly blueprint: Blueprint },
  ): Promise<{ snapshot: Snapshot; subject: Subject }> {
    const operation = recipe.operation as OperationConfig;
    const problem = operationProblem(operation);
    if (problem)
      throw new InvalidInputError(problem, [{ path: "recipe.operation", message: problem }]);
    return {
      snapshot: {
        worldDigest: world.digest,
        worldName: world.name,
        scenarioDigest: hashValue(operationKey(operation)),
        scenarioName: `${operation.hours}시간 운영 · ${paceLabel(operation.pace)}`,
        oracle: ORACLE_VERSION,
        physics: fingerprintOf(world.blueprint.physics),
      },
      subject: await this.checkRecipe(recipe),
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
    if (recipe.operation?.wakeOnAlarm && !harness.info.wakeable)
      throw new InvalidInputError("알람마다 깨우기를 쓸 수 없는 연결이에요", [
        {
          path: "recipe.operation.wakeOnAlarm",
          message: `'${harness.info.name}'은 알람 요약을 받을 수 없어요. 끄고 돌리면 에이전트가 직접 확인해요`,
        },
      ]);
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
      scenarioId: req.operation ? OPERATION_SCENARIO_ID : req.scenarioId,
      harnessId: req.harnessId,
      agentId: req.agentId,
      tools,
      seeds: req.seeds ?? (req.runs ? seedsUpTo(req.runs) : [...DEFAULT_SEEDS]),
      // left out when once, so a recipe that does not repeat reads as it always did
      ...(req.repeats && req.repeats > 1 ? { repeats: req.repeats } : {}),
      time: req.operation ? REAL_TIME : (req.time ?? DEFAULT_TIME),
      profiles: req.profiles ?? {},
      ...optionsOf(req),
    };
  }

  /** Store the experiment and its runs, and queue them. */
  private async launch(
    experiment: Experiment,
    plan: readonly RunPlan[],
    firstIndex = 0,
  ): Promise<void> {
    await this.ctx.store.putExperiment(experiment);
    // A connection with experiments on it is in use: its removal clock starts over (REQ-051).
    await this.ctx.harnesses.touch?.(experiment.recipe.harnessId);
    for (const [i, { seed, repeat }] of plan.entries()) {
      const run = newRun(
        this.ctx.stamps.id("r"),
        experiment.id,
        firstIndex + i,
        seed,
        this.ctx.stamps.now(),
        repeat,
      );
      await this.ctx.store.putRun(run);
      this.dispatcher.enqueue(run, experiment);
    }
  }

  /**
   * Using needs sight: the world, the scenario and the connection a recipe points at must all be ones the person can see.
   * One that is not there is left to the checks that name it.
   */
  private async mustSeeRecipe(
    viewer: Viewer,
    recipe: Pick<Recipe, "worldId" | "scenarioId" | "harnessId">,
  ): Promise<void> {
    allowRunOn(viewer, this.ctx.harnesses, recipe.harnessId);
    const world = await this.ctx.store.getWorld(recipe.worldId);
    if (world) mustSee(viewer, standing(world), `세계 ${recipe.worldId}`);
    const scenario = await this.ctx.store.getScenario(recipe.scenarioId);
    if (scenario) mustSee(viewer, standing(scenario), `시나리오 ${recipe.scenarioId}`);
  }

  async create(viewer: Viewer, req: CreateExperimentRequest): Promise<ExperimentView> {
    await this.mustSeeRecipe(viewer, req.recipe);
    const recipe = this.recipeOf(req.recipe);
    const { snapshot, subject } = await this.resolve(recipe);
    const experiment: Experiment = {
      id: this.ctx.stamps.id("e"),
      name: req.name,
      owner: viewer.id,
      createdAt: this.ctx.stamps.now(),
      recipe,
      snapshot,
      benchmarkKey: benchmarkKey(snapshot, recipe),
      ...(req.note ? { note: req.note } : {}),
      ...(present(req.metadata) ? { metadata: req.metadata } : {}),
      subject,
      agentVersion: await this.versions.observe(viewer, subject),
      // an experiment is for everyone unless its maker says otherwise: the leaderboards are made of them
      ...startingScope(viewer, req, "everyone"),
    };
    await this.launch(experiment, planOf(recipe.seeds, 1, repeatsOf(recipe)));
    return this.view(viewer, experiment.id);
  }

  /** "실험 시작" in one request: the recommended settings for the world, created and queued as any experiment. */
  async quick(
    viewer: Viewer,
    worldId: string,
    req: QuickExperimentRequest,
  ): Promise<QuickExperimentView> {
    // using a world needs sight of it, before anything about it is worked out
    await this.gate.world(viewer, worldId);
    const plan = await quickPlan(this.ctx, viewer, worldId, req);
    const view = await this.create(viewer, plan.request);
    return { experimentId: view.experiment.id, ...plan.info };
  }

  async fork(viewer: Viewer, id: string, req: ForkRequest): Promise<ExperimentView> {
    const parent = await this.gate.experiment(viewer, id);
    const change = forkChange(parent.recipe, req.change);
    const target = { ...parent.recipe, ...change };
    await this.mustSeeRecipe(viewer, target);
    // Same world and scenario: the same versions the parent ran. Another one: its current version.
    const sameTask =
      target.worldId === parent.recipe.worldId &&
      target.scenarioId === parent.recipe.scenarioId &&
      target.operation === parent.recipe.operation;
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
        owner: viewer.id,
        createdAt: this.ctx.stamps.now(),
        ...(req.name ? { name: req.name } : {}),
        ...(req.note ? { note: req.note } : {}),
        ...(req.metadata ? { metadata: req.metadata } : {}),
        subject,
      },
      snapshot,
    );
    // Looked at only now: a fork that is refused for changing nothing leaves the agent's versions alone.
    const child = {
      ...forked,
      agentVersion: await this.versions.observe(viewer, subject),
      ...startingScope(viewer, req, "everyone"),
    };
    await this.launch(child, planOf(child.recipe.seeds, 1, repeatsOf(child.recipe)));
    return this.view(viewer, child.id);
  }

  /**
   * More runs (ADR-0158 item 5). New seeds are run as many times as the experiment repeats each seed now; more repeats
   * add rounds to every seed it has. Either way the recipe says what the experiment is now, and stays within the limits.
   */
  async addRuns(viewer: Viewer, id: string, req: AddRunsRequest): Promise<ExperimentView> {
    const experiment = await this.gate.experiment(viewer, id);
    allow(viewer, "addRuns", { owner: experiment.owner }, "실행 더하기");
    const runs = await this.ctx.store.listRuns(id);
    const { recipe } = experiment;
    const repeats = repeatsOf(recipe);
    const more = req.repeats === undefined ? undefined : repeats + req.repeats;
    const seeds = more === undefined ? this.newSeeds(runs, req) : [];
    const next: Recipe = {
      ...recipe,
      seeds: [...recipe.seeds, ...seeds],
      ...(more === undefined ? {} : { repeats: more }),
    };
    const problems = sizeProblems(next);
    if (problems.length > 0)
      throw new InvalidInputError("실행을 더할 수 없어요", asIssues(problems, "recipe"));
    const plan =
      more === undefined ? planOf(seeds, 1, repeats) : planOf(recipe.seeds, repeats + 1, more);
    await this.launch({ ...experiment, recipe: next }, plan, runs.length);
    return this.view(viewer, id);
  }

  /** The seeds a request adds: the ones it names, or the next ones after the largest; a seed already run is refused. */
  private newSeeds(runs: readonly RunRecord[], req: AddRunsRequest): number[] {
    const used = new Set(runs.map((r) => r.seed));
    const top = Math.max(0, ...used);
    const seeds = req.seeds ?? Array.from({ length: req.count ?? 1 }, (_, i) => top + i + 1);
    const again = seeds.filter((s) => used.has(s));
    if (again.length > 0)
      throw new InvalidInputError("이미 돌린 상황이에요", [
        { path: "seeds", message: `상황 ${again.join(", ")}번은 이미 있어요` },
      ]);
    return seeds;
  }

  async cancel(viewer: Viewer, id: string): Promise<ExperimentView> {
    const experiment = await this.gate.experiment(viewer, id);
    allow(viewer, "cancel", { owner: experiment.owner }, "실험 멈추기");
    const runs = await this.ctx.store.listRuns(id);
    await Promise.all(
      runs.filter((r) => !isTerminal(r.status)).map((r) => this.dispatcher.cancel(r.id)),
    );
    return this.view(viewer, id);
  }

  async summaryOf(experiment: Experiment): Promise<ExperimentSummary> {
    return summarize(experiment, await this.ctx.store.listRuns(experiment.id));
  }

  /** Who changes the scope of an experiment: its maker and admins; the views say so. */
  private standingOf(viewer: Viewer, summary: ExperimentSummary): ExperimentSummary {
    return { ...summary, canChangeScope: canChangeScope(viewer, summary.experiment.owner) };
  }

  /** Change who can see an experiment; its runs, reports and streams follow (ADR-0174). */
  async setScope(viewer: Viewer, id: string, req: ScopeRequest): Promise<ExperimentView> {
    const experiment = await this.gate.experiment(viewer, id);
    await this.ctx.store.putExperiment(
      changeScope(viewer, experiment, req, "실험 공개 범위 바꾸기"),
    );
    return this.view(viewer, id);
  }

  async list(viewer: Viewer, query: ExperimentQueryParams): Promise<ExperimentSummary[]> {
    // the filter is part of the store's query: what the person may not see is never loaded
    const found = await this.ctx.store.listExperiments({
      ...filterOf(query),
      visibleTo: sightOf(viewer),
    });
    const out: ExperimentSummary[] = [];
    for (const e of found) {
      const summary = this.standingOf(viewer, await this.summaryOf(e));
      if (query.status === undefined || summary.status === query.status) out.push(summary);
      if (out.length >= (query.limit ?? 50)) break;
    }
    return this.withTitles(out);
  }

  /** The owners' titles, beside the lists where owners are shown (REQ-101). */
  private async withTitles(list: ExperimentSummary[]): Promise<ExperimentSummary[]> {
    if (!this.titles) return list;
    const owned = await this.titles.ofMany(list.map((s) => s.experiment.owner));
    return list.map((s) => {
      const ownerTitles = owned.get(s.experiment.owner) ?? [];
      return ownerTitles.length > 0 ? { ...s, ownerTitles } : s;
    });
  }

  /** The experiment analysed (with harness telemetry when given), against its parent's when it is a fork. */
  async analysis(
    experiment: Experiment,
    runs?: readonly RunRecord[],
    telemetry?: ReadonlyMap<string, Telemetry>,
    looker?: Sight,
  ): Promise<ExperimentAnalysis> {
    const own = runs ?? (await this.ctx.store.listRuns(experiment.id));
    const found = experiment.parentId
      ? await this.ctx.store.getExperiment(experiment.parentId)
      : undefined;
    // compared with the parent only when the one looking may see the parent: scores of a private experiment do not leak
    const parent = found && (looker === undefined || seen(looker, found)) ? found : undefined;
    const parentAnalysis = parent
      ? analyzeExperiment({ experiment: parent, runs: await this.ctx.store.listRuns(parent.id) })
      : undefined;
    return analyzeExperiment(
      { experiment, runs: own, ...(telemetry ? { telemetry } : {}) },
      parentAnalysis,
    );
  }

  private async ancestors(viewer: Viewer, experiment: Experiment): Promise<ExperimentSummary[]> {
    const chain: ExperimentSummary[] = [];
    const walked = new Set([experiment.id]);
    for (let id = experiment.parentId; id && !walked.has(id); ) {
      walked.add(id);
      const e = await this.ctx.store.getExperiment(id);
      // the line stops at the first ancestor the person may not see; the older ones are not theirs to find
      if (!e || !seen(sightOf(viewer), e)) break;
      chain.unshift(this.standingOf(viewer, await this.summaryOf(e)));
      id = e.parentId;
    }
    return chain;
  }

  private runSummary(run: RunRecord): RunSummary {
    const position = run.status === "queued" ? this.dispatcher.positionOf(run.id) : undefined;
    return { ...summaryOf(run), ...(position ? { queuePosition: position } : {}) };
  }

  async view(viewer: Viewer, id: string): Promise<ExperimentView> {
    const experiment = await this.gate.experiment(viewer, id);
    const runs = await this.ctx.store.listRuns(id);
    const forks = await this.ctx.store.listExperiments({
      parentId: id,
      visibleTo: sightOf(viewer),
    });
    const summary = this.standingOf(viewer, summarize(experiment, runs));
    return {
      ...summary,
      runs: runs.map((r) => this.runSummary(r)),
      analysis: await this.analysis(experiment, runs, undefined, sightOf(viewer)),
      ancestors: await this.ancestors(viewer, experiment),
      forks: await Promise.all(
        forks.reverse().map(async (f) => this.standingOf(viewer, await this.summaryOf(f))),
      ),
      canCancel: !isTerminal(summary.status) && mayCancel(viewer, experiment.owner),
    };
  }
}
