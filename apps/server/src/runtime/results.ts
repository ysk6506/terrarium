/**
 * Results people read and share (REQ-015, REQ-037~039): one run in depth, reports in three formats,
 * share links that open without the app, benchmark leaderboards, and the digital-twin exports.
 */
import {
  analyzeExperiment,
  analyzeRun,
  buildLeaderboards,
  type DiagnosisRecord,
  diagnosisRecords,
  type ExperimentAnalysis,
  modelingBrief,
  NO_TELEMETRY,
  renderHtml,
  renderMarkdown,
  renderText,
  type Telemetry,
  type TelemetryAdapter,
  toJsonl,
  type WorldGaps,
} from "@terrarium/core/analysis";
import type {
  CreateShareRequest,
  LeaderboardQueryParams,
  LeaderboardView,
  RunEventsQueryParams,
  RunEventsView,
  RunView,
  RunWho,
  RunWorldView,
  ShareView,
  TwinQueryParams,
} from "@terrarium/core/contract";
import { UnavailableError } from "@terrarium/core/contract";
import type { Experiment, RunRecord } from "@terrarium/core/experiments";
import { NotFoundError, randomToken } from "@terrarium/core/kernel";
import {
  type CommonReach,
  commonReach,
  legacyEvents,
  operationScenario,
} from "@terrarium/core/session";
import type { ImportReport } from "@terrarium/core/sources/realimport";
import { spanOf } from "@terrarium/core/topology";
import { must, type PlatformContext, type Viewer } from "./context";
import { whoIs } from "./executor";
import type { Experiments } from "./experiments";
import { allow } from "./permissions";

export type ReportFormat = "html" | "md" | "text";

const DAY_MS = 86_400_000;
/** How long a share link lives when its maker gives no number (ADR-0174). */
export const DEFAULT_SHARE_DAYS = 30;

/** Whether the common tools reach the answer, per world version and scenario version: it is the same every time (REQ-088). */
const REACH = new Map<string, CommonReach | null>();

export class Results {
  constructor(
    private readonly ctx: PlatformContext,
    private readonly experiments: Experiments,
  ) {}

  /** Where the traces of this run's connection are read from, if anywhere (ADR-0085). */
  private async adapterOf(run: RunRecord): Promise<TelemetryAdapter | undefined> {
    const experiment = await this.ctx.store.getExperiment(run.experimentId);
    return experiment ? this.ctx.harnesses.telemetryOf?.(experiment.recipe.harnessId) : undefined;
  }

  /** The harness's own trace for a run; nothing (not an error) when there is none to read. */
  private async telemetryOf(run: RunRecord): Promise<Telemetry> {
    const traceId = run.harness?.traceId;
    const adapter = traceId ? await this.adapterOf(run) : undefined;
    if (!adapter) return NO_TELEMETRY;
    try {
      return await adapter.fetch(run.id, { traceId });
    } catch {
      return NO_TELEMETRY;
    }
  }

  async run(id: string): Promise<RunView> {
    const run = must(await this.ctx.store.getRun(id), `실행 ${id}`);
    const experiment = await this.experiments.get(run.experimentId);
    const adapter = await this.adapterOf(run);
    const reach = run.result ? await this.reachOf(experiment) : undefined;
    return {
      run,
      analysis: analyzeRun(run, await this.telemetryOf(run)),
      ...(reach ? { commonReach: reach } : {}),
      experiment: await this.experiments.summaryOf(experiment),
      timeline: run.result?.timeline ?? [],
      hasTelemetry: Boolean(run.harness?.traceId && adapter),
      ...(adapter ? { telemetryName: adapter.name } : {}),
    };
  }

  /** Whether the common tools reach the equipment the scenario's answer names, worked out once for each version pair. */
  private async reachOf(experiment: Experiment): Promise<CommonReach | undefined> {
    const { worldId, scenarioId } = experiment.recipe;
    const { worldDigest, scenarioDigest } = experiment.snapshot;
    const key = `${worldId}@${worldDigest}|${scenarioId}@${scenarioDigest}`;
    if (!REACH.has(key)) {
      const blueprint = await this.ctx.store.worldVersion(worldId, worldDigest);
      const operation = experiment.recipe.operation;
      const scenario = operation
        ? operationScenario(scenarioId, worldId, operation)
        : await this.ctx.store.scenarioVersion(scenarioId, scenarioDigest);
      REACH.set(key, blueprint && scenario ? (commonReach({ blueprint, scenario }) ?? null) : null);
    }
    return REACH.get(key) ?? undefined;
  }

