import type { ConnectionView, ConnectorSpec } from "@terrarium/core/contract";
import { describe, expect, test } from "vitest";
import {
  blankForm,
  configOf,
  expiringNotice,
  expiryOf,
  formOf,
  formProblems,
  headersOf,
  metadataOf,
} from "./connections";

const spec: ConnectorSpec = {
  kind: "http-agent",
  label: "HTTP 에이전트",
  description: "주소로 부르는 에이전트",
  scope: "agent",
  toolTransport: "function-calling",
  fromScreen: true,
  toolGuide: ["에이전트에 도구 목록을 넘긴다"],
  fields: [
    { key: "url", label: "주소", type: "url", required: true },
    { key: "token", label: "토큰", type: "secret", required: true },
    { key: "timeoutSec", label: "제한 시간", type: "number", default: 60 },
    { key: "stream", label: "스트리밍", type: "boolean", default: false },
    { key: "models", label: "모델", type: "lines" },
    { key: "extra", label: "추가 설정", type: "json", advanced: true },
  ],
};

const view: ConnectionView = {
  id: "c1",
  name: "내 에이전트",
  description: "시험용",
  connector: "http-agent",
  scope: "agent",
  source: "screen",
  agents: [],
  metadata: { team: "dc-ops" },
  headers: [
    { name: "X-Team", secret: false, value: "dc" },
    { name: "X-Key", secret: true },
  ],
  secrets: ["token"],
  daysLeft: 20,
  status: "ok",
  config: {
    url: "https://agent.example.com",
    timeoutSec: 30,
    stream: true,
    models: ["a", "b"],
    extra: { k: 1 },
  },
} as unknown as ConnectionView;

describe("the connection form starts from the connector and reads back a connection [REQ-051]", () => {
  test("a new form has every field at its default and nothing else", () => {
    const form = blankForm(spec);
    expect(form.values).toEqual({
      url: "",
      token: "",
      timeoutSec: "60",
      stream: "false",
      models: "",
      extra: "",
    });
    expect(form.headers).toEqual([]);
    expect(form.metadata).toEqual([]);
  });

  test("an existing connection fills the form without its secrets, and a secret header is kept", () => {
    const form = formOf(spec, view);
    expect(form.name).toBe("내 에이전트");
    expect(form.values.token).toBe("");
    expect(form.values.models).toBe("a\nb");
    expect(form.values.stream).toBe("true");
    expect(JSON.parse(form.values.extra ?? "")).toEqual({ k: 1 });
    expect(form.headers[1]).toEqual({ name: "X-Key", value: "", secret: true, kept: true });
    expect(form.metadata).toEqual([{ key: "team", value: "dc-ops" }]);
  });
});

describe("what is sent when the form is saved [REQ-051]", () => {
  const typed = (over: Record<string, string> = {}, cleared: string[] = []) => ({
    ...formOf(spec, view),
    values: { ...formOf(spec, view).values, ...over },
    cleared,
  });

  test("values become what the field is: numbers, booleans, lists, JSON; empty ones are left out", () => {
    const sent = configOf(spec, typed({ models: "x\n\n y ", extra: "" }));
    expect(sent).toEqual({
      url: "https://agent.example.com",
      timeoutSec: 30,
      stream: true,
      models: ["x", "y"],
    });
  });

  test("a secret left blank is not sent (the server keeps it), a typed one is, a cleared one is null", () => {
    expect("token" in configOf(spec, typed())).toBe(false);
    expect(configOf(spec, typed({ token: "s3cret" })).token).toBe("s3cret");
    expect(configOf(spec, typed({}, ["token"])).token).toBeNull();
  });

  test("headers without a name are dropped and a kept secret header goes without a value", () => {
    expect(
      headersOf([
        { name: "X-Team", value: "dc", secret: false, kept: false },
        { name: " ", value: "x", secret: false, kept: false },
        { name: "X-Key", value: "", secret: true, kept: true },
        { name: "X-New", value: "v", secret: true, kept: false },
      ]),
    ).toEqual([
      { name: "X-Team", secret: false, value: "dc" },
      { name: "X-Key", secret: true },
      { name: "X-New", secret: true, value: "v" },
    ]);
  });

  test("metadata rows without a name are dropped and the rest are trimmed", () => {
    expect(
      metadataOf([
        { key: " team ", value: " dc-ops " },
        { key: "", value: "x" },
      ]),
    ).toEqual({ team: "dc-ops" });
  });
});

describe("the form says what is missing before anything is sent [REQ-051] [REQ-052]", () => {
  test("a new form lacks a name and the required fields; a kept secret counts as given", () => {
    const missing = formProblems(spec, blankForm(spec));
    expect(Object.keys(missing).sort()).toEqual(["name", "token", "url"]);
    const edit = formProblems(spec, formOf(spec, view), ["token"]);
    expect(edit).toEqual({});
    expect(formProblems(spec, { ...formOf(spec, view), cleared: ["token"] }, ["token"]).token).toBe(
      "토큰을(를) 적어 주세요",
    );
  });

  test("a number, JSON, a header value and a metadata name are checked", () => {
    const form = formOf(spec, view);
    const problems = formProblems(
      spec,
      {
        ...form,
        values: { ...form.values, timeoutSec: "abc", extra: "{oops" },
        headers: [{ name: "X-A", value: "", secret: false, kept: false }],
        metadata: [
          { key: "bad key!", value: "v" },
          { key: "ok", value: "" },
        ],
      },
      ["token"],
    );
    expect(problems.timeoutSec).toBe("숫자로 적어 주세요");
    expect(problems.extra).toBe("JSON 형식이 맞지 않아요");
    expect(problems["header.0"]).toBe("값을 적어 주세요");
    expect(problems["meta.0"]).toContain("40자");
    expect(problems["meta.1"]).toBe("값을 적어 주세요");
  });
});

describe("a connection that is not used is removed, and the screen says so ahead of time [REQ-051]", () => {
  test("only connections made on the screen expire, and the last week is a warning", () => {
    expect(expiryOf({ source: "config" }).state).toBe("none");
    expect(expiryOf({ source: "screen" }).state).toBe("none");
    expect(expiryOf({ source: "screen", daysLeft: 20 })).toEqual({
      state: "ok",
      label: "20일 뒤까지 안 쓰면 지워져요",
    });
    expect(expiryOf({ source: "screen", daysLeft: 3 })).toEqual({
      state: "soon",
      label: "안 쓰면 3일 뒤 지워져요",
    });
    expect(expiryOf({ source: "screen", daysLeft: 0 }).label).toBe("오늘 안에 지워져요");
  });

  test("the banner names the nearest one and counts the others", () => {
    expect(expiringNotice(undefined)).toBeUndefined();
    expect(expiringNotice([])).toBeUndefined();
    expect(expiringNotice([{ name: "A", daysLeft: 2 }])).toContain("'A' 연결이 2일 안에");
    expect(
      expiringNotice([
        { name: "A", daysLeft: 6 },
        { name: "B", daysLeft: 0 },
      ]),
    ).toContain("'B' 외 1개 연결이 오늘");
  });
});
