import type { InvalidInputError } from "@terrarium/core/contract";
import { MemoryStore } from "@terrarium/core/experiments";
import { describe, expect, test } from "vitest";
import { SecretBox } from "../adapters";
import { FakeFetch, json } from "../adapters/test-support/fake-fetch";
import {
  JIMIN,
  recipe,
  ScriptHarness,
  seed,
  settled,
  testPlatform,
  YEONSU,
} from "./test-support/platform";

const GENERATION = {
  id: "o1",
  traceId: "t1",
  type: "GENERATION",
  name: "chat",
  startTime: "2026-11-05T09:00:00.000Z",
  endTime: "2026-11-05T09:00:02.000Z",
  model: "gauss-2",
  inputUsage: 700,
  outputUsage: 50,
};

const LANGFUSE = { host: "http://lf.test", publicKey: "pk-1", secretKey: "sk-typed-secret" };
const goclaw = { connector: "goclaw", name: "사내 GoClaw", config: { url: "http://goclaw.test" } };

/** A GoClaw gateway that answers chat, and a Langfuse that shows spans for the run once `traced` is true. */
function world(opts: { traced?: boolean; chat?: () => Response } = {}) {
  const fake = new FakeFetch()
    .on("GET", /^\/v1\/agents$/, () =>
      json({ agents: [{ id: "u1", agent_key: "ops", display_name: "운영", status: "active" }] }),
    )
    .on("POST", /^\/v1\/chat\/completions$/, () =>
      opts.chat
        ? opts.chat()
        : json({ model: "qwen3", choices: [{ message: { content: "안녕하세요" } }] }),
    )
    .on("GET", /^\/api\/public\/v2\/observations$/, () =>
      json({ data: opts.traced ? [GENERATION] : [], meta: {} }),
    );
  const built = testPlatform(
    [],
    {
      adapters: { connect: { env: {}, fetch: fake.fetch }, secretBox: SecretBox.ephemeral() },
      tryOptions: { looks: 2, lookGapMs: 0 },
    },
    new MemoryStore(),
  );
  return { ...built, fake };
}

const traces = { kind: "langfuse", config: LANGFUSE };

describe("where a connection's traces pile up is chosen per connection [REQ-079]", () => {
  test("the choice is saved with its key sealed, shown without it, and used to read", async () => {
    const { platform, fake } = world({ traced: true });
    const view = await platform.connections.create(YEONSU, { ...goclaw, traces });
    expect(view.traces).toEqual({
      kind: "langfuse",
      name: "Langfuse",
      config: { host: "http://lf.test", publicKey: "pk-1" },
      secrets: ["secretKey"],
    });
    expect(JSON.stringify(view)).not.toContain("sk-typed-secret");
    const stored = await platform.connections.talk(YEONSU, view.id, {
      agentId: "ops",
      text: "안녕",
    });
    expect(stored.trace).toMatchObject({ name: "Langfuse", linked: true, spans: 1 });
    const read = fake.requests.find((r) => r.url.includes("/api/public/v2/observations"));
    expect(read?.headers.authorization).toBe(
      `Basic ${Buffer.from("pk-1:sk-typed-secret").toString("base64")}`,
    );
  });

  test("changing a connection keeps the key unless a new one is typed; leaving traces out keeps the choice", async () => {
    const { platform, fake } = world({ traced: true });
    const view = await platform.connections.create(YEONSU, { ...goclaw, traces });
    await platform.connections.update(YEONSU, view.id, { config: goclaw.config });
    expect((await platform.connections.views()).find((v) => v.id === view.id)?.traces.kind).toBe(
      "langfuse",
    );
    await platform.connections.update(YEONSU, view.id, {
      config: goclaw.config,
      traces: {
        kind: "langfuse",
        config: { host: "http://lf.test", publicKey: "pk-2", secretKey: "" },
      },
    });
    await platform.connections.talk(YEONSU, view.id, { agentId: "ops", text: "안녕" });
    const read = fake.requests.findLast((r) => r.url.includes("/observations"));
    expect(read?.headers.authorization).toBe(
      `Basic ${Buffer.from("pk-2:sk-typed-secret").toString("base64")}`,
    );
    const none = await platform.connections.update(YEONSU, view.id, {
      config: goclaw.config,
      traces: { kind: "none", config: {} },
    });
    expect(none.traces).toEqual({ kind: "none", config: {}, secrets: [] });
  });

  test("a wrong choice is refused at the field that is wrong", async () => {
    const { platform } = world();
    const bad = async (t: object) =>
      platform.connections
        .create(YEONSU, { ...goclaw, traces: t as never })
        .catch((e: InvalidInputError) => e.issues);
    expect(await bad({ kind: "grafana", config: {} })).toEqual([
      { path: "traces.kind", message: "트레이스를 쌓는 곳 'grafana'을 몰라요" },
    ]);
    expect(
      await bad({ kind: "langfuse", config: { host: "not a url", publicKey: "pk" } }),
    ).toMatchObject([{ path: "traces.host" }]);
    expect(
      await bad({
        kind: "langfuse",
        config: { host: "http://lf.test", publicKey: "pk", secretKey: "a", secretKeyEnv: "X" },
      }),
    ).toMatchObject([{ path: "traces.secretKeyEnv" }]);
  });

  test("checking a connection also says when the tool for its traces does not answer", async () => {
    const down = new FakeFetch()
      .on("GET", /^\/v1\/agents$/, () => json({ agents: [{ agent_key: "ops", status: "active" }] }))
      .on("GET", /observations$/, () => new Response("no key", { status: 401 }));
    const p = testPlatform([], { adapters: { connect: { env: {}, fetch: down.fetch } } }).platform;
    const check = await p.connections.check(YEONSU, {
      connector: "goclaw",
      config: goclaw.config,
      traces,
    });
    expect(check.ok).toBe(true);
    expect(check.notes.join(" ")).toContain("Langfuse에 연결하지 못했어요");
    expect(check.canTalk).toBe(true);
  });
});

