/**
 * Connecting harnesses and agents (REQ-051). A connector knows one protocol and describes itself, so the
 * screen can draw its form and the server can check what was typed without either knowing the protocol.
 */
import type { AgentInfo, FieldChange, HarnessInfo } from "@terrarium/core/experiments";

/** What kind of value a form field takes; the screen picks the input from this. */
export type FieldType =
  | "text"
  | "url"
  /** The name of an environment variable on the server that holds a secret. Never the secret itself. */
  | "env"
  /** A token or password typed on the screen: kept sealed on the server and never shown again. */
  | "secret"
  | "number"
  | "boolean"
  | "select"
  | "textarea"
  /** One value per line, kept as a list. */
  | "lines"
  /** JSON typed by hand, kept as the value it parses to. */
  | "json";

export interface ConnectorField {
  readonly key: string;
  readonly label: string;
  readonly type: FieldType;
  readonly required?: boolean;
  /** One line that says what to put here, in the words of the person filling it. */
  readonly help?: string;
  readonly placeholder?: string;
  readonly default?: string | number | boolean;
  readonly options?: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  /** Rarely needed: the screen folds it away until asked. */
  readonly advanced?: boolean;
}

/**
 * A short way to fill a connector's form for one common shape of API: ask a few things, fix the rest
 * (ADR-0085). The screen shows the preset's fields first and folds the connector's own away as "고급".
 */
export interface ConnectorPreset {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  /** What to ask. A field whose key is also a key of the connector's fields (`url`, `token`, `model`) fills that setting. */
  readonly fields: readonly ConnectorField[];
  /**
   * Settings the preset fixes. `[[key]]` inside a value stands for what was typed in the preset field of that
   * key, written so it is safe inside a JSON string.
   */
  readonly fixed: Readonly<Record<string, string | number | boolean>>;
  /** The typed `url` is split: its address stays in `url`, its path goes into `into`, with `append` after it. */
  readonly urlPath?: { readonly into: string; readonly append?: string };
  /** What the preset expects of the API, in one line each: the request it sends and the reply it reads. */
  readonly promise: { readonly request: string; readonly reply: string };
}

export interface ConnectorSpec {
  /** Stable name of the protocol; connections point at it. */
  readonly kind: string;
  readonly label: string;
  readonly description: string;
  /** A harness brings agents of its own; an agent connector reaches exactly one agent. */
  readonly scope: "harness" | "agent";
  /** How the agent is handed Terrarium's tools for a run. */
  readonly toolTransport: HarnessInfo["toolTransport"];
  /** What the person fills in, in order. */
  readonly fields: readonly ConnectorField[];
  /** Whether people may add it from the screen. Others (a command to run) are set in the server's config file only. */
  readonly fromScreen: boolean;
  /**
   * How the harness or agent gets Terrarium's tools, and what must be ready on its side, one step to a line
   * (REQ-051). Shown above the form, so nobody connects something that can never use the tools.
   */
  readonly toolGuide: readonly string[];
  /** Short ways to fill the form for common shapes of API; the form offers them before the full list of fields. */
  readonly presets?: readonly ConnectorPreset[];
}

/** A header sent with every request to a connection (REQ-051). A secret one is kept sealed and not shown again. */
export interface ConnectionHeader {
  readonly name: string;
  readonly secret: boolean;
  /** Left out when the header is secret. */
  readonly value?: string;
}

/**
 * How many agents the harness has and how many are in the list, with the reasons for the rest (ADR-0085).
 * The screen turns it into a sentence; nothing here is prose.
 */
export interface AgentCensus {
  /** Agents the harness offers as they are. */
  readonly shown: number;
  /** Every agent the harness answered with, left out or not. */
  readonly total: number;
  readonly hidden: ReadonlyArray<{ readonly reason: string; readonly count: number }>;
  /** Whether the list the person works with already has the left-out ones in it (marked with `hidden`). */
  readonly includesHidden: boolean;
  /** Why there is nothing, in the harness's terms, when there is nothing. */
  readonly empty?: string;
  readonly notes: readonly string[];
}

/** Where a connection's traces pile up, as the screen shows it (ADR-0085). */
export interface ConnectionTraces {
  /** "none", "default" (the server's), or the kind of a telemetry adapter. */
  readonly kind: string;
  /** Name of the tool the traces go to; left out for "none". */
  readonly name?: string;
  /** What was typed, without secrets. */
  readonly config: Readonly<Record<string, unknown>>;
  /** Which secret fields have a value (the values are never returned). */
  readonly secrets: readonly string[];
}

/** A telemetry adapter as the form draws it. */
export interface TelemetryAdapterSpec {
  readonly kind: string;
  readonly label: string;
  readonly description: string;
  /** How this tool ties spans to a run, in one sentence the person can check against their harness. */
  readonly key: string;
  readonly fields: readonly ConnectorField[];
}

