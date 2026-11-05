import { describe, expect, test } from "vitest";
import { FakeFetch, json } from "../test-support/fake-fetch";
import { fakeTools, runRequest } from "../test-support/run-request";
import { openClawConnector } from "./openclaw";

const config = { kind: "openclaw", id: "oclaw", name: "OpenClaw", url: "http://claw.test:18789" };

function connect(fake: FakeFetch, extra: Record<string, unknown> = {}, env = {}) {
  const parsed = openClawConnector.schema.parse({ ...config, ...extra });
  return openClawConnector.connect(parsed, { env, fetch: fake.fetch });
}

const toolCall = (name: string, args: string, id = "call-1") => ({
  id,
  type: "function" as const,
  function: { name, arguments: args },
});
const answer = (message: object, usage = { prompt_tokens: 100, completion_tokens: 10 }) =>
  json({ model: "openclaw/main", choices: [{ message }], usage });

describe("an OpenClaw gateway: its agents are the targets of the chat endpoint [REQ-051]", () => {
  test("agents are the openclaw/<id> targets the gateway lists", async () => {
    const fake = new FakeFetch().on("GET", /^\/v1\/models$/, () =>
      json({
        data: [
          { id: "openclaw" },
          { id: "openclaw/default" },
          { id: "openclaw/ops" },
          { id: "gpt-x" },
          {},
        ],
      }),
    );
    expect(await connect(fake, { tokenEnv: "CLAW" }, { CLAW: "tk" }).agents()).toEqual([
      { id: "default", name: "기본 에이전트", description: "게이트웨이에 정해진 기본 에이전트." },
      { id: "ops", name: "ops" },
    ]);
    expect(fake.requests[0]?.headers.authorization).toBe("Bearer tk");
    expect(
      await connect(new FakeFetch().on("GET", /^\/v1\/models$/, () => json({}))).agents(),
    ).toEqual([]);
  });

  test("the agent asks for tools, Terrarium runs them, and the answer goes back until the diagnosis is in", async () => {
    const replies = [
      answer({
        role: "assistant",
        content: null,
        tool_calls: [toolCall("get_entity", '{"id":"srv-1"}')],
      }),
      answer(
        {
          role: "assistant",
          content: null,
          tool_calls: [toolCall("submit_diagnosis", '{"cause":"fan"}', "call-2")],
        },
        { prompt_tokens: 300, completion_tokens: 20 },
      ),
    ];
    const fake = new FakeFetch().on(
      "POST",
      /^\/v1\/chat\/completions$/,
      () => replies.shift() as Response,
    );
    const tools = fakeTools((name) =>
      name === "submit_diagnosis"
        ? { ok: true, data: "받았어요", ended: "submitted" }
        : { ok: true, data: { power: "on" } },
    );
    const out = await connect(fake).run(
      runRequest({ agentId: "ops", tools: tools.endpoint, traceparent: "00-t-s-01" }),
    );
    expect(out).toEqual({
      status: "finished",
      harness: { inputTokens: 400, outputTokens: 30, model: "openclaw/main" },
    });
    expect(tools.calls).toEqual([
      { name: "get_entity", args: { id: "srv-1" } },
      { name: "submit_diagnosis", args: { cause: "fan" } },
    ]);
    const first = fake.requests[0];
    expect(first?.headers.traceparent).toBe("00-t-s-01");
    expect(first?.body).toMatchObject({
      model: "openclaw/ops",
      tool_choice: "auto",
      messages: [{ role: "system" }, { role: "user", content: '서버 "A"를 조사하라' }],
    });
    const names = (first?.body as { tools: Array<{ function: { name: string } }> }).tools.map(
      (t) => t.function.name,
    );
    expect(names).toEqual(["get_entity", "submit_diagnosis"]);
    const second = fake.requests[1]?.body as {
      messages: Array<{ role: string; content: string | null }>;
    };
    expect(second.messages.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "call-1",
      content: '{"ok":true,"data":{"power":"on"}}',
    });
  });

  test("tool results that are errors, bad arguments and huge results are all handed back in words", async () => {
    const replies = [
      answer({
        role: "assistant",
        content: null,
        tool_calls: [
          toolCall("get_entity", "{oops", "c1"),
          toolCall("get_entity", "[1]", "c2"),
          toolCall("get_entity", "", "c3"),
          toolCall("get_entity", '{"id":"big"}', "c4"),
        ],
      }),
      answer({ role: "assistant", content: "끝" }),
    ];
    const fake = new FakeFetch().on(
      "POST",
      /^\/v1\/chat\/completions$/,
      () => replies.shift() as Response,
    );
    const tools = fakeTools((_, args) =>
      args.id === "big" ? { ok: true, data: "x".repeat(70_000) } : { ok: false, error: "없어요" },
    );
    const out = await connect(fake).run(runRequest({ tools: tools.endpoint }));
    expect(out).toMatchObject({
      status: "finished",
      message: "에이전트가 툴 호출 없이 답을 끝냈어요",
    });
    const sent = (
      fake.requests[1]?.body as { messages: Array<{ role: string; content: string }> }
    ).messages.filter((m) => m.role === "tool");
    expect(sent[0]?.content).toBe('{"ok":false,"error":"arguments are not valid JSON"}');
    expect(sent[1]?.content).toBe('{"ok":false,"error":"arguments must be a JSON object"}');
    expect(sent[2]?.content).toBe('{"ok":false,"error":"없어요"}');
    expect(sent[3]?.content.endsWith("… (truncated)")).toBe(true);
    expect(tools.calls).toHaveLength(2);
  });

  test("a gateway that refuses, answers with nothing or is out of turns ends the run with a reason", async () => {
    const refusing = new FakeFetch().on(
      "POST",
      /^\/v1\/chat\/completions$/,
      () => new Response("off", { status: 404 }),
    );
    expect((await connect(refusing).run(runRequest())).message).toBe(
      "채팅 요청에 404로 답했어요: off",
    );
    const empty = new FakeFetch().on("POST", /^\/v1\/chat\/completions$/, () =>
      json({ choices: [] }),
    );
    expect((await connect(empty).run(runRequest())).message).toBe(
      "게이트웨이가 빈 응답을 보냈어요",
    );
    const forever = new FakeFetch().on("POST", /^\/v1\/chat\/completions$/, () =>
      answer({ role: "assistant", content: null, tool_calls: [toolCall("get_entity", "{}")] }),
    );
    const out = await connect(forever, { maxTurns: 2 }).run(runRequest());
    expect(out).toMatchObject({ status: "finished", message: "2턴 안에 끝내지 못했어요" });
    expect(forever.requests).toHaveLength(2);
  });

  test("stopping a run stops waiting for the gateway", async () => {
    const slow = new FakeFetch().on(
      "POST",
      /^\/v1\/chat\/completions$/,
      () => new Promise<Response>(() => undefined),
    );
    const stop = new AbortController();
    const done = connect(slow).run(runRequest({ signal: stop.signal }));
    stop.abort();
    expect(await done).toMatchObject({ status: "cancelled" });
    const before = new AbortController();
    before.abort();
    expect(await connect(slow).run(runRequest({ signal: before.signal }))).toMatchObject({
      status: "cancelled",
    });
  });

  test("it hands tools over as functions, and says the endpoint must be switched on", () => {
    expect(openClawConnector.spec).toMatchObject({
      toolTransport: "function-calling",
      scope: "harness",
    });
    expect(openClawConnector.spec.description).toContain("기본은 꺼짐");
  });
});
