/**
 * Reads a harness's own traces and logs from ClickStack (ClickHouse with the OpenTelemetry exporter
 * schema) over the ClickHouse HTTP interface (REQ-037, REQ-079). Only SELECTs, with every value passed as
 * a query parameter, never pasted into SQL. Map attributes arrive as strings; numbers are restored so
 * token counts add up.
 *
 * The key that ties spans to a run is the trace id of the `traceparent` the run carried, or else a
 * `run_id` span attribute (ADR-0085).
 */
import type {
  AttributeValue,
  LogLine,
  Span,
  Telemetry,
  TelemetryAdapter,
  TelemetryPort,
} from "@terrarium/core/analysis";
import { NO_TELEMETRY } from "@terrarium/core/analysis";
import type { ClickStackConfig } from "../config";
import type { FetchLike } from "../fetch";
import { attachmentFor } from "./attach";

const MAX_ROWS = 5000;
const TABLE = /^[A-Za-z_][A-Za-z0-9_.]*$/;

interface SpanRow {
  readonly TraceId: string;
  readonly SpanId: string;
  readonly ParentSpanId: string;
  readonly SpanName: string;
  readonly StartMs: number | string;
  readonly DurationNs: number | string;
  readonly StatusCode: string;
  readonly SpanAttributes: Record<string, string>;
}

interface LogRow {
  readonly TimeMs: number | string;
  readonly SeverityText: string;
  readonly Body: string;
  readonly LogAttributes: Record<string, string>;
}

/** "42" → 42, "true" → true, anything else stays text. */
export function attributeValue(text: string): AttributeValue {
  if (text === "true") return true;
  if (text === "false") return false;
  return text.trim() !== "" && Number.isFinite(Number(text)) ? Number(text) : text;
}

const attributes = (map: Record<string, string> | undefined) =>
  Object.fromEntries(Object.entries(map ?? {}).map(([k, v]) => [k, attributeValue(String(v))]));

const LEVELS: Readonly<Record<string, LogLine["level"]>> = {
  trace: "debug",
  debug: "debug",
  info: "info",
  warn: "warn",
  warning: "warn",
  error: "error",
  fatal: "error",
};

export function spanOf(row: SpanRow): Span {
  const start = Number(row.StartMs);
  return {
    traceId: row.TraceId,
    spanId: row.SpanId,
    ...(row.ParentSpanId ? { parentId: row.ParentSpanId } : {}),
    name: row.SpanName,
    start,
    end: start + Number(row.DurationNs) / 1e6,
    status: row.StatusCode.toLowerCase().includes("error") ? "error" : "ok",
    attributes: attributes(row.SpanAttributes),
  };
}

export function logOf(row: LogRow): LogLine {
  return {
    time: Number(row.TimeMs),
    level: LEVELS[row.SeverityText.toLowerCase()] ?? "info",
    message: row.Body,
    attributes: attributes(row.LogAttributes),
  };
}

export class ClickStackTelemetry implements TelemetryPort {
  constructor(
    private readonly config: ClickStackConfig,
    private readonly password: string | undefined,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    for (const t of Object.values(config.tables))
      if (!TABLE.test(t)) throw new Error(`ClickStack 테이블 이름 '${t}'이 올바르지 않아요`);
  }

  private async select<T>(sql: string, params: Readonly<Record<string, string>>): Promise<T[]> {
    const url = new URL(this.config.url);
    url.searchParams.set("database", this.config.database);
    url.searchParams.set("default_format", "JSONEachRow");
    url.searchParams.set("readonly", "1");
    for (const [name, value] of Object.entries(params))
      url.searchParams.set(`param_${name}`, value);
    const r = await this.fetchImpl(url.toString(), {
      method: "POST",
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "x-clickhouse-user": this.config.user,
        ...(this.password ? { "x-clickhouse-key": this.password } : {}),
      },
      body: sql,
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok)
      throw new Error(`ClickStack이 ${r.status}로 답했어요: ${(await r.text()).slice(0, 300)}`);
    const text = await r.text();
    return text
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as T);
  }

  /** A SELECT whose values arrive as parameters. */
  rows<T>(sql: string, params: Readonly<Record<string, string>>): Promise<T[]> {
    return this.select<T>(sql, params);
  }

  async trace(traceId: string): Promise<Telemetry> {
    if (!/^[0-9a-f]{32}$/i.test(traceId)) return NO_TELEMETRY;
    const { traces, logs } = this.config.tables;
    const [spans, lines] = await Promise.all([
      this.select<SpanRow>(
        `SELECT TraceId, SpanId, ParentSpanId, SpanName, toUnixTimestamp64Milli(Timestamp) AS StartMs, Duration AS DurationNs, StatusCode, SpanAttributes FROM ${traces} WHERE TraceId = {traceId:String} ORDER BY Timestamp LIMIT ${MAX_ROWS}`,
        { traceId },
      ),
      this.select<LogRow>(
        `SELECT toUnixTimestamp64Milli(Timestamp) AS TimeMs, SeverityText, Body, LogAttributes FROM ${logs} WHERE TraceId = {traceId:String} ORDER BY Timestamp LIMIT ${MAX_ROWS}`,
        { traceId },
      ),
    ]);
    return { spans: spans.map(spanOf), logs: lines.map(logOf), metrics: [] };
  }
}

const RUN_ID_KEYS = ["run_id", "terrarium.run_id"] as const;
const MAX_TRACES = 5;

/**
 * ClickStack as a connection's telemetry (ADR-0085). The harness is asked to carry the `traceparent` and a
 * `run_id` tag; a run is found by that trace id, or by spans that name the run in their `run_id` attribute.
 */
export class ClickStackAdapter implements TelemetryAdapter {
  readonly kind = "clickstack";
  readonly name = "ClickStack";
  private readonly query: ClickStackTelemetry;

  constructor(
    private readonly config: ClickStackConfig,
    password: string | undefined,
    fetchImpl: FetchLike = fetch,
  ) {
    this.query = new ClickStackTelemetry(config, password, fetchImpl);
  }

  attach(run: { readonly runId: string }) {
    return attachmentFor(run.runId);
  }

  /** Trace ids of spans that name the run in an attribute, for a harness that keeps its own trace ids. */
  private async tracesNamingRun(runId: string): Promise<string[]> {
    const rows = await this.query.rows<{ TraceId: string }>(
      `SELECT TraceId FROM ${this.config.tables.traces} WHERE ${RUN_ID_KEYS.map((k) => `SpanAttributes['${k}'] = {runId:String}`).join(" OR ")} GROUP BY TraceId LIMIT ${MAX_TRACES}`,
      { runId },
    );
    return rows.map((r) => r.TraceId);
  }

  async fetch(runId: string, hint?: { readonly traceId?: string }): Promise<Telemetry> {
    const found = hint?.traceId ? [hint.traceId] : [];
    const ids = [...new Set([...found, ...(await this.tracesNamingRun(runId))])].slice(
      0,
      MAX_TRACES,
    );
    const parts = await Promise.all(ids.map((id) => this.query.trace(id)));
    return parts.length === 0
      ? NO_TELEMETRY
      : {
          spans: parts.flatMap((p) => p.spans),
          logs: parts.flatMap((p) => p.logs),
          metrics: parts.flatMap((p) => p.metrics),
        };
  }
}
