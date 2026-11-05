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
  RunView,
  ShareView,
  TwinQueryParams,
} from "@terrarium/core/contract";
import { UnavailableError } from "@terrarium/core/contract";
import type { Experiment, RunRecord } from "@terrarium/core/experiments";
import { NotFoundError, randomToken } from "@terrarium/core/kernel";
import type { ImportReport } from "@terrarium/core/sources/realimport";
import { must, ownerOnly, type PlatformContext, type Viewer } from "./context";
import type { Experiments } from "./experiments";

export type ReportFormat = "html" | "md" | "text";

const DAY_MS = 86_400_000;

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
    return {
      run,
      analysis: analyzeRun(run, await this.telemetryOf(run)),
      experiment: await this.experiments.summaryOf(experiment),
      timeline: run.result?.timeline ?? [],
      hasTelemetry: Boolean(run.harness?.traceId && adapter),
      ...(adapter ? { telemetryName: adapter.name } : {}),
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
    await this.experiments.get(id);
    const createdAt = this.ctx.stamps.now();
    const expiresAt = req.expiresInDays
      ? new Date(Date.parse(createdAt) + req.expiresInDays * DAY_MS).toISOString()
      : undefined;
    const share = {
      token: randomToken(18),
      experimentId: id,
      createdBy: viewer.name,
      createdAt,
      ...(expiresAt ? { expiresAt } : {}),
    };
    await this.ctx.store.putShare(share);
    return {
      token: share.token,
      url: `${baseUrl.replace(/\/$/, "")}/r/${share.token}`,
      createdAt,
      ...(expiresAt ? { expiresAt } : {}),
    };
  }

  async deleteShare(viewer: Viewer, token: string): Promise<{ deleted: boolean }> {
    const share = must(await this.ctx.store.getShare(token), "공유 링크");
    const experiment = await this.ctx.store.getExperiment(share.experimentId);
    if (viewer.name !== share.createdBy)
      ownerOnly(viewer, experiment?.owner ?? share.createdBy, "공유 링크 끊기");
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
