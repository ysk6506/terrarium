/**
 * Ports of the experiment platform. Adapters live in the server; the engine only sees these.
 *
 *   HarnessPort      any agent harness (REQ-031): lists its agents, runs one with Terrarium's tools
 *   ExperimentStore  where worlds, scenarios, experiments, runs and share links are kept
 */
import type { ToolResult, ToolSpec } from "@terrarium/core/tools";
import type { Blueprint, EntityKind } from "@terrarium/core/world";
import type { AgentHistory } from "./agent-version";
import type { CalibrationMark, TitleAward, WorldLike } from "./community";
import type { Journal, JournalEntry } from "./journal";
import type { LlmModelRecord } from "./llm-models";
import type { Experiment, HarnessRunInfo, RunRecord, ScenarioRecord, WorldRecord } from "./model";
import type { PresetKind, PresetRecord } from "./presets";

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
  /** Whether it can take a summary of every new alarm pushed to it during an operation (ADR-0094 item 4). */
  readonly wakeable?: boolean;
}

/** Where a harness listens for the alarm summaries an operation pushes when "알람마다 깨우기" is on. */
export interface AlarmWake {
  subscribe(listener: (summary: string) => void): () => void;
}

/** The facts of an operation run a harness may need (ADR-0094). */
export interface OperationInfo {
  readonly hours: number;
  readonly wake?: AlarmWake;
}

export interface AgentInfo {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly model?: string;
  /** Why the harness would not list it by itself ("status inactive"); set only when the person asked to see everything. */
  readonly hidden?: string;
  /** Facts the harness reports about the agent, kept with the experiment for comparing (REQ-052). */
  readonly facts?: Readonly<Record<string, string>>;
}

/**
 * What a harness has, and what it left out of the list and why (ADR-0085). A list that quietly drops
 * agents sends a person looking for them in the wrong place, so the reason is data, not a log line.
 */
export interface AgentInventory {
  /** The agents the harness offers as they are. */
  readonly shown: readonly AgentInfo[];
  /** Agents left out, grouped by the reason. Each reason is a short phrase such as "status inactive". */
  readonly hidden: ReadonlyArray<{
    readonly reason: string;
    readonly agents: readonly AgentInfo[];
  }>;
  /** Whether `agents()` lists the left-out ones too (the person asked for everything). They keep their `hidden` mark. */
  readonly includesHidden?: boolean;
  /** Why there is nothing, when there is nothing, in the harness's own terms. */
  readonly empty?: string;
  /** Worth knowing though it worked (for example: this user only sees what is shared with it). */
  readonly notes?: readonly string[];
}

/**
 * What a telemetry adapter asks the harness to carry for one run, so the run's traces can be found again.
 * A connector adds what it can: the `traceparent` header, the extra headers, `run_id` as a tag or metadata.
 */
export interface TelemetryAttachment {
  readonly traceparent: string;
  /** Headers a connector may add to its requests (`x-terrarium-run-id`, `baggage`). */
  readonly headers: Readonly<Record<string, string>>;
  /** `run_id` and friends, for a harness that puts tags or metadata on its own spans. */
  readonly tags: Readonly<Record<string, string>>;
  /** For a tool that groups by session (Langfuse's `sessionId`). */
  readonly sessionId?: string;
}

/** One turn of talk with an agent: no tools, no world, nothing scored (REQ-051). */
export interface TalkRequest {
  readonly runId: string;
  readonly agentId: string;
  readonly text: string;
  readonly signal: AbortSignal;
  readonly telemetry?: TelemetryAttachment;
}

export interface TalkReply {
  readonly text: string;
  readonly model?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  /** How many tools the agent called on its own while answering. */
  readonly toolCalls: number;
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
  /** Set for an operation: the agent stays on for hours and the run ends when the time is up (ADR-0094). */
  readonly operation?: OperationInfo;
  readonly tools: ToolEndpoint;
  readonly signal: AbortSignal;
  /** W3C trace context, so the harness's spans join this run's trace in ClickStack. */
  readonly traceparent?: string;
  /** Everything the connection's telemetry adapter wants carried (ADR-0085); `traceparent` is part of it. */
  readonly telemetry?: TelemetryAttachment;
}

export interface AgentRunOutcome {
  readonly status: "finished" | "error" | "cancelled";
  readonly message?: string;
  readonly harness?: HarnessRunInfo;
}

export interface HarnessPort {
  readonly info: HarnessInfo;
  agents(): Promise<readonly AgentInfo[]>;
  /** The agents with the ones left out and why. A harness that leaves nothing out need not have it. */
  inventory?(): Promise<AgentInventory>;
  run(request: AgentRunRequest): Promise<AgentRunOutcome>;
  /** One question, one answer, no tools. A harness that cannot do it leaves it out and the screen says so. */
  talk?(request: TalkRequest): Promise<TalkReply>;
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
  /** Where this harness's traces pile up, if the person said (ADR-0085). Unset: the old rule, the server's default. */
  readonly traces?: {
    /** "none", "default" (the server's), or the kind of a telemetry adapter. */
    readonly kind: string;
    readonly config: Readonly<Record<string, unknown>>;
    /** Sealed, by the adapter's field name. */
    readonly secrets?: Readonly<Record<string, string>>;
  };
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
  /** Add to what an operation run keeps for a restart (ADR-0112); `at` is the real time of the write. */
  appendJournal(runId: string, entries: readonly JournalEntry[], at: string): Promise<void>;
  /** What the run kept so far, in order; empty when it kept nothing. */
  readJournal(runId: string): Promise<Journal>;
  /** Forget a run's journal (the run ended). */
  deleteJournal(runId: string): Promise<void>;
  /** Save or replace a saved thing (instruction, tool set, runbook). */
  putPreset(preset: PresetRecord): Promise<void>;
  getPreset(id: string): Promise<PresetRecord | undefined>;
  /** One person's saved things, deleted ones included, oldest first. */
  listPresets(owner: string, kind?: PresetKind): Promise<PresetRecord[]>;
  /** Remove for good. */
  deletePreset(id: string): Promise<boolean>;
  /** Save or replace a registered model API (ADR-0119). */
  putModel(model: LlmModelRecord): Promise<void>;
  getModel(id: string): Promise<LlmModelRecord | undefined>;
  /** Every registered model API, in the order they were registered. */
  listModels(): Promise<LlmModelRecord[]>;
  deleteModel(id: string): Promise<boolean>;
  /** Put a heart on a world; asking twice leaves one (REQ-101). */
  putLike(like: WorldLike): Promise<void>;
  /** Take the heart back. False when there was none. */
  deleteLike(worldId: string, user: string): Promise<boolean>;
  listLikes(): Promise<WorldLike[]>;
  /** Remember that a scenario was checked (one row per scenario version). */
  putCalibrationMark(mark: CalibrationMark): Promise<void>;
  listCalibrationMarks(): Promise<CalibrationMark[]>;
  /** Titles people earned, everyone's, oldest first. */
  listTitleAwards(): Promise<TitleAward[]>;
  /** Keep new awards; one already there is left as it was. */
  putTitleAwards(awards: readonly TitleAward[]): Promise<void>;
}