  /** Who did the run's work, named as the speech bubble of the topology view names them. */
  private async whoOf(run: RunRecord): Promise<RunWho> {
    const experiment = await this.experiments.get(run.experimentId);
    const harness = this.ctx.harnesses.get(experiment.recipe.harnessId);
    if (!harness) return { harness: experiment.recipe.harnessId, agent: experiment.recipe.agentId };
    const who = await whoIs(experiment, harness);
    const model = run.harness?.model ?? who.model;
    return { harness: who.harness, agent: who.agent, ...(model ? { model } : {}) };
  }

  /** The run's events (REQ-083): from its result once it is over, from the live record while it goes. */
  async runEvents(id: string, window: RunEventsQueryParams): Promise<RunEventsView> {
    const run = must(await this.ctx.store.getRun(id), `실행 ${id}`);
    const live = this.ctx.logs.get(id);
    const all = run.result?.events ?? (run.result ? legacyEvents(run.result) : (live ?? []));
    const span = spanOf(all);
    const from = window.from ?? Number.NEGATIVE_INFINITY;
    const to = window.to ?? Number.POSITIVE_INFINITY;
    return {
      runId: id,
      live: run.result === undefined && live !== undefined,
      origin: span.origin,
      end: span.end,
      total: all.length,
      events: all.filter((e) => e.t >= from && e.t <= to),
      who: await this.whoOf(run),
    };
  }

  /** The world as the run saw it: the version the experiment recorded, not the one that is saved now. */
  async runWorld(id: string): Promise<RunWorldView> {
    const run = must(await this.ctx.store.getRun(id), `실행 ${id}`);
    const experiment = await this.experiments.get(run.experimentId);
    const { worldId } = experiment.recipe;
    const blueprint = must(
      await this.ctx.store.worldVersion(worldId, experiment.snapshot.worldDigest),
      "실행이 돌았던 세계 버전",
    );
    const world = await this.ctx.store.getWorld(worldId);
    return {
      worldId,
      name: world?.name ?? worldId,
      digest: experiment.snapshot.worldDigest,
      blueprint,
    };
  }

  async telemetry(id: string): Promise<Telemetry> {
    const run = must(await this.ctx.store.getRun(id), `실행 ${id}`);
    const traceId = run.harness?.traceId;
    const adapter = traceId ? await this.adapterOf(run) : undefined;
    if (!adapter) return NO_TELEMETRY;
    try {
      return await adapter.fetch(run.id, { traceId });
    } catch (err) {
      throw new UnavailableError(`${adapter.name}에 연결할 수 없어요: ${(err as Error).message}`);
    }
  }

  /** Analysis with the harnesses' telemetry folded in (token counts, model time). */
  private async fullAnalysis(experiment: Experiment): Promise<ExperimentAnalysis> {
    const runs = await this.ctx.store.listRuns(experiment.id);
    const telemetry = new Map<string, Telemetry>();
    for (const r of runs)
      if (r.harness?.traceId) telemetry.set(r.harness.traceId, await this.telemetryOf(r));
    return this.experiments.analysis(experiment, runs, telemetry);
  }

  async report(id: string, format: ReportFormat, url?: string): Promise<string> {
    const experiment = await this.experiments.get(id);
    const analysis = await this.fullAnalysis(experiment);
    const names = Object.fromEntries(
      [...this.ctx.harnesses.values()].map((h) => [h.info.id, h.info.name]),
    );
    const runs = await this.ctx.store.listRuns(id);
    const first = runs.find((r) => r.result);
    const options = {
      names,
      generatedAt: this.ctx.stamps.now(),
      ...(url ? { url } : {}),
      ...(first?.result
        ? { series: { label: `실행 ${first.index + 1}의 주요 지표`, series: first.result.series } }
        : {}),
    };
    if (format === "md") return renderMarkdown(analysis, options);
    if (format === "text") return renderText(analysis, options);
    return renderHtml(analysis, options);
  }