describe("말 걸어 보기: one question, no tools, and whether the traces came along [REQ-079]", () => {
  test("the answer, how long it took, no tool calls, and traces that arrived", async () => {
    const { platform, fake } = world({ traced: true });
    const view = await platform.connections.create(YEONSU, { ...goclaw, traces });
    const r = await platform.connections.talk(YEONSU, view.id, {
      agentId: "ops",
      text: "무엇을 할 수 있나요",
    });
    expect(r).toMatchObject({
      ok: true,
      text: "안녕하세요",
      model: "qwen3",
      toolCalls: 0,
      trace: { name: "Langfuse", linked: true, spans: 1 },
    });
    expect(r.ms).toBeGreaterThanOrEqual(0);
    const chat = fake.requests.find((q) => q.url.endsWith("/v1/chat/completions"));
    expect(chat?.body).toMatchObject({
      model: "goclaw:ops",
      messages: [{ role: "user", content: "무엇을 할 수 있나요" }],
    });
    const runId = String(chat?.headers["x-terrarium-run-id"]);
    expect(runId).toMatch(/^try-/);
    expect(chat?.headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    const read = fake.requests.find((q) => q.url.includes("/observations"));
    expect(new URL(read?.url as string).searchParams.get("sessionId")).toBe(runId);
  });

  test("traces that do not come say so, and what to look at", async () => {
    const { platform } = world({ traced: false });
    const view = await platform.connections.create(YEONSU, { ...goclaw, traces });
    const r = await platform.connections.talk(YEONSU, view.id, { agentId: "ops", text: "안녕" });
    expect(r.ok).toBe(true);
    expect(r.trace).toMatchObject({ name: "Langfuse", linked: false, spans: 0 });
    expect(r.trace.note).toContain("run_id 태그가 안 보여요");
  });

  test("a connection with no place for traces has nothing to check", async () => {
    const { platform } = world();
    const view = await platform.connections.create(YEONSU, {
      ...goclaw,
      traces: { kind: "none", config: {} },
    });
    const r = await platform.connections.talk(YEONSU, view.id, { agentId: "ops", text: "안녕" });
    expect(r.trace).toEqual({ spans: 0 });
  });

  test("a refusal is told with its status and what to do, not as a bare failure", async () => {
    const { platform } = world({ chat: () => new Response("invalid token", { status: 401 }) });
    const view = await platform.connections.create(YEONSU, goclaw);
    const r = await platform.connections.talk(YEONSU, view.id, { agentId: "ops", text: "안녕" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(
      "401 — 토큰이 거절됐어요. 받은 말: 채팅 요청에 401로 답했어요: invalid token",
    );
  });

  test("a connection that cannot talk says so instead of failing", async () => {
    const { platform } = world();
    const r = await platform.connections.talk(YEONSU, "builtin", {
      agentId: "triage",
      text: "안녕",
    });
    expect(r).toMatchObject({ ok: false, error: "이 연결 방식은 아직 말 걸어 보기를 못 해요" });
    const [builtin] = await platform.connections.views();
    expect(builtin?.canTalk).toBe(false);
  });
});

describe("a run carries what its connection's telemetry asks, and is read back from there [REQ-079]", () => {
  const play = async (req: { tools: { call: (n: string, a: object) => Promise<unknown> } }) => {
    await req.tools.call("submit_diagnosis", {
      rootCause: "x",
      faultType: "cooling_unit_failure",
      summary: "s",
    });
    return { status: "finished" as const };
  };

  function setup(tracesOf: object | undefined, defaultPort = true) {
    const fake = new FakeFetch().on("GET", /^\/api\/public\/v2\/observations$/, () =>
      json({ data: [GENERATION], meta: {} }),
    );
    const traced = new ScriptHarness("traced", play as never);
    const built = testPlatform(
      [traced],
      {
        adapters: {
          connect: { env: {}, fetch: fake.fetch },
          harnessConfigs: [
            { kind: "test", id: "traced", name: "t", ...(tracesOf ? { traces: tracesOf } : {}) },
          ],
          ...(defaultPort
            ? {
                telemetry: {
                  port: { trace: async () => ({ spans: [], logs: [], metrics: [] }) },
                  name: "ClickStack",
                },
              }
            : {}),
        },
      },
      new MemoryStore(),
    );
    return { ...built, traced, fake };
  }

  test("with Langfuse chosen, the harness gets the run's name and the page reads Langfuse", async () => {
    const { platform, traced, fake, store } = setup({
      kind: "langfuse",
      config: { host: "http://lf.test", publicKey: "pk" },
    });
    const { world: w, scenario } = await seed(platform);
    const e = await platform.experiments.create(YEONSU, {
      name: "추적",
      recipe: recipe(w.id, scenario.id, { harnessId: "traced", agentId: "a", runs: 1 }),
    });
    const done = await settled(platform, YEONSU, e.experiment.id);
    const run = done.runs[0];
    const sent = traced.requests[0];
    expect(sent?.telemetry?.tags).toMatchObject({ run_id: run?.id });
    expect(sent?.telemetry?.sessionId).toBe(run?.id);
    expect(sent?.traceparent).toBe(sent?.telemetry?.traceparent);
    expect((await store.getRun(run?.id as string))?.harness?.traceId).toBe(
      sent?.traceparent?.split("-")[1],
    );
    const view = await platform.results.run(run?.id as string);
    expect(view).toMatchObject({ hasTelemetry: true, telemetryName: "Langfuse" });
    expect(view.analysis.efficiency).toMatchObject({ inputTokens: 700, llmCalls: 1 });
    const raw = await platform.results.telemetry(run?.id as string);
    expect(raw.spans).toHaveLength(1);
    const asked = new URL(fake.requests.find((r) => r.url.includes("observations"))?.url as string);
    expect(asked.searchParams.get("sessionId")).toBe(run?.id);
  });

  test("with none chosen, the server's default is not used even for a harness that says it emits traces", async () => {
    const { platform, traced } = setup({ kind: "none" });
    const { world: w, scenario } = await seed(platform);
    const e = await platform.experiments.create(YEONSU, {
      name: "없음",
      recipe: recipe(w.id, scenario.id, { harnessId: "traced", agentId: "a", runs: 1 }),
    });
    const done = await settled(platform, YEONSU, e.experiment.id);
    expect(traced.requests[0]?.telemetry).toBeUndefined();
    expect((await platform.results.run(done.runs[0]?.id as string)).hasTelemetry).toBe(false);
  });

  test("with default chosen, the server's own telemetry is the tool", async () => {
    const { platform, traced } = setup({ kind: "default" });
    const { world: w, scenario } = await seed(platform);
    const e = await platform.experiments.create(YEONSU, {
      name: "기본",
      recipe: recipe(w.id, scenario.id, { harnessId: "traced", agentId: "a", runs: 1 }),
    });
    const done = await settled(platform, YEONSU, e.experiment.id);
    expect(traced.requests[0]?.telemetry?.tags.run_id).toBe(done.runs[0]?.id);
    expect(await platform.results.run(done.runs[0]?.id as string)).toMatchObject({
      hasTelemetry: true,
      telemetryName: "ClickStack",
    });
  });

  test("the config file can name the tool for a harness, and a wrong one is refused", async () => {
    const { parseConfig } = await import("../adapters");
    const ok = parseConfig({
      harnesses: [
        {
          kind: "http",
          id: "h",
          url: "http://h.test",
          name: "h",
          traces: { kind: "langfuse", host: "http://lf.test", publicKey: "pk" },
        },
      ],
    });
    expect(ok.harnesses.find((h) => h.id === "h")?.traces).toEqual({
      kind: "langfuse",
      config: { host: "http://lf.test", publicKey: "pk" },
    });
    expect(() =>
      parseConfig({
        harnesses: [
          { kind: "http", id: "h", url: "http://h.test", name: "h", traces: { kind: "grafana" } },
        ],
      }),
    ).toThrow("종류는 'none', 'default', 'clickstack', 'langfuse' 중 하나여야 해요");
    expect(() =>
      parseConfig({
        harnesses: [
          {
            kind: "http",
            id: "h",
            url: "http://h.test",
            name: "h",
            traces: { kind: "langfuse", host: "x" },
          },
        ],
      }),
    ).toThrow();
  });
});

describe("strangers may talk but not choose [REQ-079]", () => {
  test("anyone can talk to a connection; only its owner changes where its traces go", async () => {
    const { platform } = world({ traced: true });
    const view = await platform.connections.create(YEONSU, { ...goclaw, traces });
    expect(
      (await platform.connections.talk(YEONSU, view.id, { agentId: "ops", text: "안녕" })).ok,
    ).toBe(true);
    await expect(
      platform.connections.update(JIMIN, view.id, {
        config: goclaw.config,
        traces: { kind: "none", config: {} },
      }),
    ).rejects.toThrow("만든 사람");
  });
});
