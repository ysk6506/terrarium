/**
 * What the harness itself recorded (REQ-037): traces, logs and metrics, read from ClickStack by the
 * server's adapter. Spans follow the OpenTelemetry GenAI conventions where the harness uses them
 * (gen_ai.* attributes); anything else is still shown, just not counted as model or tool work.
 */

import type { TelemetryAttachment } from "@terrarium/core/experiments";

export type AttributeValue = string | number | boolean;

export interface Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentId?: string;
  readonly name: string;
  /** Milliseconds since the epoch. */
  readonly start: number;
  readonly end: number;
  readonly status: "ok" | "error";
  readonly attributes: Readonly<Record<string, AttributeValue>>;
}

export interface LogLine {
  readonly time: number;
  readonly level: "debug" | "info" | "warn" | "error";
  readonly message: string;
  readonly attributes: Readonly<Record<string, AttributeValue>>;
}

export interface MetricPoint {
  readonly name: string;
  readonly time: number;
  readonly value: number;
  readonly attributes: Readonly<Record<string, AttributeValue>>;
}

export interface Telemetry {
  readonly spans: readonly Span[];
  readonly logs: readonly LogLine[];
  readonly metrics: readonly MetricPoint[];
}

export const NO_TELEMETRY: Telemetry = { spans: [], logs: [], metrics: [] };

export interface TelemetryPort {
  /** Everything recorded under one trace id; empty when the harness sent nothing. */
  trace(traceId: string): Promise<Telemetry>;
}

/**
 * Where one harness's traces pile up, and how to find a run's again (ADR-0085). Each tool has its own
 * key to tie spans to a run, so the adapter decides: what to ask the harness to carry, and how to read.
 */
export interface TelemetryAdapter {
  /** "clickstack", "langfuse". */
  readonly kind: string;
  /** Shown to people. */
  readonly name: string;
  /** What the harness must carry for this run. Pure: nothing is sent anywhere. */
  attach(run: { readonly runId: string }): TelemetryAttachment;
  /**
   * Spans, logs and tokens recorded for the run; empty when nothing was found. `hint.traceId` is the trace
   * id the harness reported back, which wins over the one we asked for.
   */
  fetch(runId: string, hint?: { readonly traceId?: string }): Promise<Telemetry>;
}

/** The trace id in a W3C traceparent ("00-<trace>-<span>-01"). */
export const traceIdOf = (traceparent: string | undefined): string | undefined =>
  traceparent?.split("-")[1];

export type SpanKind = "llm" | "tool" | "agent" | "other";

/** What a span was: a model call, a tool call, the agent's own step, or something else. */
export function spanKind(span: Span): SpanKind {
  const a = span.attributes;
  const op = String(a["gen_ai.operation.name"] ?? "");
  if (op === "execute_tool" || a["gen_ai.tool.name"] !== undefined) return "tool";
  if (
    op === "chat" ||
    op === "text_completion" ||
    op === "generate_content" ||
    a["gen_ai.request.model"] !== undefined
  )
    return "llm";
  if (op === "invoke_agent" || op === "create_agent") return "agent";
  return "other";
}

const num = (v: AttributeValue | undefined) => (typeof v === "number" ? v : Number(v ?? 0) || 0);

/** Dollars the harness's own model calls cost, when the trace says (`gen_ai.usage.cost`). */
export function costOf(t: Telemetry): number {
  return t.spans.reduce((sum, s) => sum + num(s.attributes["gen_ai.usage.cost"]), 0);
}

export interface ModelUsage {
  readonly llmCalls: number;
  readonly llmSeconds: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly models: readonly string[];
  readonly errors: number;
  readonly wallSeconds: number;
  readonly errorLogs: number;
}

/** Totals over a trace: model calls, time in the model, tokens, models used, errors. */
export function usageOf(t: Telemetry): ModelUsage {
  const llm = t.spans.filter((s) => spanKind(s) === "llm");
  const starts = t.spans.map((s) => s.start);
  const ends = t.spans.map((s) => s.end);
  return {
    llmCalls: llm.length,
    llmSeconds: llm.reduce((sum, s) => sum + (s.end - s.start) / 1000, 0),
    inputTokens: llm.reduce((sum, s) => sum + num(s.attributes["gen_ai.usage.input_tokens"]), 0),
    outputTokens: llm.reduce((sum, s) => sum + num(s.attributes["gen_ai.usage.output_tokens"]), 0),
    models: [
      ...new Set(
        llm.map((s) => String(s.attributes["gen_ai.request.model"] ?? "")).filter(Boolean),
      ),
    ].sort(),
    errors: t.spans.filter((s) => s.status === "error").length,
    wallSeconds: starts.length > 0 ? (Math.max(...ends) - Math.min(...starts)) / 1000 : 0,
    errorLogs: t.logs.filter((l) => l.level === "error").length,
  };
}
