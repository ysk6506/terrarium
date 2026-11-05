/**
 * Langfuse as a connection's telemetry (REQ-079, ADR-0085). The harness is asked to carry the run's name as
 * the Langfuse `sessionId` (and `run_id` metadata, and the OpenTelemetry `traceparent`, which Langfuse's OTel
 * endpoint takes as the trace id). A run is read back through the public API with Basic auth
 * (public key : secret key).
 *
 * Langfuse is moving reads to `GET /api/public/v2/observations` (cursor paging; filters in `filter`); the older
 * `GET /api/public/traces` and `/observations` are deprecated and the only ones a self-hosted v3 has. So the
 * v2 route goes first and a 404 falls back to the older one. Observations become spans (a GENERATION is a
 * model call with `gen_ai.*` tokens, model and cost), EVENTs become log lines.
 *
 * Read from Langfuse's documentation (langfuse.com/docs/api-and-data-platform/features/observations-api and
 * the deprecated-API migration guide); it has not been run against a live Langfuse yet.
 */
import type { LogLine, Span, Telemetry, TelemetryAdapter } from "@terrarium/core/analysis";
import { NO_TELEMETRY } from "@terrarium/core/analysis";
import { z } from "zod";
import { credential, credentialFields } from "../connectors/credential";
import { EnvName, Url } from "../connectors/fields";
import { Rest } from "../connectors/rest";
import type { FetchLike } from "../fetch";
import { attachmentFor } from "./attach";
import { defineTelemetry } from "./types";

const schema = z
  .object({
    kind: z.literal("langfuse"),
    host: Url,
    publicKey: z.string().min(1).max(200),
    secretKeyEnv: EnvName.optional(),
  })
  .strict();

export type LangfuseConfig = z.output<typeof schema>;

const PAGE = 1000;
const MAX_PAGES = 5;

/** The fields of an observation that the v2 and the older API share, under the names either uses. */
interface Observation {
  readonly id?: string;
  readonly traceId?: string;
  readonly parentObservationId?: string | null;
  readonly type?: string;
  readonly name?: string;
  readonly startTime?: string;
  readonly endTime?: string | null;
  readonly level?: string;
  readonly statusMessage?: string | null;
  readonly model?: string | null;
  readonly usageDetails?: Readonly<Record<string, number>>;
  readonly usage?: Readonly<Record<string, number | null>>;
  readonly inputUsage?: number;
  readonly outputUsage?: number;
  readonly totalCost?: number | null;
  readonly calculatedTotalCost?: number | null;
  readonly costDetails?: Readonly<Record<string, number>>;
}

const LEVELS: Readonly<Record<string, LogLine["level"]>> = {
  DEBUG: "debug",
  DEFAULT: "info",
  WARNING: "warn",
  ERROR: "error",
};

const count = (...values: ReadonlyArray<number | null | undefined>): number | undefined =>
  values.find((v): v is number => typeof v === "number");

function attributesOf(o: Observation): Span["attributes"] {
  const out: Record<string, string | number | boolean> = { "langfuse.type": o.type ?? "SPAN" };
  if (o.type === "GENERATION") {
    out["gen_ai.operation.name"] = "chat";
    out["gen_ai.request.model"] = o.model || "(모델 이름 없음)";
    const input = count(o.inputUsage, o.usageDetails?.input, o.usage?.input, o.usage?.promptTokens);
    const output = count(
      o.outputUsage,
      o.usageDetails?.output,
      o.usage?.output,
      o.usage?.completionTokens,
    );
    if (input !== undefined) out["gen_ai.usage.input_tokens"] = input;
    if (output !== undefined) out["gen_ai.usage.output_tokens"] = output;
    const cost = count(o.totalCost, o.calculatedTotalCost, o.costDetails?.total);
    if (cost !== undefined) out["gen_ai.usage.cost"] = cost;
  } else if (o.type === "TOOL") out["gen_ai.tool.name"] = o.name ?? "tool";
  else if (o.type === "AGENT") out["gen_ai.operation.name"] = "invoke_agent";
  return out;
}

export function spanOf(o: Observation, traceId: string): Span {
  const start = Date.parse(o.startTime ?? "") || 0;
  const end = o.endTime ? Date.parse(o.endTime) || start : start;
  return {
    traceId,
    spanId: o.id ?? `${traceId}:${start}`,
    ...(o.parentObservationId ? { parentId: o.parentObservationId } : {}),
    name: o.name || o.type || "observation",
    start,
    end,
    status: o.level === "ERROR" ? "error" : "ok",
    attributes: attributesOf(o),
  };
}

export function logOf(o: Observation): LogLine {
  return {
    time: Date.parse(o.startTime ?? "") || 0,
    level: LEVELS[o.level ?? "DEFAULT"] ?? "info",
    message: [o.name, o.statusMessage].filter(Boolean).join(": ") || "event",
    attributes: {},
  };
}

/** Observations of any number of traces, as one telemetry. */
export function telemetryOf(observations: readonly Observation[]): Telemetry {
  if (observations.length === 0) return NO_TELEMETRY;
  const events = observations.filter((o) => o.type === "EVENT");
  const spans = observations.filter((o) => o.type !== "EVENT");
  return {
    spans: spans.map((o) => spanOf(o, o.traceId ?? "")),
    logs: events.map(logOf),
    metrics: [],
  };
}

