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
import type { Calibration, MetricSeries, TimelineEntry } from "@terrarium/core/session";
import type { ImportReport } from "@terrarium/core/sources/realimport";
import type { WorldgenResult } from "@terrarium/core/sources/worldgen";
import type { CallEffect } from "@terrarium/core/tools";
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
  readonly user: { readonly name: string; readonly source: "proxy" | "sso" | "self" | "anonymous" };
  readonly harnesses: readonly HarnessView[];
  readonly sources: readonly SourceView[];
  readonly telemetry: { readonly configured: boolean; readonly name: string };
  readonly limits: SchedulerLimits & { readonly maxSeeds: number };
  readonly queue: { readonly running: number; readonly queued: number };
  /** Connections of the viewer's that will be removed soon for lack of use (REQ-051). */
  readonly expiring: readonly {
    readonly id: string;
    readonly name: string;
    readonly daysLeft: number;
  }[];
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

/**
 * What the three reference agents (idle, guess, knows) score on a scenario, and what that means. With problems
 * left in the scenario nothing is run, `runs` is empty and `issues` says why.
 */
export interface CalibrationView extends Calibration {
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
  /** Name of the tool the harness's traces are read from (the connection's choice), when there is one. */
  readonly telemetryName?: string;
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
      /** What the call does to the world, and the equipment it names (REQ-050); absent from older servers. */
      readonly effect?: CallEffect;
      readonly targets?: readonly string[];
    };

/** Who is working in a world: the experiment, harness, agent and model behind a run (REQ-050). */
export interface ActivityWho {
  readonly experimentId: string;
  readonly experiment: string;
  readonly owner: string;
  readonly harness: string;
  readonly agent: string;
  readonly model?: string;
}

/**
 * Server-sent events on /api/worlds/:id/activity: every run on this world, from every experiment, as it
 * works (REQ-050). A viewer who arrives late first gets a `start` for each run still going.
 */
export type ActivityEvent =
  | { readonly type: "start"; readonly runId: string; readonly who: ActivityWho }
  | {
      readonly type: "call";
      readonly runId: string;
      readonly t: number;
      readonly tool: string;
      readonly ok: boolean;
      readonly effect: CallEffect;
      readonly targets: readonly string[];
    }
  | { readonly type: "end"; readonly runId: string };

export type { WorldSummary };
