import { describe, expect, test } from "vitest";
import { FakeFetch, json } from "../test-support/fake-fetch";
import { fakeTools, runRequest } from "../test-support/run-request";
import { configurable, langGraphConnector } from "./langgraph";

const config = {
  kind: "langgraph",
  id: "lg",
  name: "회사 LangGraph",
  url: "http://lg.test:2024",
  pollSeconds: 0.05,
};

function connect(fake: FakeFetch, extra: Record<string, unknown> = {}, env = {}) {
  const parsed = langGraphConnector.schema.parse({ ...config, ...extra });
  return langGraphConnector.connect(parsed, { env, fetch: fake.fetch });
}

/** A server that finishes a run after the given statuses. */
function server(statuses: string[]) {
  return new FakeFetch()
    .on("POST", /^\/threads$/, () => json({ thread_id: "th-1" }))
    .on("POST", /^\/threads\/th-1\/runs$/, () => json({ run_id: "ru-1", status: "pending" }))
    .on("GET", /^\/threads\/th-1\/runs\/ru-1$/, () =>
      json({ status: statuses.shift() ?? statuses.at(-1) }),
    )
    .on("POST", /\/cancel$/, () => json({}));
}

describe("a LangGraph Agent Server: its assistants are the agents [REQ-051]", () => {
  test("assistants are listed page by page, with what the server says about them", async () => {
    const page = (n: number, from: number) =>
      Array.from({ length: n }, (_, i) => ({
        assistant_id: `a-${from + i}`,
        graph_id: "agent",
        name: `어시스턴트 ${from + i}`,
        version: 2,
      }));
    const pages = [page(100, 0), [...page(2, 100), { name: "id 없음" }]];
    const fake = new FakeFetch().on("POST", /^\/assistants\/search$/, () => json(pages.shift()));
    const agents = await connect(fake, { apiKeyEnv: "LG_KEY" }, { LG_KEY: "k-1" }).agents();
    expect(agents).toHaveLength(102);
    expect(agents[0]).toEqual({
      id: "a-0",
      name: "어시스턴트 0",
      facts: { graph: "agent", assistantVersion: "2" },
    });
    expect(fake.requests.map((r) => r.body)).toEqual([
      { limit: 100, offset: 0 },
      { limit: 100, offset: 100 },
    ]);
    expect(fake.requests[0]?.headers["x-api-key"]).toBe("k-1");
  });

  test("an assistant without a name shows its graph; a server that refuses is said to", async () => {
    const fake = new FakeFetch().on("POST", /^\/assistants\/search$/, () =>
      json([{ assistant_id: "x", graph_id: "triage", description: "분류" }]),
    );
    expect(await connect(fake).agents()).toEqual([
      { id: "x", name: "triage", description: "분류", facts: { graph: "triage" } },
    ]);
    const refusing = new FakeFetch().on(
      "POST",
      /^\/assistants\/search$/,
      () => new Response("no key", { status: 403 }),
    );
    await expect(connect(refusing).agents()).rejects.toThrow(
      "어시스턴트 목록에 403로 답했어요: no key",
    );
  });

  test("a run makes a thread, starts the assistant with the task and the address of its tools, and waits", async () => {
    const fake = server(["pending", "running", "success"]);
    const tools = fakeTools();
    const out = await connect(fake).run(
      runRequest({ tools: tools.endpoint, traceparent: "00-a-b-01" }),
    );
    expect(out.status).toBe("finished");
    expect(out.harness?.wallSeconds).toBeGreaterThan(0);
    const start = fake.requests.find((r) => r.url.endsWith("/threads/th-1/runs"));
    expect(start?.body).toEqual({
      assistant_id: "agent-1",
      input: { messages: [{ role: "user", content: '서버 "A"를 조사하라' }] },
      config: {
        configurable: {
          terrarium_mcp_url: "https://terrarium.test/mcp/runs/r1/tok",
          terrarium_run_id: "r1",
          terrarium_seed: 3,
          terrarium_max_tool_calls: 40,
          terrarium_time_limit_seconds: 600,
          terrarium_traceparent: "00-a-b-01",
        },
      },
      metadata: { terrarium_run_id: "r1" },
    });
    expect(fake.requests.find((r) => r.url.endsWith("/threads"))?.body).toEqual({
      metadata: { terrarium_run_id: "r1" },
    });
  });

  test("the input of the graph is whatever the form says, with the task poured in safely", async () => {
    const fake = server(["success"]);
    await connect(fake, { input: '{"question":"{{prompt}}","run":"{{runId}}"}' }).run(runRequest());
    const start = fake.requests.find((r) => r.url.endsWith("/threads/th-1/runs"));
    expect(start?.body).toMatchObject({ input: { question: '서버 "A"를 조사하라', run: "r1" } });
    expect(
      langGraphConnector.schema.safeParse({ ...config, input: "not json {{prompt}}" }).success,
    ).toBe(false);
  });

  test("how a run can end: errors, timeouts and a graph waiting for a person are told apart", async () => {
    for (const [status, message] of [
      ["error", "LangGraph 실행이 'error'로 끝났어요"],
      ["timeout", "LangGraph 실행이 'timeout'로 끝났어요"],
      ["interrupted", "그래프가 사람의 입력을 기다리며 멈췄어요(interrupted)"],
    ] as const) {
      const out = await connect(server([status])).run(runRequest());
      expect(out).toEqual({ status: "error", message });
    }
  });

  test("a server that cannot be reached, or whose status cannot be read, is an error with a reason", async () => {
    const down = new FakeFetch().on("POST", /^\/threads$/, () => {
      throw new TypeError("fetch failed");
    });
    expect((await connect(down).run(runRequest())).message).toBe(
      "LangGraph 서버에 연결하지 못했어요: fetch failed",
    );
    const flaky = new FakeFetch()
      .on("POST", /^\/threads$/, () => json({ thread_id: "th-1" }))
      .on("POST", /^\/threads\/th-1\/runs$/, () => json({ run_id: "ru-1" }))
      .on("GET", /\/runs\/ru-1$/, () => new Response("", { status: 500 }));
    const out = await connect(flaky).run(runRequest());
    expect(out.status).toBe("error");
    expect(out.message).toContain("실행 상태를 5번 연달아 못 읽었어요");
  });

  test("stopping a run asks the server to cancel it", async () => {
    const fake = server(["running"]);
    const stop = new AbortController();
    const done = connect(fake).run(runRequest({ signal: stop.signal }));
    await new Promise((r) => setTimeout(r, 200));
    stop.abort();
    expect(await done).toEqual({ status: "cancelled" });
    expect(
      fake.requests.some(
        (r) => r.method === "POST" && r.url.endsWith("/runs/ru-1/cancel?action=interrupt"),
      ),
    ).toBe(true);
  });

  test("what the graph can read is plain; a run without tools gets an empty address", () => {
    expect(configurable(runRequest({ tools: fakeTools(undefined, null).endpoint }))).toMatchObject({
      terrarium_mcp_url: "",
    });
    expect(langGraphConnector.spec).toMatchObject({ scope: "harness", fromScreen: true });
  });
});
