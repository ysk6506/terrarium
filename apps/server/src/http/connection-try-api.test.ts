import { MemoryStore } from "@terrarium/core/experiments";
import { describe, expect, test } from "vitest";
import { SecretBox } from "../adapters";
import { FakeFetch, json } from "../adapters/test-support/fake-fetch";
import { testPlatform } from "../runtime/test-support/platform";
import { buildApp } from "./app";

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
const goclaw = { connector: "goclaw", name: "사내 GoClaw", config: { url: "http://goclaw.test" } };
const traces = {
  kind: "langfuse",
  config: { host: "http://lf.test", publicKey: "pk-1", secretKey: "sk-typed-secret" },
};

function world() {
  const fake = new FakeFetch()
    .on("GET", /^\/v1\/agents$/, () =>
      json({ agents: [{ id: "u1", agent_key: "ops", display_name: "운영", status: "active" }] }),
    )
    .on("POST", /^\/v1\/chat\/completions$/, () =>
      json({ model: "qwen3", choices: [{ message: { content: "안녕하세요" } }] }),
    )
    .on("GET", /^\/api\/public\/v2\/observations$/, () => json({ data: [GENERATION], meta: {} }));
  return testPlatform(
    [],
    {
      adapters: { connect: { env: {}, fetch: fake.fetch }, secretBox: SecretBox.ephemeral() },
      tryOptions: { looks: 2, lookGapMs: 0 },
    },
    new MemoryStore(),
  );
}

describe("말 걸어 보기 and the tools for traces over HTTP [REQ-079]", () => {
  test("over HTTP: the route runs the turn, and the tools for traces are listed", async () => {
    const { platform } = world();
    const a = buildApp({ platform });
    const made = await a.inject({
      method: "POST",
      url: "/api/connections",
      headers: { "x-terrarium-user": "yeonsu" },
      payload: { ...goclaw, traces },
    });
    const id = made.json().id as string;
    // the connection carries yeonsu's secrets: another signed-in person may not talk through it
    const stranger = await a.inject({
      method: "POST",
      url: `/api/connections/${id}/try`,
      headers: { "x-terrarium-user": "jimin" },
      payload: { agentId: "ops", text: "안녕" },
    });
    expect(stranger.statusCode).toBe(403);
    const tried = await a.inject({
      method: "POST",
      url: `/api/connections/${id}/try`,
      headers: { "x-terrarium-user": "yeonsu" },
      payload: { agentId: "ops", text: "안녕" },
    });
    expect(tried.statusCode).toBe(200);
    expect(tried.json()).toMatchObject({ ok: true, text: "안녕하세요" });
    const empty = await a.inject({
      method: "POST",
      url: `/api/connections/${id}/try`,
      headers: { "x-terrarium-user": "yeonsu" },
      payload: { agentId: "ops", text: " " },
    });
    expect(empty.statusCode).toBe(400);
    const list = await a.inject({
      method: "GET",
      url: "/api/telemetry-adapters",
      headers: { "x-terrarium-user": "jimin" },
    });
    expect(list.json().adapters.map((x: { kind: string }) => x.kind)).toEqual([
      "clickstack",
      "langfuse",
    ]);
    expect(list.json().serverDefault).toBeUndefined();
    expect(
      (
        await a.inject({
          method: "POST",
          url: "/api/connections/nope/try",
          headers: { "x-terrarium-user": "jimin" },
          payload: { agentId: "a", text: "b" },
        })
      ).statusCode,
    ).toBe(404);
  });
});
