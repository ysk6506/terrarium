/** What a session is given and what it hands back (REQ-001, REQ-007, ADR-0087): kept apart from the session itself. */
import type { Catalog } from "@terrarium/core/catalog";
import type { EndReason, Score } from "@terrarium/core/oracle";
import type {
  AgentTask,
  Diagnosis,
  ScenarioDoc,
  SopCompliance,
  ToolCallRecord,
} from "@terrarium/core/scenario";
import type { ToolResult } from "@terrarium/core/tools";
import type {
  Blueprint,
  Domain,
  LeadTimeSettings,
  PreparedWorld,
  RunEvent,
} from "@terrarium/core/world";
import type { EscalationPolicy, HumanRequest, HumanSummary } from "./human";
import type { OperationConfig, OperationMetrics } from "./operation";
import type { MetricSeries } from "./recorder";
import type { TimelineEntry } from "./timeline";
import type { WarmStartCache } from "./warm";

export type TimePolicy =
  /** Each tool call costs this many simulated seconds (default; deterministic). */
  | { readonly kind: "lockstep"; readonly secondsPerCall: number }
  /** Simulated time follows the wall clock × speed; the host calls sync(). */
  | { readonly kind: "realtime"; readonly speed: number };

export const DEFAULT_TIME: TimePolicy = { kind: "lockstep", secondsPerCall: 30 };

export interface SessionConfig {
  readonly blueprint: Blueprint;
  readonly scenario: ScenarioDoc;
  /** Tools the experiment selected; submit_diagnosis is always added (it is how the agent answers). */
  readonly tools: readonly string[];
  readonly seed: number;
  /**
   * The domains this experiment is responsible for (REQ-093). With some, only their tools (and the ones every domain
   * has) are on, `escalate` and `events_since` come on, and the rest is reached by handing it to the team that owns it.
   */
  readonly domains?: readonly Domain[];
  /** The vendor SLA, spare parts and surcharge the teams' waits are worked out from; unset means the defaults. */
  readonly leadTimes?: LeadTimeSettings;
  readonly catalog?: Catalog;
  readonly profiles?: { readonly vcenter?: string; readonly vrops?: string };
  readonly time?: TimePolicy;
  /** Simulated seconds of normal operation before the scenario starts (default 600). */
  readonly warmupSeconds?: number;
  /** Simulated seconds the world keeps running after the agent stops, before scoring (default 60). */
  readonly aftermathSeconds?: number;
  /** Longest the scenario may take to hand over the task (default 24 h). */
  readonly maxPreAgentSeconds?: number;
  readonly sampleSeconds?: number;
  readonly retentionSeconds?: number;
  /**
   * Where warmed-up worlds are kept between sessions (a host passes one per thread). A session with a
   * custom catalog never uses it: the catalog is not part of the cache key.
   */
  readonly warm?: WarmStartCache;
  /**
   * The blueprint already checked and indexed (a host keeps one per world and thread, so runs of a world
   * share it). Must be made from `blueprint` with the built-in catalog; without it the session does that itself.
   */
  readonly prepared?: PreparedWorld;
  /** What happens when the agent calls `ask_human` (default: a fixed answer). */
  readonly escalation?: EscalationPolicy;
  /** Whether the agent gets the scenario's runbook (default: not at all). */
  readonly sop?: SopMode;
  /** `inside`: a background fault the given tools cannot reach does not happen (default: all happen). */
  readonly faultScope?: FaultScope;
  /**
   * An operation run (REQ-090, ADR-0094): the world runs for the configured hours, faults come from the generator and
   * time follows the pace. The host syncs it to the wall clock like a realtime session.
   */
  readonly operation?: OperationConfig;
}

/** Whether the agent gets the team's runbook (ADR-0087 item 6): not at all, in its task, or by searching for it. */
export type SopMode = "none" | "given" | "search";

/** Whether faults are limited to what the given tools can solve (ADR-0087 item 5). */
export type FaultScope = "inside" | "all";

export type SessionStatus = "ready" | "running" | "ended";

export interface CallResult extends ToolResult {
  /** Simulated time the call was made. */
  readonly t: number;
  /** Set when this call ended the run. */
  readonly ended?: EndReason;
  /** Set when the call is `ask_human` and the run now waits for a person; the answer comes with `resolveHuman`. */
  readonly waiting?: HumanRequest;
}

export interface RunResult {
  readonly score: Score;
  readonly endReason: EndReason;
  readonly task: AgentTask;
  readonly toolCalls: readonly ToolCallRecord[];
  readonly diagnosis?: Diagnosis;
  readonly diagnosedAt?: number;
  readonly timeline: readonly TimelineEntry[];
  /** The run as an append-only list of events, two clocks each (REQ-083); absent from runs saved before it existed. */
  readonly events?: readonly RunEvent[];
  readonly series: readonly MetricSeries[];
  readonly digests: { readonly world: string; readonly scenario: string; readonly oracle: string };
  readonly seed: number;
  /** The scope the run had; absent for a run that owned every domain and used the default waits. */
  readonly scope?: {
    readonly domains: readonly Domain[];
    readonly leadTimes: Required<LeadTimeSettings>;
    readonly leadTimesLabel: string;
  };
  readonly simTime: {
    readonly scenarioStart: number;
    readonly agentStart: number;
    readonly end: number;
  };
  readonly recorderBytes: number;
  /** Escalation, apart from the score (ADR-0087 item 4); only when the agent had `ask_human`. */
  readonly human?: HumanSummary;
  /** How closely the agent followed the scenario's runbook, apart from the score (ADR-0087 item 6). */
  readonly sop?: SopResult;
  /** What an operation run measured and how it was set up (ADR-0094); only for an operation run. */
  readonly operation?: OperationReport;
}

/** An operation run's numbers; the host works them out again with the tokens the harness reports. */
export interface OperationReport {
  readonly config: OperationConfig;
  readonly metrics: OperationMetrics;
  /** The services and what they cost when stopped, so the metrics can be read again from the events. */
  readonly harms: ReadonlyArray<{
    readonly id: string;
    readonly perHourKrw?: number;
    readonly delayHours?: number;
  }>;
  /** How many faults the generator planned, and how many of them did not happen (left out by the tool scope). */
  readonly planned: number;
  readonly left: number;
}

/** Runbook compliance with the way the runbook was offered. */
export interface SopResult extends SopCompliance {
  readonly mode: SopMode;
}
