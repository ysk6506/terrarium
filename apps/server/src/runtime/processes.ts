/**
 * 프로세스 비교 (REQ-112, ADR-0135): 시나리오마다 사람이 적은 "지금 하는 방식" 표, 실험의 전후 비교(잰 값은 코드가 실행의
 * 기록에서 센다), 세계가 E2E로 가려면 필요한 것. 모델은 부르지 않아요: 같은 기록이면 같은 숫자가 나와요.
 */
import {
  baselineNumbers,
  deltaNumbers,
  deriveNeeds,
  deriveUse,
  foldRun,
  meanNumbers,
  type RunProcess,
  remainingLine,
  typicalRun,
} from "@terrarium/core/analysis";
import type {
  CurrentProcessView,
  ProcessCompareView,
  PutCurrentProcessRequest,
  WorldOntologyQueryParams,
  WorldOntologyView,
} from "@terrarium/core/contract";
import { ForbiddenError } from "@terrarium/core/contract";
import type { CurrentProcessRecord, RunRecord } from "@terrarium/core/experiments";
import { legacyEvents } from "@terrarium/core/session";
import type { RunEvent } from "@terrarium/core/world";
import type { PlatformContext, Viewer } from "./context";
import { Gate } from "./gate";
import { allow, canSee, may, sightOf, standing } from "./permissions";

const EXPERIMENT_OPTIONS = 20;

/** The events of a finished run: its own record, or the one rebuilt from its tool calls for a run saved before events. */
const eventsOf = (run: RunRecord): readonly RunEvent[] =>
  run.result ? (run.result.events ?? legacyEvents(run.result)) : [];

function fold(run: RunRecord): RunProcess | undefined {
  const r = run.result;
  if (run.status !== "completed" || !r) return undefined;
  return foldRun({ events: eventsOf(run), origin: r.simTime.agentStart, end: r.simTime.end });
}

export class Processes {
  private readonly gate: Gate;

  constructor(private readonly ctx: PlatformContext) {
    this.gate = new Gate(ctx);
  }

  async get(viewer: Viewer, scenarioId: string): Promise<CurrentProcessView> {
    const scenario = await this.gate.scenario(viewer, scenarioId);
    const record = await this.ctx.store.getCurrentProcess(scenarioId);
    const steps = record?.steps ?? [];
    return {
      scenarioId,
      scenarioName: scenario.name,
      worldId: scenario.worldId,
      written: record !== undefined,
      steps,
      summary: baselineNumbers(steps),
      ...(record ? { owner: record.owner, updatedAt: record.updatedAt } : {}),
      canEdit: may(viewer, "editProcess", { owner: scenario.owner }).ok,
    };
  }

  async put(
    viewer: Viewer,
    scenarioId: string,
    input: PutCurrentProcessRequest,
  ): Promise<CurrentProcessView> {
    const scenario = await this.gate.scenario(viewer, scenarioId);
    allow(viewer, "editProcess", { owner: scenario.owner }, "현재 업무 표 적기");
    const old = await this.ctx.store.getCurrentProcess(scenarioId);
    const now = this.ctx.stamps.now();
    const record: CurrentProcessRecord = {
      id: scenarioId,
      owner: old?.owner ?? viewer.id,
      steps: input.steps.map((s) => ({
        ...s,
        kind: s.kind as CurrentProcessRecord["steps"][0]["kind"],
      })),
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
    };
    await this.ctx.store.putCurrentProcess(record);
    return this.get(viewer, scenarioId);
  }

  async compare(viewer: Viewer, experimentId: string): Promise<ProcessCompareView> {
    const experiment = await this.gate.experiment(viewer, experimentId);
    const { scenarioId } = experiment.recipe;
    // the scenario's own name and table only if the person may see the scenario; else what the experiment kept
    const found = await this.ctx.store.getScenario(scenarioId);
    const scenario = found && canSee(viewer, standing(found)) ? found : undefined;
    const runs = await this.ctx.store.listRuns(experimentId);
    const done = runs.flatMap((run) => {
      const process = fold(run);
      return process ? [{ run, process }] : [];
    });
    const base = {
      experimentId,
      scenarioId,
      hasScenario: scenario !== undefined,
      scenarioName: scenario?.name ?? experiment.snapshot.scenarioName,
      runs: done.length,
    };
    if (done.length === 0) return base;
    const processes = done.map((d) => d.process);
    const measured = meanNumbers(processes);
    const record = scenario ? await this.ctx.store.getCurrentProcess(scenarioId) : undefined;
    const baseline = record ? baselineNumbers(record.steps) : undefined;
    const typical = done[typicalRun(processes)] as (typeof done)[number];
    return {
      ...base,
      measured,
      ...(baseline ? { baseline, delta: deltaNumbers(measured, baseline) } : {}),
      ledger: {
        runId: typical.run.id,
        index: typical.run.index,
        rows: typical.process.rows,
        tools: typical.process.tools,
        remaining: remainingLine(typical.process.rows),
      },
    };
  }

  async ontology(
    viewer: Viewer,
    worldId: string,
    query: WorldOntologyQueryParams,
  ): Promise<WorldOntologyView> {
    const world = await this.gate.world(viewer, worldId);
    const scenarios = await this.ctx.store.listScenarios(worldId, sightOf(viewer));
    const needs = deriveNeeds(
      scenarios.map((s) => s.doc),
      world.blueprint,
    );
    const experiments = (
      await this.ctx.store.listExperiments({
        worldId,
        limit: EXPERIMENT_OPTIONS,
        visibleTo: sightOf(viewer),
      })
    ).map((e) => ({ id: e.id, name: e.name }));
    const base = { worldId, worldName: world.name, needs, experiments };
    if (!query.experimentId) return base;
    const experiment = await this.gate.experiment(viewer, query.experimentId);
    if (experiment.recipe.worldId !== worldId)
      throw new ForbiddenError("이 세계의 실험이 아니에요");
    const blueprint =
      (await this.ctx.store.worldVersion(worldId, experiment.snapshot.worldDigest)) ??
      world.blueprint;
    const runs = (await this.ctx.store.listRuns(experiment.id)).filter(
      (r) => r.status === "completed" && r.result,
    );
    const use = deriveUse(
      needs,
      runs.map((r) => ({ toolCalls: r.result?.toolCalls ?? [], events: eventsOf(r) })),
      blueprint,
    );
    return { ...base, experimentId: experiment.id, use };
  }
}
