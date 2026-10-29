/**
 * What the API returns. Built from the core's own types so server and web cannot drift apart.
 * Static knowledge (catalog, tools, blocks, worldgen fields) is not served: the web imports it from
 * core directly. The API serves what only the server knows — stored records, harnesses, queues.
 */
import type {
  ExperimentAnalysis,
  Leaderboard,
  RunAnalysis,
  Telemetry,
} from "@terrarium/core/analysis";
import type {
  AgentInfo,
  Experiment,
  ExperimentStatus,
  HarnessInfo,
  Progress,
  RunRecord,
  RunStatus,
  ScenarioRecord,
  SchedulerLimits,
  WorldRecord,
  WorldSummary,
} from "@terrarium/core/experiments";
import type { ScenarioIssue } from "@terrarium/core/scenario";
import type { MetricSeries, TimelineEntry } from "@terrarium/core/session";
import type { ImportReport } from "@terrarium/core/sources/realimport";
import type { WorldgenResult } from "@terrarium/core/sources/worldgen";
import type { Issue } from "@terrarium/core/world";

export interface HarnessView extends HarnessInfo {
  readonly agents: readonly AgentInfo[];
  /** Whether the harness answered when the server last asked. */
  readonly status: "ok" | "unreachable";
  readonly error?: string;
}

export interface SourceView {
  readonly id: string;
  readonly name: string;
  readonly kind: "falkordb" | "sample";
  /** Reality sources are only ever read (REQ-011). */
  readonly readOnly: true;
  readonly configured: boolean;
}

export interface MetaView {
  readonly version: string;
  readonly user: { readonly name: string; readonly source: "proxy" | "self" | "anonymous" };
  readonly harnesses: readonly HarnessView[];
  readonly sources: readonly SourceView[];
  readonly telemetry: { readonly configured: boolean; readonly name: string };
  readonly limits: SchedulerLimits & { readonly maxSeeds: number };
  readonly queue: { readonly running: number; readonly queued: number };
}

export interface SavedWorld {
  readonly world: WorldRecord;
  /** Problems found in the blueprint; warnings do not stop a save, errors do. */
  readonly issues: readonly Issue[];
}

export interface GeneratedWorld extends SavedWorld {
  readonly stats: WorldgenResult["stats"];
}

export interface ImportedWorld extends SavedWorld {
  readonly report: ImportReport;
}

export interface SavedScenario {
  readonly scenario: ScenarioRecord;
  readonly issues: readonly ScenarioIssue[];
}

export interface DryRunView {
  readonly timeline: readonly TimelineEntry[];
  readonly series: readonly MetricSeries[];
  /** Simulated seconds until the agent would be handed the task, if it ever is. */
  readonly agentTaskAt?: number;
  readonly issues: readonly ScenarioIssue[];
}

export interface ExperimentSummary {
  readonly experiment: Experiment;
  readonly status: ExperimentStatus;
  readonly progress: Progress;
  readonly passRate: number;
  readonly meanScore?: number;
}

/** A run without its heavy parts (series, timeline), for lists and live updates. */
export interface RunSummary {
  readonly id: string;
  readonly index: number;
  readonly seed: number;
  readonly status: RunStatus;
  readonly queuedAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly score: number | null;
  readonly passed: boolean;
  readonly error?: string;
  /** Position in the scheduler's queue (1 = next), while queued. */
  readonly queuePosition?: number;
}

export interface ExperimentView extends ExperimentSummary {
  readonly runs: readonly RunSummary[];
  readonly analysis: ExperimentAnalysis;
  /** Oldest ancestor first; empty for an original. */
  readonly ancestors: readonly ExperimentSummary[];
  readonly forks: readonly ExperimentSummary[];
  /** Whether the viewer may cancel it (the owner only). */
  readonly canCancel: boolean;
}

export interface RunView {
  readonly run: RunRecord;
  readonly analysis: RunAnalysis;
  readonly experiment: ExperimentSummary;
  readonly timeline: readonly TimelineEntry[];
  /** Whether harness telemetry can be fetched for this run. */
  readonly hasTelemetry: boolean;
}

export type TelemetryView = Telemetry;

export interface ShareView {
  readonly token: string;
  /** Absolute link that opens the read-only report. */
  readonly url: string;
  readonly createdAt: string;
  readonly expiresAt?: string;
}

export type LeaderboardView = Leaderboard;

/** Server-sent events on /api/experiments/:id/events (live progress, REQ-030). */
export type ExperimentEvent =
  | { readonly type: "experiment"; readonly summary: ExperimentSummary }
  | { readonly type: "run"; readonly run: RunSummary }
  | {
      readonly type: "call";
      readonly runId: string;
      readonly t: number;
      readonly tool: string;
      readonly ok: boolean;
      readonly error?: string;
    };

export type { WorldSummary };
