/** A connection as the screen shows it (REQ-051, ADR-0085): what is kept of it, and what was found out just now. */
import type { TelemetryAdapter } from "@terrarium/core/analysis";
import type { ConnectionView } from "@terrarium/core/contract";
import type { ConnectionRecord, HarnessInfo, HarnessPort } from "@terrarium/core/experiments";
import { connectorOf } from "../adapters";
import { NO_AGENTS, type Survey, survey } from "./connection-agents";
import { headerViews, messageOf, slotView } from "./connection-form";
import { type Traces, tracesView } from "./connection-traces";

export interface Entry {
  readonly id: string;
  readonly source: "config" | "screen";
  readonly connector: string;
  readonly name: string;
  readonly description: string;
  /** Without secrets: those are sealed in the record. */
  readonly settings: Readonly<Record<string, unknown>>;
  readonly metadata: Readonly<Record<string, string>>;
  readonly record?: ConnectionRecord;
  /** Undefined when it could not be built (a screen entry whose settings no longer hold). */
  readonly port?: HarnessPort;
  readonly error?: string;
  /** Where its traces pile up, as chosen; unset when nobody chose (the older rule applies). */
  readonly traces?: Traces;
  /** The adapter that choice stands for (not the server's default; see `Connections.telemetryOf`). */
  readonly adapter?: TelemetryAdapter;
}

/** The agents the connection offers now, or why it could not say. */
export async function discover(
  entry: Entry,
  wait: number,
): Promise<{ readonly found: Survey; readonly error?: string }> {
  if (!entry.port)
    return { found: NO_AGENTS, ...(entry.error === undefined ? {} : { error: entry.error }) };
  try {
    return { found: await survey(entry.port, wait) };
  } catch (err) {
    return { found: NO_AGENTS, error: messageOf(err) };
  }
}

const DAY_MS = 86_400_000;

/** When a screen connection will be removed for lack of use, and how many days are left. Nothing when removal is off. */
export function expiryOf(
  record: ConnectionRecord | undefined,
  retentionDays: number,
  now: number,
): { readonly expiresAt?: string; readonly daysLeft?: number } {
  if (!record || retentionDays <= 0) return {};
  const expires = Date.parse(record.lastUsedAt ?? record.createdAt) + retentionDays * DAY_MS;
  return {
    expiresAt: new Date(expires).toISOString(),
    daysLeft: Math.max(0, Math.ceil((expires - now) / DAY_MS)),
  };
}

export interface ViewExtras {
  readonly slotUrl: ((slot: string) => string) | undefined;
  readonly expiry: { readonly expiresAt?: string; readonly daysLeft?: number };
  /** The adapter that really reads this connection's traces, the server's default included. */
  readonly reads: TelemetryAdapter | undefined;
}

export function viewOf(
  entry: Entry,
  looked: { readonly found: Survey; readonly error?: string },
  extras: ViewExtras,
): ConnectionView {
  const spec = connectorOf(entry.connector)?.spec;
  const info: HarnessInfo = entry.port?.info ?? {
    id: entry.id,
    name: entry.name,
    kind: entry.connector,
    description: entry.description,
    toolTransport: spec?.toolTransport ?? "mcp",
    telemetry: "none",
  };
  const { found, error } = looked;
  const record = entry.record;
  return {
    ...info,
    connector: entry.connector,
    scope: spec?.scope ?? "harness",
    source: entry.source,
    ...(record ? { owner: record.owner, createdAt: record.createdAt } : {}),
    agents: found.agents,
    census: found.census,
    hiddenAgents: found.hiddenAgents,
    canTalk: typeof entry.port?.talk === "function",
    traces: tracesView(entry.traces, extras.reads),
    ...slotView(info, extras.slotUrl),
    status: error === undefined ? "ok" : "unreachable",
    ...(error === undefined ? {} : { error }),
    metadata: entry.metadata,
    headers: headerViews(record),
    secrets: Object.keys(record?.secrets ?? {}),
    ...(record ? { lastUsedAt: record.lastUsedAt ?? record.createdAt } : {}),
    ...extras.expiry,
    config: entry.settings,
  };
}
