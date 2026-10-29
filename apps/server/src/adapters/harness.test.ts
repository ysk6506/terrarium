import type { AgentRunRequest, ToolEndpoint } from "@terrarium/core/experiments";
import { SCENARIO_TEMPLATES } from "@terrarium/core/scenario";
import { Session } from "@terrarium/core/session";
import { DEFAULT_TOOLSET } from "@terrarium/core/tools";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../../../packages/core/src/world/test-support/sample";
import { parseConfig } from "./config";
import { HttpHarness, traceIdOf } from "./harness/http";
import { OpenAiHarness, toolMessage } from "./harness/openai";
import { ScriptedHarness } from "./harness/scripted";
import { FakeFetch, json } from "./test-support/fake-fetch";

function session(templateId: string, seed = 1, tools = DEFAULT_TOOLSET) {
  const template = SCENARIO_TEMPLATES.find((t) => t.id === templateId);
  if (!template) throw new Error(templateId);
  const blueprint = sampleBlueprint();
  const s = Session.create({
    blueprint,
    scenario: template.build(new BlueprintIndex(blueprint), "sample"),
    tools,
    seed,
  });
  const task = s.start();
  return { s, task };
}

const endpoint = (s: Session, mcpUrl?: string): ToolEndpoint => ({
  specs: s.toolSpecs(),
  ...(mcpUrl ? { mcpUrl } : {}),
  call: async (name, args) => s.call(name, args),
});

function request(
  s: Session,
  agentId: string,
  extra: Partial<AgentRunRequest> = {},
): AgentRunRequest {
  return {
    runId: "r1",
    seed: 1,
    agentId,
    prompt: "조사하라",
    limits: { maxToolCalls: 40, timeLimitSeconds: 1800 },
    tools: endpoint(s),
    signal: new AbortController().signal,
    ...extra,
  };
}

describe("built-in reference agents use only the tools [REQ-008] [REQ-031]", () => {
  test.each(SCENARIO_TEMPLATES.map((t) => [t.id]))("triage diagnoses %s", async (id) => {
    const { s } = session(id);
    const outcome = await new ScriptedHarness("builtin", "내장").run(request(s, "triage"));
    expect(outcome.status).toBe("finished");
    const result = s.finish();
    expect(result.endReason).toBe("diagnosed");
    const facts = result.score.items.find((i) => i.kind === "diagnosis")?.facts;
    expect(facts, JSON.stringify(result.diagnosis)).toMatchObject({ root: true, type: true });
  });

  test("guess is repeatable for a seed; idle never answers; unknown agents are an error", async () => {
    const play = async (seed: number) => {
      const { s } = session("cooling-failure");
      await new ScriptedHarness("builtin", "내장").run(request(s, "guess", { seed }));
      return s.finish().diagnosis;
    };
    expect(await play(3)).toEqual(await play(3));
    const { s } = session("cooling-failure");
    const harness = new ScriptedHarness("builtin", "내장");
    expect(await harness.run(request(s, "idle"))).toEqual({
      status: "finished",
      message: "알람만 확인했다",
    });
    expect(s.finish().endReason).toBe("agent_finished");
    expect((await harness.run(request(s, "chef"))).status).toBe("error");
    expect((await harness.agents()).map((a) => a.id)).toEqual(["triage", "guess", "idle"]);
    expect(harness.info).toMatchObject({ kind: "scripted", toolTransport: "in-process" });
  });

  test("triage without get_impact still answers, from the alarms alone", async () => {
    const { s } = session("fan-failure-throttle", 1, ["list_alarms", "wait"]);
    await new ScriptedHarness("builtin", "내장").run(request(s, "triage"));
    expect(s.finish().diagnosis?.faultType).toBe("fan_failure");
  });
});

const openaiConfig = parseConfig({
  harnesses: [
    {
      kind: "openai",
      id: "llm",
      name: "사내 LLM",
      baseUrl: "https://llm.internal/v1",
      apiKeyEnv: "LLM_KEY",
      models: [{ id: "gauss", model: "gauss-2-32b", temperature: 0 }],
      maxTurns: 4,
    },
  ],
}).harnesses.find((h) => h.kind === "openai") as never;

const toolCall = (id: string, name: string, args: unknown) => ({
  id,
  type: "function",
  function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
});
const reply = (message: unknown, usage = { prompt_tokens: 100, completion_tokens: 20 }) =>
  json({ choices: [{ message }], usage });

