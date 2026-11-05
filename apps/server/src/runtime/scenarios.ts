/**
 * Scenarios (REQ-033, REQ-034): drafts may be saved with problems — the editor shows them — but an
 * experiment refuses a scenario that cannot run. A dry run plays the scenario with no agent, so the
 * author sees what it does to the world before anyone is scored on it.
 */
import type {
  CalibrationView,
  CreateScenarioRequest,
  DryRunView,
  SavedScenario,
  UpdateScenarioRequest,
} from "@terrarium/core/contract";
import type { ScenarioRecord } from "@terrarium/core/experiments";
import { ConflictError, InvalidValueError } from "@terrarium/core/kernel";
import {
  emptyScenario,
  hasErrors,
  type ScenarioDoc,
  type ScenarioIssue,
  scenarioDigest,
  scenarioTemplate,
  validateScenario,
} from "@terrarium/core/scenario";
import {
  BASELINE_SUMMARY,
  type BaselineId,
  type BaselineRun,
  baselineRun,
  GUESS,
  IDLE_ROUNDS,
  IDLE_WAIT_SECONDS,
  judge,
  knownAnswer,
} from "@terrarium/core/session";
import { TOOL_NAMES } from "@terrarium/core/tools";
import { BlueprintIndex } from "@terrarium/core/world";
import { must, ownerOnly, type PlatformContext, type Viewer } from "./context";
import type { PlainSessionConfig } from "./hosts";

/** The longest a dry run looks past the agent's task (simulated). */
const DRY_RUN_SECONDS = 3600;

export class Scenarios {
  constructor(private readonly ctx: PlatformContext) {}

  list(worldId?: string): Promise<ScenarioRecord[]> {
    return this.ctx.store.listScenarios(worldId);
  }

  async get(id: string): Promise<ScenarioRecord> {
    return must(await this.ctx.store.getScenario(id), `시나리오 ${id}`);
  }

  async issuesOf(doc: ScenarioDoc): Promise<ScenarioIssue[]> {
    const world = must(await this.ctx.store.getWorld(doc.worldId), `세계 ${doc.worldId}`);
    return validateScenario(doc, {
      index: new BlueprintIndex(world.blueprint),
      catalog: this.ctx.catalog,
    });
  }

  private async startingDoc(id: string, req: CreateScenarioRequest): Promise<ScenarioDoc> {
    if ("doc" in req) return req.doc;
    if (!("templateId" in req)) return emptyScenario(id, req.worldId);
    const template = must(scenarioTemplate(req.templateId), `시나리오 템플릿 '${req.templateId}'`);
    const world = must(await this.ctx.store.getWorld(req.worldId), `세계 ${req.worldId}`);
    const index = new BlueprintIndex(world.blueprint);
    const why = template.unavailable(index, this.ctx.catalog);
    if (why)
      throw new InvalidValueError(
        `이 세계에서는 '${template.name}' 시나리오를 만들 수 없어요: ${why}`,
      );
    return template.build(index, req.worldId, this.ctx.catalog);
  }

  private async save(record: Omit<ScenarioRecord, "digest" | "updatedAt">): Promise<SavedScenario> {
    const scenario: ScenarioRecord = {
      ...record,
      digest: scenarioDigest(record.doc),
      updatedAt: this.ctx.stamps.now(),
    };
    const issues = await this.issuesOf(scenario.doc);
    await this.ctx.store.putScenario(scenario);
    return { scenario, issues };
  }

  async create(viewer: Viewer, req: CreateScenarioRequest): Promise<SavedScenario> {
    must(await this.ctx.store.getWorld(req.worldId), `세계 ${req.worldId}`);
    const id = this.ctx.stamps.id("s");
    const start = await this.startingDoc(id, req);
    const name = req.name ?? start.name;
    return this.save({
      id,
      worldId: req.worldId,
      name,
      owner: viewer.name,
      doc: { ...start, id, worldId: req.worldId, name },
      createdAt: this.ctx.stamps.now(),
    });
  }