export interface TelemetryAdapterList {
  readonly adapters: readonly TelemetryAdapterSpec[];
  /** The server's own default (the config file's `telemetry`), when it has one. */
  readonly serverDefault?: { readonly kind: string; readonly name: string };
}

/** A connection as the screen shows it. */
export interface ConnectionView extends HarnessInfo {
  readonly connector: string;
  readonly scope: ConnectorSpec["scope"];
  /** The server's config file (read-only) or someone's registration. */
  readonly source: "config" | "screen";
  readonly owner?: string;
  readonly createdAt?: string;
  readonly agents: readonly AgentInfo[];
  /** How many agents there are, how many are in the list, and why the rest are not. */
  readonly census: AgentCensus;
  /** Agents the harness left out and the list does not show; the screen offers them with "모두 보기". */
  readonly hiddenAgents: readonly AgentInfo[];
  /** Whether "말 걸어 보기" works on this one. */
  readonly canTalk: boolean;
  /** Where its traces pile up. */
  readonly traces: ConnectionTraces;
  /** The fixed tool address to write into a harness that reads its MCP servers from its settings. */
  readonly mcpSlotUrl?: string;
  /** What the person who connected it attached (REQ-052). */
  readonly metadata: Readonly<Record<string, string>>;
  /** Headers sent with every request; the values of secret ones are never returned. */
  readonly headers: readonly ConnectionHeader[];
  /** Which of the connector's secret fields have a value (the values are never returned). */
  readonly secrets: readonly string[];
  /** Last time an experiment was made on it, or when it was connected. Only for connections made on the screen. */
  readonly lastUsedAt?: string;
  /** When it will be removed for lack of use, and how many days are left. Only for connections made on the screen. */
  readonly expiresAt?: string;
  readonly daysLeft?: number;
  readonly status: "ok" | "unreachable";
  readonly error?: string;
  /** What was typed when it was connected, without secrets (they are only names of variables). */
  readonly config: Readonly<Record<string, unknown>>;
}

/** What trying a connection found. Nothing is saved by trying. */
export interface ConnectionCheck {
  readonly ok: boolean;
  /** Why not, in words that say what to change. */
  readonly error?: string;
  readonly agents: readonly AgentInfo[];
  readonly census: AgentCensus;
  readonly hiddenAgents: readonly AgentInfo[];
  readonly canTalk: boolean;
  /** How long reaching it took, ms. */
  readonly ms: number;
  /** Things that work but are worth knowing (a variable that is not set on the server yet, …). */
  readonly notes: readonly string[];
}

/** One version of an agent as the screen shows it (REQ-053). */
export interface AgentVersionView {
  readonly n: number;
  readonly at: string;
  readonly source: "auto" | "manual";
  readonly by?: string;
  readonly label?: string;
  readonly note?: string;
  /** What people said about this version that Terrarium cannot see. */
  readonly attributes: Readonly<Record<string, string>>;
  /** What the agent said about itself when this version was found. */
  readonly snapshot: Readonly<Record<string, string>>;
  /** What changed compared with the version before it; empty for the first. */
  readonly changes: readonly FieldChange[];
  /** How many experiments ran as this version. */
  readonly experiments: number;
}

/** The versions of one agent, newest first, and what the next experiment would add. */
export interface AgentHistoryView {
  readonly harnessId: string;
  readonly agentId: string;
  readonly versions: readonly AgentVersionView[];
  /** What making an experiment on the agent now would write: the first version, or a new one with these changes. Left out when nothing would change. */
  readonly pending?: { readonly first: boolean; readonly changes: readonly FieldChange[] };
  /** Why the agent could not be looked at now (the connection is down), so `pending` is unknown. */
  readonly pendingError?: string;
}

/** What one turn of "말 걸어 보기" found (ADR-0085). Nothing is scored and no world is touched. */
export interface TryResult {
  readonly ok: boolean;
  /** The agent's answer. */
  readonly text?: string;
  /** Why not, as it came: the status and the words. */
  readonly error?: string;
  /** How long the turn took, ms. */
  readonly ms: number;
  readonly model?: string;
  readonly tokens?: { readonly input: number; readonly output: number };
  /** Tools the agent called while answering. */
  readonly toolCalls: number;
  /** Whether the traces found their way to the place the connection says. */
  readonly trace: {
    /** Name of the tool traces are read from; left out when the connection has none. */
    readonly name?: string;
    /** Left out when there is nothing to check (no tool chosen, or the turn failed). */
    readonly linked?: boolean;
    /** Spans found for this turn. */
    readonly spans: number;
    /** What to do when it did not link, or why it could not be checked. */
    readonly note?: string;
  };
}
