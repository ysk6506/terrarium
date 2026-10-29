/**
 * The experiment platform's records (REQ-030, REQ-033, REQ-040). An experiment is a recipe
 * (world × scenario × harness × agent × tools, plus seeds and time policy) and the runs it produced.
 * Worlds and scenarios are versioned by digest, so an experiment keeps meaning exactly what it ran
 * even after someone edits the world.
 */
import type { ScenarioDoc } from "@terrarium/core/scenario";
import type { RunResult, TimePolicy } from "@terrarium/core/session";
import type { Blueprint } from "@terrarium/core/world";

export type WorldOrigin = "builder" | "worldgen" | "import" | "sample";

export interface WorldRecord {
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
}

export interface ScenarioRecord {
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
  /** One run per seed. Benchmarks compare like with like, so seeds default to 1..n. */
  readonly seeds: readonly number[];
  readonly time: TimePolicy;
  /** Product versions of the protocol endpoints (BMCs follow each server's own profile). */
  readonly profiles: { readonly vcenter?: string; readonly vrops?: string };
}

/** What a recipe pointed at when the experiment was made. */
export interface Snapshot {
  readonly worldDigest: string;
  readonly worldName: string;
  readonly scenarioDigest: string;
  readonly scenarioName: string;
  readonly oracle: string;
}

export interface Experiment {
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
}

export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type ExperimentStatus = RunStatus;

export const RUN_STATUS_LABELS: Readonly<Record<RunStatus, string>> = {
  queued: "대기",
  running: "실행 중",
  completed: "완료",
  failed: "실패",
  cancelled: "취소",
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
}

export interface RunRecord {
  readonly id: string;
  readonly experimentId: string;
  /** 0-based position among the experiment's runs. */
  readonly index: number;
  readonly seed: number;
  readonly status: RunStatus;
  readonly queuedAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly result?: RunResult;
  readonly error?: string;
  readonly harness?: HarnessRunInfo;
}
