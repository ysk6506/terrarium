/**
 * Ports of the experiment platform. Adapters live in the server; the engine only sees these.
 *
 *   HarnessPort      any agent harness (REQ-031): lists its agents, runs one with Terrarium's tools
 *   ExperimentStore  where worlds, scenarios, experiments, runs and share links are kept
 */
import type { ToolResult, ToolSpec } from "@terrarium/core/tools";
import type { Blueprint, EntityKind } from "@terrarium/core/world";
import type { AgentHistory } from "./agent-version";
import type { Experiment, HarnessRunInfo, RunRecord, ScenarioRecord, WorldRecord } from "./model";

export interface HarnessInfo {
  readonly id: string;
  readonly name: string;
  /** Adapter kind, e.g. "scripted", "http", "a2a", "mcp-agent". */
  readonly kind: string;
  readonly description: string;
  /** How the harness reaches Terrarium's tools during a run. */
  readonly toolTransport: "mcp" | "function-calling" | "in-process";
  /**
   * For a harness that reads its MCP servers from its own settings, not per request: the name of this
   * connection's fixed tool address. While one of its runs goes, that address serves the run's tools.
   */
  readonly mcpSlot?: string;
  /** Whether its traces, metrics and logs can be read from ClickStack. */
  readonly telemetry: "clickstack" | "none";
}

export interface AgentInfo {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly model?: string;
  /** Facts the harness reports about the agent, kept with the experiment for comparing (REQ-052). */
  readonly facts?: Readonly<Record<string, string>>;
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
  /** `name=value`, or just `name`: the experiment, or the connection it ran on, carries that metadata (REQ-052). */
  readonly meta?: string;
  readonly limit?: number;
}

export interface ShareRecord {
  readonly token: string;
  readonly experimentId: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly expiresAt?: string;
}

/**
 * A harness or agent connected from the screen or the API (REQ-051): which connector reaches it and how.
 * Secrets are never in `config` in the clear: the names of the environment variables that hold them, or the
 * values sealed under `secrets` and `headers`.
 */
export interface ConnectionRecord {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** Kind of the connector that reaches it, e.g. "http", "a2a". */
  readonly connector: string;
  readonly config: Readonly<Record<string, unknown>>;
  /** What the person who connected it attached (REQ-052). */
  readonly metadata?: Readonly<Record<string, string>>;
  /** Headers sent with every request. A secret one has `sealed` instead of `value`. */
  readonly headers?: ReadonlyArray<{
    readonly name: string;
    readonly value?: string;
    readonly sealed?: string;
  }>;
  /** Tokens and passwords typed on the screen, sealed, by the connector's field name. */
  readonly secrets?: Readonly<Record<string, string>>;
  readonly owner: string;
  readonly createdAt: string;
  /** When an experiment was last made on it; used to remove connections nobody uses. */
  readonly lastUsedAt?: string;
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
  putConnection(connection: ConnectionRecord): Promise<void>;
  /** In the order they were made. */
  listConnections(): Promise<ConnectionRecord[]>;
  deleteConnection(id: string): Promise<boolean>;
  /** The versions of one agent of one harness (REQ-053). */
  getAgentHistory(harnessId: string, agentId: string): Promise<AgentHistory | undefined>;
  putAgentHistory(history: AgentHistory): Promise<void>;
  /** Every agent of the harness that has versions. */
  listAgentHistories(harnessId: string): Promise<AgentHistory[]>;
  /** All the histories of a harness, when its connection is removed. Returns how many. */
  deleteAgentHistories(harnessId: string): Promise<number>;
}
