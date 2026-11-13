import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { NO_TELEMETRY, usageOf } from "@terrarium/core/analysis";
import { afterAll, describe, expect, test } from "vitest";
import { buildAdapters } from "./build";
import { BUILTIN_HARNESS_ID, loadConfig, parseConfig, secret } from "./config";
import { SqliteStore } from "./sqlite-store";
import { attributeValue, ClickStackTelemetry, logOf, spanOf } from "./telemetry/clickstack";
import { FakeFetch } from "./test-support/fake-fetch";

const dir = mkdtempSync(path.join(tmpdir(), "terrarium-adapters-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("server configuration [REQ-031] [REQ-037]", () => {
  test("no file: the built-in harness and nothing else; every connection is named in the file", () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      port: 8787,
      dataDir: "data",
      harnesses: [{ id: BUILTIN_HARNESS_ID }],
    });
    expect(config.telemetry).toBeUndefined();
  });

  test("a file with every kind of connection; relative paths follow the file", () => {
    const file = path.join(dir, "terrarium.json");
    writeFileSync(
      file,
      JSON.stringify({
        dataDir: "./state",
        identity: { header: "X-Forwarded-User" },
        harnesses: [
          { kind: "http", id: "remote", name: "원격", url: "https://h.internal" },
          { kind: "a2a", id: "agent", name: "에이전트", url: "https://a.internal" },
        ],
        telemetry: { kind: "clickstack", url: "http://ch:8123" },
      }),
    );
    const config = loadConfig({ TERRARIUM_CONFIG: file });
    expect(config.dataDir).toBe(path.join(dir, "state"));
    expect(config.identity.header).toBe("x-forwarded-user");
    expect(config.harnesses.map((h) => h.id)).toEqual(["builtin", "remote", "agent"]);
    expect(config.telemetry?.tables).toEqual({ traces: "otel_traces", logs: "otel_logs" });
  });

  test("mistakes are named in Korean, with where they are", () => {
    expect(() => parseConfig({ port: "x" })).toThrow(
      "설정이 올바르지 않아요: port 숫자여야 해요 (지금은 문자열이에요)",
    );
    expect(() =>
      parseConfig({
        harnesses: [
          { kind: "scripted", id: "a" },
          { kind: "scripted", id: "a" },
        ],
      }),
    ).toThrow("하네스 id가 겹쳐요");
    expect(() => parseConfig({ colour: 1 })).toThrow("(전체) 모르는 항목이 있어요: 'colour'");
    expect(
      parseConfig({ harnesses: [{ kind: "scripted", id: "builtin", name: "기준" }] }).harnesses,
    ).toHaveLength(1);
    expect(secret({ KEY: "v" }, "KEY")).toBe("v");
    expect(secret({}, undefined)).toBeUndefined();
    expect(() => secret({}, "LLM_KEY")).toThrow("환경 변수 LLM_KEY가 비어 있어요");
  });

  test("[REQ-031] a config that still has `sources` does not start: it says so in one line, and nothing is read silently (ADR-0202)", () => {
    const old = {
      sources: [{ kind: "falkordb", id: "kg", name: "운영 KG", url: "falkor://kg:6379" }],
    };
    expect(() => parseConfig(old)).toThrow(
      "설정: sources 설정은 더 쓰지 않아요. 설정에서 지워 주세요 (ADR-0202)",
    );
    expect(() => parseConfig({ sources: [] }, "terrarium.json")).toThrow(
      "terrarium.json: sources 설정은 더 쓰지 않아요",
    );
    const file = path.join(dir, "old-sources.json");
    writeFileSync(file, JSON.stringify(old));
    expect(() => loadConfig({ TERRARIUM_CONFIG: file })).toThrow("sources 설정은 더 쓰지 않아요");
  });

  test("adapters are built from the config", async () => {
    const config = parseConfig({
      dataDir: path.join(dir, "built"),
      harnesses: [
        {
          kind: "http",
          id: "remote",
          name: "원격",
          url: "https://h.internal",
          tokenEnv: "H_TOKEN",
        },
        { kind: "a2a", id: "agent", name: "에이전트", url: "https://a.internal" },
      ],
      telemetry: { kind: "clickstack", url: "http://ch:8123" },
    });
    const adapters = buildAdapters(config, { env: { H_TOKEN: "t" } });
    expect(adapters.harnesses.map((h) => h.info.kind)).toEqual(["scripted", "http", "a2a"]);
    expect(adapters.telemetry?.name).toBe("ClickStack");
    expect(adapters.store).toBeInstanceOf(SqliteStore);
    await adapters.close();
    expect(() => buildAdapters(config, { env: {} })).toThrow("환경 변수 H_TOKEN이 비어 있어요");
  });
});

