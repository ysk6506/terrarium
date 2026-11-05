import { describe, expect, test } from "vitest";
import { FakeFetch, json } from "../test-support/fake-fetch";
import { fakeTools, runRequest } from "../test-support/run-request";
import { openCodeConnector } from "./opencode";

const config = {
  kind: "opencode",
  id: "oc",
  name: "OpenCode",
  url: "http://oc.test:4096",
  pollSeconds: 0.05,
};

function connect(fake: FakeFetch, extra: Record<string, unknown> = {}, env = {}) {
  const parsed = openCodeConnector.schema.parse({ ...config, ...extra });
  return openCodeConnector.connect(parsed, { env, fetch: fake.fetch });
}

const reply = (text: string, extra: object = {}) => ({
  info: {
    role: "assistant",
    providerID: "anthropic",
    modelID: "claude-x",
    cost: 0.02,
    tokens: { input: 1200, output: 90 },
    ...extra,
  },
  parts: [{ type: "text", text }],
});

/** A server whose session is busy for the given polls and then idle. */
function server(busyPolls: number, messages: unknown[]) {
  let polls = 0;
  return new FakeFetch()
    .on("POST", /^\/mcp$/, () => json({}))
    .on("POST", /^\/session$/, () => json({ id: "ses-1" }))
    .on("POST", /\/prompt_async$/, () => new Response(null, { status: 204 }))
    .on("GET", /^\/session\/status$/, () =>
      json(++polls <= busyPolls ? { "ses-1": { type: "busy" } } : {}),
    )
    .on("GET", /^\/session\/ses-1\/message$/, () => json(messages))
    .on("POST", /\/abort$/, () => json(true));
}

describe("an OpenCode server: its agents are the agents [REQ-051]", () => {
  test("agents that only other agents call are left out, and the mode is kept as a fact", async () => {
    const fake = new FakeFetch().on("GET", /^\/agent$/, () =>
      json([
        { name: "build", description: "코드를 짜요", mode: "primary" },
        { name: "explore", mode: "subagent" },
        { name: "plan" },
        { description: "이름 없음" },
      ]),
    );
    expect(await connect(fake, { model: "anthropic/claude-x" }).agents()).toEqual([
      {
        id: "build",
        name: "build",
        description: "코드를 짜요",
        model: "anthropic/claude-x",
        facts: { mode: "primary" },
      },
      { id: "plan", name: "plan", model: "anthropic/claude-x" },
    ]);
  });

  test("the password is sent as basic auth from a variable the server has", async () => {
    const fake = new FakeFetch().on("GET", /^\/agent$/, () => json([]));
    await connect(fake, { passwordEnv: "OC_PASS", username: "ci" }, { OC_PASS: "pw" }).agents();
    const header = fake.requests[0]?.headers.authorization ?? "";
    expect(Buffer.from(header.replace("Basic ", ""), "base64").toString()).toBe("ci:pw");
    const open = new FakeFetch().on("GET", /^\/agent$/, () => json([]));
    await connect(open).agents();
    expect(open.requests[0]?.headers.authorization).toBeUndefined();
  });

  test("a run adds the run's tools as an MCP server, gives the session the task and reads the answer", async () => {
    const fake = server(2, [{ info: { role: "user" }, parts: [] }, reply("원인은 냉각기")]);
    const out = await connect(fake, { model: "anthropic/claude-x" }).run(runRequest());
    expect(out).toMatchObject({
      status: "finished",
      message: "원인은 냉각기",
      harness: { inputTokens: 1200, outputTokens: 90, costUsd: 0.02, model: "anthropic/claude-x" },
    });
    const bodies = fake.requests.map((r) => [r.method, new URL(r.url).pathname, r.body] as const);
    expect(bodies[0]).toEqual([
      "POST",
      "/mcp",
      {
        name: "terrarium-r1",
        config: { type: "remote", url: "https://terrarium.test/mcp/runs/r1/tok", enabled: true },
      },
    ]);
    expect(bodies[1]).toEqual(["POST", "/session", { title: "terrarium r1" }]);
    expect(bodies[2]).toEqual([
      "POST",
      "/session/ses-1/prompt_async",
      {
        agent: "agent-1",
        model: { providerID: "anthropic", modelID: "claude-x" },
        parts: [{ type: "text", text: '서버 "A"를 조사하라' }],
      },
    ]);
  });

  test("a session that is idle at once is given a few polls before it counts as done", async () => {
    const fake = server(0, [reply("바로 끝")]);
    const out = await connect(fake).run(runRequest());
    expect(out).toMatchObject({ status: "finished", message: "바로 끝" });
    expect(fake.requests.filter((r) => r.url.endsWith("/session/status"))).toHaveLength(3);
  });

  test("an agent that stopped on an error says why", async () => {
    const fake = server(1, [
      reply("", { error: { name: "ProviderAuthError", data: { message: "키가 틀렸어요" } } }),
    ]);
    expect(await connect(fake).run(runRequest())).toMatchObject({
      status: "error",
      message: "OpenCode 에이전트가 오류로 멈췄어요: 키가 틀렸어요",
    });
    const unnamed = server(1, [reply("", { error: {} })]);
    expect((await connect(unnamed).run(runRequest())).message).toBe(
      "OpenCode 에이전트가 오류로 멈췄어요: 이유 모름",
    );
  });

  test("no tools address, an unreachable server and unreadable statuses are errors with reasons", async () => {
    const noMcp = await connect(server(1, [])).run(
      runRequest({ tools: fakeTools(undefined, null).endpoint }),
    );
    expect(noMcp.message).toBe("이 실행에는 MCP 엔드포인트가 없어요");
    const down = new FakeFetch().on("POST", /^\/mcp$/, () => {
      throw new TypeError("fetch failed");
    });
    expect((await connect(down).run(runRequest())).message).toBe(
      "OpenCode 서버에 연결하지 못했어요: fetch failed",
    );
    const flaky = new FakeFetch()
      .on("POST", /^\/mcp$/, () => json({}))
      .on("POST", /^\/session$/, () => json({ id: "ses-1" }))
      .on("POST", /\/prompt_async$/, () => new Response(null, { status: 204 }))
      .on("GET", /^\/session\/status$/, () => new Response("", { status: 500 }));
    const out = await connect(flaky).run(runRequest());
    expect(out.message).toContain("세션 상태를 5번 연달아 못 읽었어요");
  });

  test("stopping a run aborts the session", async () => {
    const fake = server(10_000, []);
    const stop = new AbortController();
    const done = connect(fake).run(runRequest({ signal: stop.signal }));
    await new Promise((r) => setTimeout(r, 200));
    stop.abort();
    expect(await done).toEqual({ status: "cancelled" });
    expect(fake.requests.some((r) => r.url.endsWith("/session/ses-1/abort"))).toBe(true);
  });

  test("a model must be written provider/model", () => {
    expect(openCodeConnector.schema.safeParse({ ...config, model: "claude-x" }).success).toBe(
      false,
    );
    expect(openCodeConnector.spec.fields.map((f) => f.key)).toContain("passwordEnv");
  });
});
