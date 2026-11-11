/**
 * The experiment platform's records (REQ-030, REQ-033, REQ-040). An experiment is a recipe
 * (world × scenario × harness × agent × tools, plus seeds and time policy) and the runs it produced.
 * Worlds and scenarios are versioned by digest, so an experiment keeps meaning exactly what it ran
 * even after someone edits the world.
 */
import type { ScenarioDoc } from "@terrarium/core/scenario";
import type {
  EscalationPolicy,
  FaultScope,
  OperationConfig,
  RunResult,
  SopMode,
  TimePolicy,
} from "@terrarium/core/session";
import type { Blueprint, Domain, LeadTimeSettings } from "@terrarium/core/world";
import type { Shared } from "./scope";

export type WorldOrigin = "builder" | "worldgen" | "import" | "sample" | "template";

export interface WorldRecord extends Shared {
  readonly id: string;
  readonly name: string;
  readonly owner: string;
  readonly origin: WorldOrigin;
  readonly blueprint: Blueprint;
  readonly digest: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** How it was made: worldgen spec, import report summary, etc. (shown, not interpreted). */
  readonly provenance?: Readonly<Record<string, unknown>>;
  /** The template or world this one was made from (REQ-101); worlds built from scratch have none. */
  readonly startedFrom?: string;
}

export interface ScenarioRecord extends Shared {
  readonly id: string;
  readonly worldId: string;
  readonly name: string;
  readonly owner: string;
  readonly doc: ScenarioDoc;
  readonly digest: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Recipe {
  readonly worldId: string;
  readonly scenarioId: string;
  readonly harnessId: string;
  readonly agentId: string;
  readonly tools: readonly string[];
  /** The seeds an experiment runs. Benchmarks compare like with like, so seeds default to 1..n. */
  readonly seeds: readonly number[];
  /**
   * How many times every seed is run (ADR-0158); absent means once. The world's chance follows the seed only,
   * so the runs of one seed start from the same world flow, and the seed (not the run) is the unit of statistics.
   */
  readonly repeats?: number;
  readonly time: TimePolicy;
  /** Product versions of the protocol endpoints (BMCs follow each server's own profile). */
  readonly profiles: { readonly vcenter?: string; readonly vrops?: string };
  /** What happens when the agent calls `ask_human` (ADR-0087 item 4). Absent: a fixed answer. */
  readonly escalation?: EscalationPolicy;
  /** `inside`: only faults the given tools can solve happen (ADR-0087 item 5). Absent: all of them. */
  readonly faultScope?: FaultScope;
  /** Whether the agent gets the scenario's runbook (ADR-0087 item 6). Absent: not at all. */
  readonly sop?: SopMode;
  /** The domains the experiment is responsible for (REQ-093); left out, it owns every domain. */
  readonly domains?: readonly Domain[];
  /** Vendor SLA, spare parts and surcharge the teams' waits are worked out from; left out, the defaults. */
  readonly leadTimes?: LeadTimeSettings;
  /**
   * An operation (REQ-090, ADR-0094): the world runs for hours with generated faults and the agent stays on. The
   * scenario is then not a stored one (its id is `OPERATION_SCENARIO_ID`) and `time` is not used.
   */
  readonly operation?: OperationConfig;
}

/** The scenario id an operation recipe carries: there is no stored scenario behind it. */
export const OPERATION_SCENARIO_ID = "operation";

/** Names and values people attach to tell results apart: team, version, a prompt variant (REQ-052). */
export type Metadata = Readonly<Record<string, string>>;

/**
 * Who ran the experiment, as it was when the experiment was made: kept with the experiment so results
 * stay comparable after the connection is changed or removed (REQ-052).
 */
export interface Subject {
  readonly harness: {
    readonly id: string;
    readonly name: string;
    readonly kind: string;
    readonly toolTransport: "mcp" | "function-calling" | "in-process";
    /** What the person who connected it attached. */
    readonly metadata?: Metadata;
  };
  readonly agent: {
    readonly id: string;
    readonly name: string;
    readonly model?: string;
    readonly description?: string;
    /** Facts the harness reported about the agent (its graph, its mode …). */
    readonly facts?: Metadata;
  };
}

/** What a recipe pointed at when the experiment was made. */
export interface Snapshot {
  readonly worldDigest: string;
  readonly worldName: string;
  readonly scenarioDigest: string;
  readonly scenarioName: string;
  readonly oracle: string;
  /** The world's physics fingerprint (REQ-113): `v1` for the default physics. Older experiments have none, which means `v1`. */
  readonly physics?: string;
}

export interface Experiment extends Shared {
  readonly id: string;
  readonly name: string;
  readonly owner: string;
  readonly createdAt: string;
  readonly recipe: Recipe;
  readonly snapshot: Snapshot;
  /** Experiments with the same key are compared in one benchmark set (REQ-039). */
  readonly benchmarkKey: string;
  /** The experiment this one was forked from (REQ-040). */
  readonly parentId?: string;
  readonly note?: string;
  /** What the person who made it attached (REQ-052). */
  readonly metadata?: Metadata;
  /** The harness and agent as they were when it was made (REQ-052). Older experiments have none. */
  readonly subject?: Subject;
  /** The agent's version (REQ-053) it ran as, found when it was made. Older experiments have none. */
  readonly agentVersion?: number;
}

export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type ExperimentStatus = RunStatus;

export const RUN_STATUS_LABELS: Readonly<Record<RunStatus, string>> = {
  queued: "대기",
  running: "실행 중",
  completed: "완료",
  failed: "실패",
  cancelled: "멈춤",
};

/** What the harness side reported about one run. */
export interface HarnessRunInfo {
  /** Trace id in ClickStack, to fetch the harness's own spans, logs and metrics. */
  readonly traceId?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly costUsd?: number;
  readonly wallSeconds?: number;
  readonly message?: string;
  /** The model that really answered, when the harness says (REQ-052). */
  readonly model?: string;
}

export interface RunRecord {
  readonly id: string;
  readonly experimentId: string;
  /** 0-based position among the experiment's runs. */
  readonly index: number;
  readonly seed: number;
  /** 1-based number among the runs of the same seed (ADR-0158); runs saved before repeats existed are all 1. */
  readonly repeat: number;
  readonly status: RunStatus;
  readonly queuedAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly result?: RunResult;
  readonly error?: string;
  readonly harness?: HarnessRunInfo;
}