  async update(viewer: Viewer, id: string, req: UpdateScenarioRequest): Promise<SavedScenario> {
    const current = await this.get(id);
    ownerOnly(viewer, current.owner, "시나리오 고치기");
    if (current.digest !== req.baseDigest)
      throw new ConflictError(
        "그사이 이 시나리오가 바뀌었어요. 새로고침해서 바뀐 내용을 본 뒤 다시 저장해 주세요",
      );
    const name = req.name ?? current.name;
    const doc = { ...(req.doc ?? current.doc), id, worldId: current.worldId, name };
    const { digest: _d, updatedAt: _u, ...rest } = current;
    return this.save({ ...rest, name, doc });
  }

  async delete(viewer: Viewer, id: string): Promise<{ deleted: boolean }> {
    const current = await this.get(id);
    ownerOnly(viewer, current.owner, "시나리오 지우기");
    return { deleted: await this.ctx.store.deleteScenario(id) };
  }

  /** Play the scenario with an agent that only waits, and show what happened. */
  async dryRun(id: string, seed: number): Promise<DryRunView> {
    const scenario = await this.get(id);
    const issues = await this.issuesOf(scenario.doc);
    if (hasErrors(issues)) return { timeline: [], series: [], issues };
    const world = must(await this.ctx.store.getWorld(scenario.worldId), `세계 ${scenario.worldId}`);
    const session = await this.ctx.host.open({
      blueprint: world.blueprint,
      scenario: scenario.doc,
      tools: ["wait"],
      seed,
    });
    try {
      for (
        let waited = 0;
        waited < Math.min(DRY_RUN_SECONDS, session.task.timeLimitSeconds) && !session.endedBy;
        waited += 600
      )
        await session.call("wait", { seconds: 600 });
      const result = await session.finish("agent_finished");
      return {
        timeline: result.timeline,
        series: result.series,
        agentTaskAt: result.simTime.agentStart - result.simTime.scenarioStart,
        issues,
      };
    } finally {
      session.dispose();
    }
  }
  /**
   * Check the exam paper before anyone is scored on it: run three agents that need no model (one that waits, one
   * that guesses, one that knows the answer and takes no action) and say what their scores mean (REQ-070).
   */
  async calibrate(id: string, seed: number): Promise<CalibrationView> {
    const scenario = await this.get(id);
    const issues = await this.issuesOf(scenario.doc);
    if (hasErrors(issues)) return { runs: [], floor: 0, diagnosisOnly: 0, warnings: [], issues };
    const world = must(await this.ctx.store.getWorld(scenario.worldId), `세계 ${scenario.worldId}`);
    const config: PlainSessionConfig = {
      blueprint: world.blueprint,
      scenario: scenario.doc,
      tools: TOOL_NAMES,
      seed,
    };
    const right = knownAnswer(scenario.doc);
    const runs = await Promise.all([
      this.baseline("idle", config),
      this.baseline("guess", config, GUESS),
      right ? this.baseline("knows", config, right) : undefined,
    ]);
    return {
      ...judge(
        runs.filter((r): r is BaselineRun => r !== undefined),
        right !== undefined,
      ),
      issues,
    };
  }

  private async baseline(
    id: BaselineId,
    config: PlainSessionConfig,
    said?: { rootCause: string; faultType: string },
  ): Promise<BaselineRun> {
    const session = await this.ctx.host.open(config);
    try {
      if (said) await session.call("submit_diagnosis", { ...said, summary: BASELINE_SUMMARY });
      else
        for (let i = 0; i < IDLE_ROUNDS && !session.endedBy; i++)
          await session.call("wait", { seconds: IDLE_WAIT_SECONDS });
      const { score } = await session.finish(session.endedBy ?? "agent_finished");
      return baselineRun(id, score.total, score.passed);
    } finally {
      session.dispose();
    }
  }
}