describe("an OpenAI-compatible model as a harness [REQ-031]", () => {
  test("the model calls tools as functions until it submits; tokens are counted", async () => {
    const fake = new FakeFetch();
    const replies = [
      reply({
        role: "assistant",
        content: null,
        tool_calls: [toolCall("c1", "list_alarms", {}), toolCall("c2", "get_impact", "{bad")],
      }),
      reply({
        role: "assistant",
        content: null,
        tool_calls: [
          toolCall("c3", "submit_diagnosis", {
            rootCause: "crah-1",
            faultType: "cooling_unit_failure",
            summary: "정지",
          }),
        ],
      }),
    ];
    fake.on("POST", /\/v1\/chat\/completions$/, () => replies.shift() as Response);
    const { s } = session("cooling-failure");
    const harness = new OpenAiHarness(openaiConfig, "sk-test", fake.fetch);
    const outcome = await harness.run(
      request(s, "gauss", {
        traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
      }),
    );
    expect(outcome).toEqual({
      status: "finished",
      harness: { inputTokens: 200, outputTokens: 40 },
    });
    expect(s.finish().score.passed).toBe(true);
    const first = fake.requests[0];
    expect(first?.headers.authorization).toBe("Bearer sk-test");
    expect(first?.headers.traceparent).toContain("0af7651916cd43dd8448eb211c80319c");
    expect(first?.body).toMatchObject({
      model: "gauss-2-32b",
      temperature: 0,
      tool_choice: "auto",
    });
    const tools = (first?.body as { tools: { function: { name: string } }[] }).tools.map(
      (t) => t.function.name,
    );
    expect(tools).toContain("submit_diagnosis");
    const second = fake.requests[1]?.body as { messages: { role: string; content: string }[] };
    const toolReplies = second.messages
      .filter((m) => m.role === "tool")
      .map((m) => JSON.parse(m.content));
    expect(toolReplies[0]).toMatchObject({ ok: true });
    expect(toolReplies[1]).toEqual({ ok: false, error: "arguments are not valid JSON" });
    expect(await harness.agents()).toEqual([
      { id: "gauss", name: "gauss-2-32b", model: "gauss-2-32b" },
    ]);
  });

  test("a model that stops talking, runs out of turns, or errors is reported as such", async () => {
    const chatty = new FakeFetch().on("POST", /chat/, () =>
      reply({ role: "assistant", content: "모르겠다" }),
    );
    const { s } = session("cooling-failure");
    expect(
      await new OpenAiHarness(openaiConfig, undefined, chatty.fetch).run(request(s, "gauss")),
    ).toMatchObject({
      status: "finished",
      message: "모델이 툴 호출 없이 답을 끝냈다",
    });
    expect(chatty.requests[0]?.headers.authorization).toBeUndefined();

    const looping = new FakeFetch().on("POST", /chat/, () =>
      reply({ role: "assistant", content: null, tool_calls: [toolCall("c", "list_alarms", {})] }),
    );
    const out = await new OpenAiHarness(openaiConfig, undefined, looping.fetch).run(
      request(session("cooling-failure").s, "gauss"),
    );
    expect(out).toMatchObject({ status: "finished", message: "4턴 안에 끝내지 못했다" });
    expect(looping.requests).toHaveLength(4);

    const broken = new FakeFetch().on(
      "POST",
      /chat/,
      () => new Response("overloaded", { status: 503 }),
    );
    const failed = await new OpenAiHarness(openaiConfig, undefined, broken.fetch).run(
      request(session("cooling-failure").s, "gauss"),
    );
    expect(failed).toMatchObject({
      status: "error",
      message: "모델 엔드포인트가 503로 답했다: overloaded",
    });

    const empty = new FakeFetch().on("POST", /chat/, () => json({ choices: [] }));
    expect(
      (
        await new OpenAiHarness(openaiConfig, undefined, empty.fetch).run(
          request(session("cooling-failure").s, "gauss"),
        )
      ).message,
    ).toBe("모델이 빈 응답을 보냈다");
    const unknown = await new OpenAiHarness(openaiConfig, undefined, empty.fetch).run(
      request(session("cooling-failure").s, "nope"),
    );
    expect(unknown.message).toBe("'nope' 모델이 설정에 없다");
  });

  test("cancelling stops the loop", async () => {
    const controller = new AbortController();
    controller.abort();
    const fake = new FakeFetch();
    const out = await new OpenAiHarness(openaiConfig, undefined, fake.fetch).run(
      request(session("cooling-failure").s, "gauss", { signal: controller.signal }),
    );
    expect(out.status).toBe("cancelled");
    expect(fake.requests).toHaveLength(0);
  });

  test("tool replies are JSON the model can read, cut when huge", () => {
    expect(toolMessage({ ok: true, data: [1] })).toBe('{"ok":true,"data":[1]}');
    expect(toolMessage({ ok: false, error: "없다" })).toBe('{"ok":false,"error":"없다"}');
    expect(toolMessage({ ok: true, data: "x".repeat(70_000) }).endsWith("… (truncated)")).toBe(
      true,
    );
  });
});