export class LangfuseAdapter implements TelemetryAdapter {
  readonly kind = "langfuse";
  readonly name = "Langfuse";
  private readonly rest: Rest;

  constructor(
    host: string,
    publicKey: string,
    secretKey: string | undefined,
    fetchImpl: FetchLike,
  ) {
    const basic = Buffer.from(`${publicKey}:${secretKey ?? ""}`).toString("base64");
    this.rest = new Rest(host, { authorization: `Basic ${basic}` }, fetchImpl);
  }

  attach(run: { readonly runId: string }) {
    const base = attachmentFor(run.runId);
    // Langfuse reads the session from `langfuse.session.id` and metadata from `langfuse.trace.metadata.*`.
    return {
      ...base,
      tags: {
        ...base.tags,
        "langfuse.session.id": run.runId,
        "langfuse.trace.metadata.run_id": run.runId,
      },
    };
  }

  /** Every page of one v2 query. `undefined` when this Langfuse has no v2 route. */
  private async v2(query: Readonly<Record<string, string>>): Promise<Observation[] | undefined> {
    const rows: Observation[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({
        ...query,
        fields: "core,basic,usage,model",
        limit: String(PAGE),
        ...(cursor ? { cursor } : {}),
      });
      const r = await this.rest.send(
        "GET",
        `/api/public/v2/observations?${params}`,
        AbortSignal.timeout(15_000),
      );
      if (r.status === 404 || r.status === 405) return undefined;
      const text = await r.text();
      if (!r.ok) throw new Error(`Langfuse가 ${r.status}로 답했어요: ${text.slice(0, 300)}`);
      const body = JSON.parse(text) as { data?: Observation[]; meta?: { cursor?: string | null } };
      rows.push(...(body.data ?? []));
      cursor = body.meta?.cursor ?? undefined;
      if (!cursor) break;
    }
    return rows;
  }

  /** The older route: the traces of the session, then each trace's observations. */
  private async legacy(runId: string, traceId: string | undefined): Promise<Observation[]> {
    const signal = AbortSignal.timeout(15_000);
    const listed = await this.rest.json<{ data?: Array<{ id: string }> }>(
      "트레이스 목록",
      "GET",
      `/api/public/traces?${new URLSearchParams({ sessionId: runId, limit: "20" })}`,
      signal,
    );
    const ids = [
      ...new Set([...(traceId ? [traceId] : []), ...(listed.data ?? []).map((t) => t.id)]),
    ];
    const traces = await Promise.all(
      ids
        .slice(0, 5)
        .map((id) =>
          this.rest
            .json<{ observations?: Observation[] }>(
              "트레이스",
              "GET",
              `/api/public/traces/${encodeURIComponent(id)}`,
              signal,
            )
            .catch(() => ({ observations: [] as Observation[] })),
        ),
    );
    return traces.flatMap((t, i) =>
      (t.observations ?? []).map((o) => ({ ...o, traceId: o.traceId ?? ids[i] ?? "" })),
    );
  }

  async fetch(runId: string, hint?: { readonly traceId?: string }): Promise<Telemetry> {
    const tries: Array<Record<string, string>> = [
      { sessionId: runId },
      ...(hint?.traceId ? [{ traceId: hint.traceId }] : []),
      {
        filter: JSON.stringify([
          { type: "stringObject", column: "metadata", key: "run_id", operator: "=", value: runId },
        ]),
      },
    ];
    for (const query of tries) {
      const rows = await this.v2(query);
      if (rows === undefined) return telemetryOf(await this.legacy(runId, hint?.traceId));
      if (rows.length > 0) return telemetryOf(rows);
    }
    return NO_TELEMETRY;
  }
}

export const langfuseKind = defineTelemetry({
  spec: {
    kind: "langfuse",
    label: "Langfuse",
    description:
      "하네스의 트레이스가 Langfuse에 쌓일 때 골라요. 모델 호출, 토큰, 비용, 모델이 답한 시간을 실행 결과에 더해요.",
    key: "하네스가 실행마다 받는 run_id를 Langfuse의 세션 ID(또는 메타데이터 run_id)로 남기면 찾아요. OpenTelemetry로 보내면 traceparent의 트레이스 번호로도 찾아요.",
    fields: [
      {
        key: "host",
        label: "Langfuse 주소",
        type: "url",
        required: true,
        placeholder: "https://cloud.langfuse.com",
      },
      {
        key: "publicKey",
        label: "공개 키",
        type: "text",
        required: true,
        placeholder: "pk-lf-...",
      },
      ...credentialFields("secretKey", "비밀 키", "LANGFUSE_SECRET_KEY").map((f) =>
        f.key === "secretKey" ? { ...f, required: true } : f,
      ),
    ],
  },
  schema,
  create: (config, ctx) =>
    new LangfuseAdapter(
      config.host,
      config.publicKey,
      credential(ctx, "secretKey", config.secretKeyEnv),
      ctx.fetch,
    ),
});
