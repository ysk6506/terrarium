import { describe, expect, test } from "vitest";
import { FakeFetch, json } from "../test-support/fake-fetch";
import { runRequest } from "../test-support/run-request";
import { httpTemplateConnector } from "./http-template";

const config = {
  kind: "http-template",
  id: "api",
  name: "사내 API",
  url: "http://api.test",
  agentId: "triage",
  pollSeconds: 0.05,
};

function connect(fake: FakeFetch, extra: Record<string, unknown> = {}, env = {}) {
  const parsed = httpTemplateConnector.schema.parse({ ...config, ...extra });
  return httpTemplateConnector.connect(parsed, { env, fetch: fake.fetch });
}

const poll = {
  mode: "poll",
  startPath: "/runs",
  idPointer: "/id",
  statusPath: "/runs/{{remoteId}}",
  statusPointer: "/state",
  cancelPath: "/runs/{{remoteId}}",
};

describe("any HTTP API as an agent: the request is written in the form [REQ-051]", () => {
  test("the one agent is what the form says, and a health path must answer", async () => {
    const fake = new FakeFetch().on("GET", /^\/health$/, () => json({}));
    const agent = connect(fake, {
      healthPath: "/health",
      model: "m-1",
      agentName: "분류",
      description: "설명",
    });
    expect(await agent.agents()).toEqual([
      { id: "triage", name: "분류", model: "m-1", description: "설명" },
    ]);
    const sick = new FakeFetch().on("GET", /^\/health$/, () => new Response("", { status: 503 }));
    await expect(connect(sick, { healthPath: "/health" }).agents()).rejects.toThrow(
      "상태 확인 주소가 503로 답했어요",
    );
    expect(await connect(new FakeFetch()).agents()).toEqual([{ id: "triage", name: "사내 API" }]);
  });

  test("sync: the start request answers when the agent is done; the task is poured into the body safely", async () => {
    const fake = new FakeFetch().on("POST", /^\/$/, () => json({ answer: "끝" }));
    const out = await connect(fake, { tokenEnv: "API_TOKEN" }, { API_TOKEN: "tok" }).run(
      runRequest(),
    );
    expect(out).toMatchObject({ status: "finished", message: '{"answer":"끝"}' });
    const sent = fake.requests[0];
    expect(sent?.body).toEqual({
      prompt: '서버 "A"를 조사하라',
      mcpUrl: "https://terrarium.test/mcp/runs/r1/tok",
    });
    expect(sent?.headers.authorization).toBe("Bearer tok");
  });

  test("a different header for the token, and fixed headers, go out with every request", async () => {
    const fake = new FakeFetch().on("POST", /^\/$/, () => json({}));
    await connect(
      fake,
      { tokenEnv: "K", authHeader: "x-api-key", authPrefix: "", headers: { "x-team": "ai" } },
      { K: "secret" },
    ).run(runRequest());
    expect(fake.requests[0]?.headers).toMatchObject({ "x-api-key": "secret", "x-team": "ai" });
  });

  test("poll: the run's id is read from the answer and asked about until a done value shows", async () => {
    const states = ["running", "Running", "COMPLETED"];
    const fake = new FakeFetch()
      .on("POST", /^\/runs$/, () => json({ id: "abc 1" }))
      .on("GET", /^\/runs\/abc%201$/, () => json({ state: states.shift() }));
    const out = await connect(fake, poll).run(runRequest());
    expect(out).toMatchObject({ status: "finished", message: "completed" });
    expect(fake.requests.filter((r) => r.method === "GET")).toHaveLength(3);
  });

  test("poll: the id falls back to the run's own when the answer has none; a failed value is an error", async () => {
    const fake = new FakeFetch()
      .on("POST", /^\/runs$/, () => json({}))
      .on("GET", /^\/runs\/r1$/, () => json({ state: "failed" }));
    expect(await connect(fake, poll).run(runRequest())).toEqual({
      status: "error",
      message: "에이전트 상태: failed",
    });
  });

  test("poll: stopping a run calls the cancel address; without one nothing is called", async () => {
    const fake = new FakeFetch()
      .on("POST", /^\/runs$/, () => json({ id: "9" }))
      .on("GET", /^\/runs\/9$/, () => json({ state: "running" }))
      .on("DELETE", /^\/runs\/9$/, () => json({}));
    const stop = new AbortController();
    const done = connect(fake, poll).run(runRequest({ signal: stop.signal }));
    await new Promise((r) => setTimeout(r, 200));
    stop.abort();
    expect(await done).toEqual({ status: "cancelled" });
    expect(fake.requests.some((r) => r.method === "DELETE")).toBe(true);
    const posting = new FakeFetch()
      .on("POST", /^\/runs$/, () => json({ id: "9" }))
      .on("GET", /^\/runs\/9$/, () => json({ state: "running" }))
      .on("POST", /^\/runs\/9\/cancel$/, () => json({}));
    const stop2 = new AbortController();
    const done2 = connect(posting, {
      ...poll,
      cancelPath: "/runs/{{remoteId}}/cancel",
      cancelMethod: "POST",
    }).run(runRequest({ signal: stop2.signal }));
    await new Promise((r) => setTimeout(r, 150));
    stop2.abort();
    await done2;
    expect(posting.requests.some((r) => r.url.endsWith("/runs/9/cancel"))).toBe(true);
    const plain = new FakeFetch()
      .on("POST", /^\/runs$/, () => json({ id: "9" }))
      .on("GET", /^\/runs\/9$/, () => json({ state: "running" }));
    const stop3 = new AbortController();
    const done3 = connect(plain, { ...poll, cancelPath: undefined }).run(
      runRequest({ signal: stop3.signal }),
    );
    await new Promise((r) => setTimeout(r, 150));
    stop3.abort();
    expect(await done3).toEqual({ status: "cancelled" });
    expect(plain.requests.some((r) => r.method === "DELETE")).toBe(false);
  });

  test("refusals, an unreachable API, unreadable statuses and a body that needs tools the run lacks are errors with reasons", async () => {
    const refused = new FakeFetch().on("POST", /^\/$/, () => new Response("busy", { status: 429 }));
    expect((await connect(refused).run(runRequest())).message).toBe(
      "시작 요청이 429로 답했어요: busy",
    );
    expect(
      (
        await connect(
          new FakeFetch().on("POST", /^\/$/, () => {
            throw new TypeError("fetch failed");
          }),
        ).run(runRequest())
      ).message,
    ).toBe("에이전트에 연결하지 못했어요: fetch failed");
    const noMcp = runRequest({ tools: { ...runRequest().tools, mcpUrl: "" } });
    const bare = { ...noMcp, tools: { specs: noMcp.tools.specs, call: noMcp.tools.call } };
    expect((await connect(new FakeFetch()).run(bare)).message).toBe(
      "이 실행에는 MCP 엔드포인트가 없어요",
    );
    const flaky = new FakeFetch()
      .on("POST", /^\/runs$/, () => json({ id: "9" }))
      .on("GET", /^\/runs\/9$/, () => new Response("", { status: 500 }));
    expect((await connect(flaky, poll).run(runRequest())).message).toContain(
      "상태를 5번 연달아 못 읽었어요",
    );
  });

  test("what the form can say is checked: unknown variables, JSON that is not, a status address that is missing", () => {
    const issues = (extra: Record<string, unknown>) => {
      const r = httpTemplateConnector.schema.safeParse({ ...config, ...extra });
      return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    };
    expect(issues({})).toEqual([]);
    expect(issues({ startBody: '{"a":"{{nope}}"}' })).toEqual([
      "startBody: 모르는 변수 {{nope}}가 있어요",
    ]);
    expect(issues({ startBody: '{"a": {{prompt}}}' })).toEqual([
      "startBody: JSON 형식이 아니에요 ({{변수}}는 따옴표 안에 써요)",
    ]);
    expect(issues({ startPath: "/x/{{who}}" })).toEqual([
      "startPath: 모르는 변수 {{who}}가 있어요",
    ]);
    expect(issues({ mode: "poll" })).toEqual([
      "statusPath: 상태를 묻는 방식에는 주소가 필요해요",
      "statusPointer: 상태를 묻는 방식에는 상태 값의 위치(예: /status)가 필요해요",
    ]);
  });
});