const httpConfig = parseConfig({
  harnesses: [
    {
      kind: "http",
      id: "remote",
      name: "원격 하네스",
      url: "https://harness.internal/",
      pollSeconds: 0.05,
    },
  ],
}).harnesses.find((h) => h.kind === "http") as never;

describe("a remote harness over the Terrarium harness protocol [REQ-031]", () => {
  const traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

  test("start, poll until finished, and keep what the harness reported", async () => {
    const polls = ["running", "running", "finished"];
    const fake = new FakeFetch()
      .on("GET", /\/agents$/, () => json({ agents: [{ id: "a1", name: "에이전트" }, { id: 3 }] }))
      .on("POST", /\/runs$/, () => json({ accepted: true }, 202))
      .on("GET", /\/runs\/r1$/, () =>
        json({
          status: polls.shift(),
          usage: { inputTokens: 900, outputTokens: 80, costUsd: 0.01 },
          wallSeconds: 12,
        }),
      );
    const harness = new HttpHarness(httpConfig, "tok", fake.fetch);
    expect(await harness.agents()).toEqual([{ id: "a1", name: "에이전트" }]);
    const { s } = session("cooling-failure");
    const out = await harness.run(
      request(s, "a1", { traceparent, tools: endpoint(s, "https://terrarium/mcp/runs/r1/t") }),
    );
    expect(out).toEqual({
      status: "finished",
      harness: {
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        inputTokens: 900,
        outputTokens: 80,
        costUsd: 0.01,
        wallSeconds: 12,
      },
    });
    const start = fake.requests.find((r) => r.method === "POST");
    expect(start?.url).toBe("https://harness.internal/runs");
    expect(start?.headers.authorization).toBe("Bearer tok");
    expect(start?.body).toMatchObject({
      protocol: "terrarium.harness/1",
      runId: "r1",
      agentId: "a1",
      seed: 1,
      traceparent,
      tools: { mcpUrl: "https://terrarium/mcp/runs/r1/t" },
    });
  });

  test("refusals, unreachable harnesses and missing MCP endpoints are errors with reasons", async () => {
    const { s } = session("cooling-failure");
    const harness = (fake: FakeFetch) => new HttpHarness(httpConfig, undefined, fake.fetch);
    const noMcp = await harness(new FakeFetch()).run(request(s, "a1"));
    expect(noMcp.message).toBe("이 하네스는 MCP로 툴을 쓰는데, 이 실행에 MCP 엔드포인트가 없다");
    const tools = endpoint(s, "https://terrarium/mcp/runs/r1/t");
    const refused = new FakeFetch().on(
      "POST",
      /\/runs$/,
      () => new Response("busy", { status: 429 }),
    );
    expect((await harness(refused).run(request(s, "a1", { tools }))).message).toBe(
      "하네스가 실행 시작에 429로 답했다: busy",
    );
    const down = new FakeFetch().on("POST", /\/runs$/, () => {
      throw new TypeError("fetch failed");
    });
    expect((await harness(down).run(request(s, "a1", { tools }))).message).toBe(
      "하네스에 닿을 수 없다: fetch failed",
    );
    const flaky = new FakeFetch()
      .on("POST", /\/runs$/, () => json({}))
      .on("GET", /\/runs\//, () => new Response("", { status: 500 }));
    expect(await harness(flaky).run(request(s, "a1", { tools }))).toMatchObject({
      status: "error",
      message: "하네스에 닿을 수 없다: 상태 조회에 500",
    });
    const noAgents = new FakeFetch().on(
      "GET",
      /\/agents$/,
      () => new Response("", { status: 401 }),
    );
    await expect(harness(noAgents).agents()).rejects.toThrow(
      "하네스가 에이전트 목록에 401로 답했다",
    );
  });

  test("cancelling asks the harness to stop and keeps its last report", async () => {
    const controller = new AbortController();
    const fake = new FakeFetch()
      .on("POST", /\/runs$/, () => json({}))
      .on("GET", /\/runs\/r1$/, () => {
        controller.abort();
        return json({ status: "running", usage: { inputTokens: 5 } });
      })
      .on("DELETE", /\/runs\/r1$/, () => new Response(null, { status: 204 }));
    const { s } = session("cooling-failure");
    const out = await new HttpHarness(httpConfig, undefined, fake.fetch).run(
      request(s, "a1", { signal: controller.signal, tools: endpoint(s, "https://t/mcp") }),
    );
    expect(out).toEqual({ status: "cancelled", harness: { inputTokens: 5 } });
    expect(fake.requests.map((r) => r.method)).toContain("DELETE");
    expect(traceIdOf(undefined)).toBeUndefined();
  });
});