  async diagnoses(id: string): Promise<string> {
    const experiment = await this.experiments.get(id);
    return toJsonl(diagnosisRecords(experiment, await this.ctx.store.listRuns(id)));
  }

  async createShare(
    viewer: Viewer,
    id: string,
    req: CreateShareRequest,
    baseUrl: string,
  ): Promise<ShareView> {
    const experiment = await this.experiments.get(id);
    allow(viewer, "createShare", { owner: experiment.owner }, "공유 링크 만들기");
    const createdAt = this.ctx.stamps.now();
    // A link without an end is a door nobody remembers to close: no answer means the usual thirty days.
    const days = req.expiresInDays ?? DEFAULT_SHARE_DAYS;
    const expiresAt = new Date(Date.parse(createdAt) + days * DAY_MS).toISOString();
    const share = {
      token: randomToken(18),
      experimentId: id,
      createdBy: viewer.id,
      createdAt,
      expiresAt,
    };
    await this.ctx.store.putShare(share);
    return {
      token: share.token,
      url: `${baseUrl.replace(/\/$/, "")}/r/${share.token}`,
      createdAt,
      expiresAt,
    };
  }

  async deleteShare(viewer: Viewer, token: string): Promise<{ deleted: boolean }> {
    const share = must(await this.ctx.store.getShare(token), "공유 링크");
    const experiment = await this.ctx.store.getExperiment(share.experimentId);
    allow(
      viewer,
      "deleteShare",
      { owner: experiment?.owner, creator: share.createdBy },
      "공유 링크 끊기",
    );
    return { deleted: await this.ctx.store.deleteShare(token) };
  }

  /** A shared report: opens for anyone with the link, until it expires or is taken back. */
  async shared(token: string, format: ReportFormat, url: string): Promise<string> {
    const share = await this.ctx.store.getShare(token);
    if (!share || (share.expiresAt && share.expiresAt < this.ctx.stamps.now()))
      throw new NotFoundError("공유 링크가 없거나 만료됐어요");
    return this.report(share.experimentId, format, url);
  }

  private async everything(filter: { worldId?: string; scenarioId?: string }) {
    const experiments = await this.ctx.store.listExperiments({
      ...(filter.worldId ? { worldId: filter.worldId } : {}),
      ...(filter.scenarioId ? { scenarioId: filter.scenarioId } : {}),
    });
    return Promise.all(
      experiments.map(async (e) => ({ experiment: e, runs: await this.ctx.store.listRuns(e.id) })),
    );
  }

  async leaderboards(query: LeaderboardQueryParams): Promise<LeaderboardView[]> {
    const all = await this.everything(query);
    return buildLeaderboards(
      all.map((x) => analyzeExperiment(x)),
      query.minRuns,
    );
  }

  async twinRecords(query: TwinQueryParams): Promise<DiagnosisRecord[]> {
    const all = await this.everything(query);
    return all
      .filter(
        ({ experiment: e }) =>
          (!query.harnessId || e.recipe.harnessId === query.harnessId) &&
          (!query.agentId || e.recipe.agentId === query.agentId) &&
          (!query.owner || e.owner === query.owner),
      )
      .flatMap(({ experiment, runs }) => diagnosisRecords(experiment, runs));
  }

  async twinBrief(query: TwinQueryParams): Promise<string> {
    const records = await this.twinRecords(query);
    const worldIds = [...new Set(records.map((r) => r.world.id))];
    const worlds: WorldGaps[] = [];
    for (const id of worldIds) {
      const w = await this.ctx.store.getWorld(id);
      const report = w?.provenance?.report as ImportReport | undefined;
      if (w && report)
        worlds.push({
          worldId: w.id,
          worldName: w.name,
          unknownLabels: report.unknown.labels,
          unknownRelationships: report.unknown.relationships,
          assumptions: report.assumptions,
        });
    }
    return modelingBrief({ records, worlds, generatedAt: this.ctx.stamps.now() });
  }
}