describe("harness telemetry from ClickStack [REQ-037]", () => {
  const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
  const config = parseConfig({
    telemetry: { kind: "clickstack", url: "http://ch:8123/", passwordEnv: "CH_PW" },
  }).telemetry as NonNullable<ReturnType<typeof parseConfig>["telemetry"]>;

  test("spans and logs of one trace, with numbers restored and the trace id as a parameter", async () => {
    const fake = new FakeFetch().on("POST", /\/$/, (req) => {
      const sql = String(req.body);
      if (sql.includes("otel_traces"))
        return new Response(
          [
            JSON.stringify({
              TraceId: traceId,
              SpanId: "a",
              ParentSpanId: "",
              SpanName: "chat",
              StartMs: "1000",
              DurationNs: "2500000000",
              StatusCode: "STATUS_CODE_OK",
              SpanAttributes: {
                "gen_ai.request.model": "model-a",
                "gen_ai.usage.input_tokens": "1200",
              },
            }),
            JSON.stringify({
              TraceId: traceId,
              SpanId: "b",
              ParentSpanId: "a",
              SpanName: "tool",
              StartMs: 2000,
              DurationNs: 1000000,
              StatusCode: "Error",
              SpanAttributes: {},
            }),
            "",
          ].join("\n"),
        );
      return new Response(
        `${JSON.stringify({ TimeMs: "1500", SeverityText: "WARN", Body: "retry", LogAttributes: { n: "2" } })}\n`,
      );
    });
    const t = await new ClickStackTelemetry(config, "pw", fake.fetch).trace(traceId);
    expect(t.spans).toEqual([
      {
        traceId,
        spanId: "a",
        name: "chat",
        start: 1000,
        end: 3500,
        status: "ok",
        attributes: { "gen_ai.request.model": "model-a", "gen_ai.usage.input_tokens": 1200 },
      },
      {
        traceId,
        spanId: "b",
        parentId: "a",
        name: "tool",
        start: 2000,
        end: 2001,
        status: "error",
        attributes: {},
      },
    ]);
    expect(t.logs).toEqual([{ time: 1500, level: "warn", message: "retry", attributes: { n: 2 } }]);
    expect(usageOf(t)).toMatchObject({ llmCalls: 1, inputTokens: 1200, errors: 1 });
    const url = new URL(fake.requests[0]?.url as string);
    expect(url.searchParams.get("param_traceId")).toBe(traceId);
    expect(url.searchParams.get("readonly")).toBe("1");
    expect(String(fake.requests[0]?.body)).not.toContain(traceId);
    expect(fake.requests[0]?.headers["x-clickhouse-key"]).toBe("pw");
  });

  test("odd trace ids are not queried; a failing ClickStack is an error with its words", async () => {
    const fake = new FakeFetch().on(
      "POST",
      /\//,
      () => new Response("DB::Exception: no table", { status: 404 }),
    );
    const telemetry = new ClickStackTelemetry(config, undefined, fake.fetch);
    expect(await telemetry.trace("'; DROP TABLE x; --")).toBe(NO_TELEMETRY);
    expect(fake.requests).toHaveLength(0);
    await expect(telemetry.trace(traceId)).rejects.toThrow(
      "ClickStack이 404로 답했어요: DB::Exception: no table",
    );
    expect(
      () => new ClickStackTelemetry({ ...config, tables: { traces: "x;y", logs: "l" } }, undefined),
    ).toThrow("ClickStack 테이블 이름 'x;y'이 올바르지 않아요");
  });

  test("attribute and level conversions", () => {
    expect([
      attributeValue("3.5"),
      attributeValue("true"),
      attributeValue("false"),
      attributeValue(" "),
      attributeValue("gpt"),
    ]).toEqual([3.5, true, false, " ", "gpt"]);
    expect(logOf({ TimeMs: 1, SeverityText: "FATAL", Body: "x", LogAttributes: {} }).level).toBe(
      "error",
    );
    expect(logOf({ TimeMs: 1, SeverityText: "NOTICE", Body: "x", LogAttributes: {} }).level).toBe(
      "info",
    );
    expect(
      spanOf({
        TraceId: "t",
        SpanId: "s",
        ParentSpanId: "",
        SpanName: "n",
        StartMs: 0,
        DurationNs: 0,
        StatusCode: "",
        SpanAttributes: {},
      }).status,
    ).toBe("ok");
  });
});

describe("the SQLite store keeps its data [REQ-030]", () => {
  test("data survives a restart; a newer data file is refused", async () => {
    const file = path.join(dir, "keep", "terrarium.db");
    const first = new SqliteStore(file);
    await first.putShare({
      token: "t1",
      experimentId: "e1",
      createdBy: "y",
      createdAt: "2026-10-29",
    });
    first.close();
    const again = new SqliteStore(file);
    expect(await again.getShare("t1")).toMatchObject({ experimentId: "e1" });
    again.close();
    const raw = new DatabaseSync(file);
    raw.exec("PRAGMA user_version = 99");
    raw.close();
    expect(() => new SqliteStore(file)).toThrow("데이터 파일이 더 새 버전(99)이에요");
  });
});
