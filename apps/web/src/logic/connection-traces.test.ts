import type { ConnectorField, TelemetryAdapterList } from "@terrarium/core/contract";
import { describe, expect, test } from "vitest";
import {
  blankTraces,
  tracesFormOf,
  tracesKind,
  tracesLabel,
  tracesOptions,
  tracesProblems,
  tracesRequest,
} from "./connection-traces";
import { settingsOf } from "./connections";

const list = (withDefault: boolean): TelemetryAdapterList => ({
  adapters: [
    {
      kind: "clickstack",
      label: "ClickStack",
      description: "",
      key: "k",
      fields: [
        { key: "url", label: "ClickHouse 주소", type: "url", required: true },
        {
          key: "database",
          label: "데이터베이스",
          type: "text",
          default: "default",
          advanced: true,
        },
      ],
    },
    {
      kind: "langfuse",
      label: "Langfuse",
      description: "",
      key: "k",
      fields: [
        { key: "host", label: "Langfuse 주소", type: "url", required: true },
        { key: "publicKey", label: "공개 키", type: "text", required: true },
        { key: "secretKey", label: "비밀 키", type: "secret", required: true },
      ] as ConnectorField[],
    },
  ],
  ...(withDefault ? { serverDefault: { kind: "clickstack", name: "ClickStack" } } : {}),
});

describe("the choice of where traces pile up is a form of its own [REQ-079]", () => {
  test("none, each tool the server knows, and the server's default only when it has one", () => {
    expect(tracesOptions(list(false)).map((o) => o.label)).toEqual([
      "없음",
      "ClickStack",
      "Langfuse",
    ]);
    expect(tracesOptions(list(true)).map((o) => o.label)).toEqual([
      "없음",
      "ClickStack",
      "Langfuse",
      "서버 기본값 (ClickStack)",
    ]);
    expect(tracesOptions(undefined).map((o) => o.value)).toEqual(["none"]);
  });

  test("a new connection follows the server's default when there is one, else says none", () => {
    expect(blankTraces(list(true)).kind).toBe("default");
    expect(blankTraces(list(false)).kind).toBe("none");
    expect(blankTraces(undefined).kind).toBe("none");
  });

  test("choosing a tool starts its form at that tool's defaults", () => {
    expect(tracesKind(list(false), "clickstack")).toEqual({
      kind: "clickstack",
      values: { url: "", database: "default" },
      cleared: [],
    });
    expect(tracesKind(list(false), "none").values).toEqual({});
  });

  test("the request carries only the chosen tool's settings; none and default carry nothing", () => {
    const form = {
      kind: "langfuse",
      values: { host: "https://lf.test", publicKey: "pk", secretKey: "sk" },
      cleared: [],
    };
    expect(tracesRequest(list(false), form, settingsOf)).toEqual({
      kind: "langfuse",
      config: { host: "https://lf.test", publicKey: "pk", secretKey: "sk" },
    });
    expect(
      tracesRequest(list(true), { kind: "default", values: {}, cleared: [] }, settingsOf),
    ).toEqual({ kind: "default", config: {} });
    const removed = { ...form, values: { ...form.values, secretKey: "" }, cleared: ["secretKey"] };
    expect(tracesRequest(list(false), removed, settingsOf).config.secretKey).toBeNull();
  });

  test("what is missing is named under traces.<field>, and a saved secret counts", () => {
    const empty = { kind: "langfuse", values: {}, cleared: [] };
    expect(Object.keys(tracesProblems(list(false), empty, []))).toEqual([
      "traces.host",
      "traces.publicKey",
      "traces.secretKey",
    ]);
    expect(Object.keys(tracesProblems(list(false), empty, ["secretKey"]))).toEqual([
      "traces.host",
      "traces.publicKey",
    ]);
    expect(tracesProblems(list(false), { kind: "none", values: {}, cleared: [] }, [])).toEqual({});
  });

  test("a saved connection opens on its own choice, and says it in one line", () => {
    const traces = {
      kind: "langfuse",
      name: "Langfuse",
      config: { host: "https://lf.test", publicKey: "pk" },
      secrets: ["secretKey"],
    };
    expect(tracesFormOf(traces)).toEqual({
      kind: "langfuse",
      values: { host: "https://lf.test", publicKey: "pk" },
      cleared: [],
    });
    expect(tracesLabel(traces)).toBe("트레이스: Langfuse");
    expect(tracesLabel({ kind: "none", config: {}, secrets: [] })).toBe("트레이스: 쌓지 않아요");
  });
});
