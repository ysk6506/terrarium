/**
 * Reads a harness's own traces and logs from ClickStack (ClickHouse with the OpenTelemetry exporter
 * schema) over the ClickHouse HTTP interface (REQ-037). Only SELECTs, with the trace id passed as a
 * query parameter, never pasted into SQL. Map attributes arrive as strings; numbers are restored so
 * token counts add up.
 */
import type {
  AttributeValue,
  LogLine,
  Span,
  Telemetry,
  TelemetryPort,
} from "@terrarium/core/analysis";
import { NO_TELEMETRY } from "@terrarium/core/analysis";
import type { ClickStackConfig } from "./config";
import type { FetchLike } from "./harness/openai";

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
      if (!TABLE.test(t)) throw new Error(`ClickStack 테이블 이름 '${t}'이 올바르지 않다`);
  }

  private async select<T>(sql: string, traceId: string): Promise<T[]> {
    const url = new URL(this.config.url);
    url.searchParams.set("database", this.config.database);
    url.searchParams.set("default_format", "JSONEachRow");
    url.searchParams.set("readonly", "1");
    url.searchParams.set("param_traceId", traceId);
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
      throw new Error(`ClickStack이 ${r.status}로 답했다: ${(await r.text()).slice(0, 300)}`);
    const text = await r.text();
    return text
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as T);
  }

  async trace(traceId: string): Promise<Telemetry> {
    if (!/^[0-9a-f]{32}$/i.test(traceId)) return NO_TELEMETRY;
    const { traces, logs } = this.config.tables;
    const [spans, lines] = await Promise.all([
      this.select<SpanRow>(
        `SELECT TraceId, SpanId, ParentSpanId, SpanName, toUnixTimestamp64Milli(Timestamp) AS StartMs, Duration AS DurationNs, StatusCode, SpanAttributes FROM ${traces} WHERE TraceId = {traceId:String} ORDER BY Timestamp LIMIT ${MAX_ROWS}`,
        traceId,
      ),
      this.select<LogRow>(
        `SELECT toUnixTimestamp64Milli(Timestamp) AS TimeMs, SeverityText, Body, LogAttributes FROM ${logs} WHERE TraceId = {traceId:String} ORDER BY Timestamp LIMIT ${MAX_ROWS}`,
        traceId,
      ),
    ]);
    return { spans: spans.map(spanOf), logs: lines.map(logOf), metrics: [] };
  }
}
