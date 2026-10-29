/**
 * Ports of the experiment platform. Adapters live in the server; the engine only sees these.
 *
 *   HarnessPort      any agent harness (REQ-031): lists its agents, runs one with Terrarium's tools
 *   ExperimentStore  where worlds, scenarios, experiments, runs and share links are kept
 */
import type { ToolResult, ToolSpec } from "@terrarium/core/tools";
import type { Blueprint, EntityKind } from "@terrarium/core/world";
import type { Experiment, HarnessRunInfo, RunRecord, ScenarioRecord, WorldRecord } from "./model";

export interface HarnessInfo {
  readonly id: string;
  readonly name: string;
  /** Adapter kind, e.g. "scripted", "openai-compatible", "http", "mcp-agent". */
  readonly kind: string;
  readonly description: string;
  /** How the harness reaches Terrarium's tools during a run. */
  readonly toolTransport: "mcp" | "function-calling" | "in-process";
  /** Whether its traces, metrics and logs can be read from ClickStack. */
  readonly telemetry: "clickstack" | "none";
}

export interface AgentInfo {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly model?: string;
}

export interface ToolCallOutcome extends ToolResult {
  /** Set when this call ended the run (diagnosis submitted, budget or time used up). */
  readonly ended?: string;
}

/** The tools of one run, as the harness reaches them. */
export interface ToolEndpoint {
  readonly specs: readonly ToolSpec[];
  /** Streamable-HTTP MCP endpoint serving exactly these tools for this run, when the server offers one. */
  readonly mcpUrl?: string;
  /** Direct call, for adapters that do the function calling themselves. */
  call(name: string, args: Record<string, unknown>): Promise<ToolCallOutcome>;
}

export interface AgentRunRequest {
  readonly runId: string;
  /** The run's seed, so scripted agents are as repeatable as the world. */
  readonly seed: number;
  readonly agentId: string;
  readonly prompt: string;
  readonly limits: { readonly maxToolCalls: number; readonly timeLimitSeconds: number };
  readonly tools: ToolEndpoint;
  readonly signal: AbortSignal;
  /** W3C trace context, so the harness's spans join this run's trace in ClickStack. */
  readonly traceparent?: string;
}

export interface AgentRunOutcome {
  readonly status: "finished" | "error" | "cancelled";
  readonly message?: string;
  readonly harness?: HarnessRunInfo;
}

export interface HarnessPort {
  readonly info: HarnessInfo;
  agents(): Promise<readonly AgentInfo[]>;
  run(request: AgentRunRequest): Promise<AgentRunOutcome>;
}

export type WorldSummary = Omit<WorldRecord, "blueprint"> & {
  readonly counts: Readonly<Partial<Record<EntityKind, number>>>;
};

export interface ExperimentFilter {
  readonly owner?: string;
  readonly benchmarkKey?: string;
  readonly parentId?: string;
  readonly worldId?: string;
  readonly scenarioId?: string;
  /** Words that must all appear in the name or note (case-insensitive). */
  readonly text?: string;
  readonly limit?: number;
}

export interface ShareRecord {
  readonly token: string;
  readonly experimentId: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly expiresAt?: string;
}

export interface ExperimentStore {
  /** Save the head of a world and keep its version under its digest. */
  putWorld(world: WorldRecord): Promise<void>;
  getWorld(id: string): Promise<WorldRecord | undefined>;
  listWorlds(): Promise<WorldSummary[]>;
  /** A world as it was at `digest`, even after later edits. */
  worldVersion(id: string, digest: string): Promise<Blueprint | undefined>;
  /** Hide a world from lists; its versions stay for the experiments that used them. */
  deleteWorld(id: string): Promise<boolean>;
  putScenario(scenario: ScenarioRecord): Promise<void>;
  getScenario(id: string): Promise<ScenarioRecord | undefined>;
  listScenarios(worldId?: string): Promise<ScenarioRecord[]>;
  scenarioVersion(id: string, digest: string): Promise<ScenarioRecord["doc"] | undefined>;
  deleteScenario(id: string): Promise<boolean>;
  putExperiment(experiment: Experiment): Promise<void>;
  getExperiment(id: string): Promise<Experiment | undefined>;
  /** Newest first. */
  listExperiments(filter?: ExperimentFilter): Promise<Experiment[]>;
  putRun(run: RunRecord): Promise<void>;
  getRun(id: string): Promise<RunRecord | undefined>;
  /** In run order. */
  listRuns(experimentId: string): Promise<RunRecord[]>;
  /** Runs still queued or running, oldest first: what a restarted server must pick up. */
  listActiveRuns(): Promise<RunRecord[]>;
  putShare(share: ShareRecord): Promise<void>;
  getShare(token: string): Promise<ShareRecord | undefined>;
  deleteShare(token: string): Promise<boolean>;
}
