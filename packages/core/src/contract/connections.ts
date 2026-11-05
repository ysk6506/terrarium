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
}

/** A header sent with every request to a connection (REQ-051). A secret one is kept sealed and not shown again. */
export interface ConnectionHeader {
  readonly name: string;
  readonly secret: boolean;
  /** Left out when the header is secret. */
  readonly value?: string;
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
