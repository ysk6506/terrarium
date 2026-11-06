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
import type {
  Calibration,
  CommonReach,
  HumanAct,
  HumanRequest,
  MetricSeries,
  TimelineEntry,
} from "@terrarium/core/session";
import type { ImportReport } from "@terrarium/core/sources/realimport";
import type { WorldgenResult } from "@terrarium/core/sources/worldgen";
import type { CallEffect, Runbook } from "@terrarium/core/tools";
import type { Blueprint, Issue, RunEvent } from "@terrarium/core/world";

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
  /** Whether the tools a real operations team has reach the equipment the answer names; absent for a run without a cause to reach. */
  readonly commonReach?: CommonReach;
  /** Whether harness telemetry can be fetched for this run. */
  readonly hasTelemetry: boolean;
  /** Name of the tool the harness's traces are read from (the connection's choice), when there is one. */
  readonly telemetryName?: string;
}

/** Who did a run's work: the harness, the agent and the model behind it, as the topology view names them. */
export interface RunWho {
  readonly harness: string;
  readonly agent: string;
  readonly model?: string;
}

/**
 * A run's record (REQ-083, ADR-0088): its events in time order, two clocks each. A run that is still going is
 * read from the live record, and `live` says so; the window `from`/`to` cuts `events` only, `total` and the
 * span cover the whole run so far.
 */
export interface RunEventsView {
  readonly runId: string;
  readonly live: boolean;
  /** The world time the run is counted from, and the last moment known (the close, or the latest event). */
  readonly origin: number;
  readonly end: number;
  readonly total: number;
  readonly events: readonly RunEvent[];
  readonly who: RunWho;
}

/** The world a run ran in, at the version it ran in (the world may have been edited since). */
export interface RunWorldView {
  readonly worldId: string;
  readonly name: string;
  readonly digest: string;
  readonly blueprint: Blueprint;
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
      /** What the agent passed in, for the speech bubble of the topology view (REQ-078); absent from older servers. */
      readonly args?: Readonly<Record<string, unknown>>;
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
      readonly args?: Readonly<Record<string, unknown>>;
      readonly effect: CallEffect;
      readonly targets: readonly string[];
    }
  | {
      /** The other side of a hand-off starts working on a machine, or is done with it (REQ-093). */
      readonly type: "partner";
      readonly runId: string;
      readonly t: number;
      readonly handoff: string;
      /** The machine (or cable) the work is on. */
      readonly device: string;
      readonly what: "started" | "done";
      readonly team: string;
      readonly who: "team" | "vendor";
      /** A part is changed (an engineer comes to the machine), as opposed to work at a console. */
      readonly replacing: boolean;
      readonly onSite: boolean;
    }
  | { readonly type: "end"; readonly runId: string };

/** A first draft of a runbook from the best run of a scenario, and where it came from; empty when no run is finished. */
export interface RunbookDraftView {
  readonly runbook?: Runbook;
  readonly from?: {
    readonly runId: string;
    readonly experimentId: string;
    readonly experimentName: string;
    readonly score: number;
  };
}

/** A run that waits for a person to answer its `ask_human` (ADR-0087 item 4), as the card shows it. */
export interface EscalationCard {
  readonly runId: string;
  readonly experimentId: string;
  readonly experimentName: string;
  readonly owner: string;
  readonly agent: string;
  /** When the agent asked (ISO, wall clock). */
  readonly since: string;
  readonly request: HumanRequest;
  /** The tools the agent has now, and the ones a person could hand over. */
  readonly tools: readonly string[];
  readonly grantable: readonly { readonly name: string; readonly title: string }[];
  /** What people already did for it while it waited. */
  readonly acts: readonly HumanAct[];
}

/** What came of an answer: the card again while the run still waits (after a person's action), nothing once it goes on. */
export interface EscalationAnswered {
  readonly card?: EscalationCard;
}

export type { WorldSummary };
