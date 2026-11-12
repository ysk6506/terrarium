import { spanKind, usageOf } from "@terrarium/core/analysis";
import { describe, expect, test } from "vitest";
import { FakeFetch, json } from "../test-support/fake-fetch";
import { ClickStackAdapter } from "./clickstack";
import { clickStackKind } from "./clickstack-kind";
import { TELEMETRY_KINDS, telemetryKindOf } from "./index";
import { LangfuseAdapter, langfuseKind } from "./langfuse";

const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const OTHER = "00f067aa0ba902b700f067aa0ba902b7";

const clickstackConfig = {
  kind: "clickstack" as const,
  name: "ClickStack",
  url: "http://ch:8123",
  database: "default",
  user: "default",
  tables: { traces: "otel_traces", logs: "otel_logs" },
};

const spanRow = (traceId: string, id: string) =>
  JSON.stringify({
    TraceId: traceId,
    SpanId: id,
    ParentSpanId: "",
    SpanName: "chat",
    StartMs: "1000",
    DurationNs: "2000000000",
    StatusCode: "STATUS_CODE_OK",
    SpanAttributes: { "gen_ai.request.model": "model-a", "gen_ai.usage.input_tokens": "100" },
  });

describe("traces are tied to a run by a key the adapter chooses [REQ-079]", () => {
  test("every adapter asks the harness to carry the trace context and the run's name", () => {
    for (const adapter of [
      new ClickStackAdapter(clickstackConfig, undefined),
      new LangfuseAdapter("http://lf.test", "pk", "sk", fetch),
    ]) {
      const a = adapter.attach({ runId: "r-9" });
      expect(a.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
      expect(a.headers).toMatchObject({ traceparent: a.traceparent, "x-terrarium-run-id": "r-9" });
      expect(a.tags).toMatchObject({ run_id: "r-9" });
      expect(a.sessionId).toBe("r-9");
      expect(adapter.attach({ runId: "r-9" }).traceparent).not.toBe(a.traceparent);
    }
    const lf = new LangfuseAdapter("http://lf.test", "pk", "sk", fetch).attach({ runId: "r-9" });
    expect(lf.tags["langfuse.session.id"]).toBe("r-9");
    expect(lf.tags["langfuse.trace.metadata.run_id"]).toBe("r-9");
  });

  test("ClickStack finds a run by its trace id and also by spans that name the run", async () => {
    const fake = new FakeFetch().on("POST", /\/$/, (req) => {
      const sql = String(req.body);
      const params = new URL(req.url).searchParams;
      if (sql.includes("GROUP BY TraceId")) {
        expect(sql).toContain("SpanAttributes['run_id'] = {runId:String}");
        expect(params.get("param_runId")).toBe("r-1");
        expect(sql).not.toContain("r-1");
        return new Response(`${JSON.stringify({ TraceId: OTHER })}\n`);
      }
      if (sql.includes("otel_traces"))
        return new Response(`${spanRow(params.get("param_traceId") as string, "a")}\n`);
      return new Response("");
    });
    const adapter = new ClickStackAdapter(clickstackConfig, undefined, fake.fetch);
    const t = await adapter.fetch("r-1", { traceId: TRACE });
    expect(t.spans.map((s) => s.traceId).sort()).toEqual([OTHER, TRACE].sort());
    expect(usageOf(t)).toMatchObject({ llmCalls: 2, inputTokens: 200 });
  });

  test("ClickStack with nothing found is simply empty", async () => {
    const fake = new FakeFetch().on("POST", /\/$/, () => new Response(""));
    const t = await new ClickStackAdapter(clickstackConfig, undefined, fake.fetch).fetch("r-1");
    expect(t.spans).toEqual([]);
  });

  test("the form asks for a few things and the rest are folded away", () => {
    expect(TELEMETRY_KINDS.map((k) => k.spec.kind)).toEqual(["clickstack", "langfuse"]);
    expect(telemetryKindOf("nope")).toBeUndefined();
    const advanced = (k: string) =>
      telemetryKindOf(k)
        ?.spec.fields.filter((f) => f.advanced)
        .map((f) => f.key);
    expect(advanced("clickstack")).toEqual(["passwordEnv", "database", "tracesTable", "logsTable"]);
    expect(clickStackKind.schema.safeParse({ kind: "clickstack", url: "not a url" }).success).toBe(
      false,
    );
    expect(
      langfuseKind.schema.safeParse({ kind: "langfuse", host: "http://lf.test", publicKey: "pk" })
        .success,
    ).toBe(true);
    for (const k of TELEMETRY_KINDS) expect(k.spec.key.length).toBeGreaterThan(20);
  });
});

const GENERATION = {
  id: "o1",
  traceId: "t1",
  type: "GENERATION",
  name: "chat",
  startTime: "2026-11-05T09:00:00.000Z",
  endTime: "2026-11-05T09:00:02.500Z",
  model: "model-a",
  inputUsage: 700,
  outputUsage: 50,
  totalCost: 0.0123,
  level: "DEFAULT",
};
const TOOL = {
  id: "o2",
  traceId: "t1",
  type: "TOOL",
  name: "list_alarms",
  parentObservationId: "o1",
  startTime: "2026-11-05T09:00:03.000Z",
  endTime: "2026-11-05T09:00:03.200Z",
  level: "ERROR",
};
const EVENT = {
  id: "o3",
  traceId: "t1",
  type: "EVENT",
  name: "retry",
  statusMessage: "rate limited",
  startTime: "2026-11-05T09:00:01.000Z",
  level: "WARNING",
};

const lf = (fake: FakeFetch) => new LangfuseAdapter("http://lf.test/", "pk-1", "sk-1", fake.fetch);

describe("Langfuse as a connection's telemetry [REQ-079]", () => {
  test("a session's observations become spans with the model, tokens, cost and the time it took", async () => {
    const fake = new FakeFetch().on("GET", /^\/api\/public\/v2\/observations$/, () =>
      json({ data: [GENERATION, TOOL, EVENT], meta: {} }),
    );
    const t = await lf(fake).fetch("r-1");
    const query = new URL(fake.requests[0]?.url as string).searchParams;
    expect(query.get("sessionId")).toBe("r-1");
    expect(fake.requests[0]?.headers.authorization).toBe(
      `Basic ${Buffer.from("pk-1:sk-1").toString("base64")}`,
    );
    expect(t.spans.map((s) => spanKind(s))).toEqual(["llm", "tool"]);
    expect(usageOf(t)).toMatchObject({
      llmCalls: 1,
      llmSeconds: 2.5,
      inputTokens: 700,
      outputTokens: 50,
      models: ["model-a"],
      errors: 1,
    });
    expect(t.spans[0]?.attributes["gen_ai.usage.cost"]).toBe(0.0123);
    expect(t.spans[1]).toMatchObject({ parentId: "o1", status: "error" });
    expect(t.logs).toEqual([
      {
        time: Date.parse("2026-11-05T09:00:01.000Z"),
        level: "warn",
        message: "retry: rate limited",
        attributes: {},
      },
    ]);
  });

  test("pages are followed by cursor; when the session has nothing, the trace id and then metadata are tried", async () => {
    const asked: string[] = [];
    const fake = new FakeFetch().on("GET", /^\/api\/public\/v2\/observations$/, (req) => {
      const q = new URL(req.url).searchParams;
      asked.push(
        [...q.keys()]
          .filter((k) => ["sessionId", "traceId", "filter", "cursor"].includes(k))
          .join("+"),
      );
      if (q.get("sessionId")) return json({ data: [], meta: {} });
      if (q.get("traceId")) return json({ data: [], meta: {} });
      return q.get("cursor")
        ? json({ data: [TOOL], meta: {} })
        : json({ data: [GENERATION], meta: { cursor: "next" } });
    });
    const t = await lf(fake).fetch("r-1", { traceId: "t1" });
    expect(asked).toEqual(["sessionId", "traceId", "filter", "filter+cursor"]);
    expect(t.spans).toHaveLength(2);
    const filter = JSON.parse(
      new URL(fake.requests[2]?.url as string).searchParams.get("filter") as string,
    );
    expect(filter[0]).toMatchObject({ column: "metadata", key: "run_id", value: "r-1" });
  });

  test("a Langfuse without the new route is read through the older one", async () => {
    const fake = new FakeFetch()
      .on("GET", /^\/api\/public\/v2\/observations$/, () => new Response("no", { status: 404 }))
      .on("GET", /^\/api\/public\/traces$/, () => json({ data: [{ id: "t1" }] }))
      .on("GET", /^\/api\/public\/traces\/t1$/, () =>
        json({
          id: "t1",
          observations: [
            { ...GENERATION, traceId: undefined, totalCost: undefined, calculatedTotalCost: 0.5 },
          ],
        }),
      );
    const t = await lf(fake).fetch("r-1");
    expect(new URL(fake.requests[1]?.url as string).searchParams.get("sessionId")).toBe("r-1");
    expect(t.spans[0]).toMatchObject({ traceId: "t1" });
    expect(t.spans[0]?.attributes["gen_ai.usage.cost"]).toBe(0.5);
  });

  test("a rejected key and a run with no observations are told apart", async () => {
    const refused = new FakeFetch().on(
      "GET",
      /observations$/,
      () => new Response('{"message":"Invalid credentials"}', { status: 401 }),
    );
    await expect(lf(refused).fetch("r-1")).rejects.toThrow("Langfuse가 401로 답했어요");
    const empty = new FakeFetch().on("GET", /observations$/, () => json({ data: [], meta: {} }));
    expect((await lf(empty).fetch("r-1")).spans).toEqual([]);
  });
});
