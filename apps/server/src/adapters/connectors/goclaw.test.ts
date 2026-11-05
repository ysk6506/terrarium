import { describe, expect, test } from "vitest";
import { FakeFetch, json } from "../test-support/fake-fetch";
import { fakeTools, runRequest } from "../test-support/run-request";
import { goClawConnector, serverName } from "./goclaw";

const config = { kind: "goclaw", id: "gc", name: "GoClaw", url: "http://goclaw.test:18790" };
const OPS = "11111111-1111-4111-8111-111111111111";
const SRV = "22222222-2222-4222-8222-222222222222";

function connect(fake: FakeFetch, extra: Record<string, unknown> = {}, env = {}) {
  const parsed = goClawConnector.schema.parse({ ...config, ...extra });
  return goClawConnector.connect(parsed, { env, fetch: fake.fetch });
}

/** A gateway that has one agent, "ops", and says "ok" to every setup call. */
function gateway(chat: () => Response | Promise<Response> = () => json({ usage: {} })) {
  return new FakeFetch()
    .on("GET", /^\/v1\/agents$/, () =>
      json({
        agents: [
          {
            id: OPS,
            agent_key: "ops",
            display_name: "운영 에이전트",
            frontmatter: "장애를 본다",
            provider: "litellm",
            model: "qwen3",
            status: "active",
            agent_type: "open",
          },
          { id: "x", agent_key: "old", status: "archived" },
          { id: "y" },
        ],
      }),
    )
    .on("POST", /^\/v1\/mcp\/servers$/, () => json({ id: SRV, name: "x" }, 201))
    .on("POST", /^\/v1\/mcp\/servers\/[^/]+\/grants\/agent$/, () => json({ ok: true }, 201))
    .on("POST", /^\/v1\/chat\/completions$/, chat)
    .on("DELETE", /^\/v1\/mcp\/servers\/[^/]+\/grants\/agent\/[^/]+$/, () => json({ ok: true }))
    .on("DELETE", /^\/v1\/mcp\/servers\/[^/]+$/, () => new Response(null, { status: 204 }));
}

const calls = (fake: FakeFetch) =>
  fake.requests.map((r) => `${r.method} ${new URL(r.url).pathname}`);

describe("a GoClaw gateway: tools go in as an MCP server granted to the agent [REQ-051]", () => {
  test("agents are the gateway's active agents, asked for as a user, with the token", async () => {
    const fake = gateway();
    const list = await connect(fake, { tokenEnv: "GC" }, { GC: "tk" }).agents();
    expect(list).toEqual([
      {
        id: "ops",
        name: "운영 에이전트",
        description: "장애를 본다",
        model: "qwen3",
        facts: { provider: "litellm", agentType: "open" },
      },
    ]);
    expect(fake.requests[0]?.headers.authorization).toBe("Bearer tk");
    expect(fake.requests[0]?.headers["x-goclaw-user-id"]).toBe("terrarium");
  });

  test("a run registers this run's tool address, grants it, asks once, then takes both back", async () => {
    const fake = gateway(() =>
      json({ model: "qwen3", usage: { prompt_tokens: 40, completion_tokens: 7 } }),
    );
    const out = await connect(fake).run(runRequest({ agentId: "ops", traceparent: "00-t-s-01" }));
    expect(out).toEqual({
      status: "finished",
      harness: { inputTokens: 40, outputTokens: 7, model: "qwen3" },
    });
    expect(calls(fake)).toEqual([
      "GET /v1/agents",
      "POST /v1/mcp/servers",
      `POST /v1/mcp/servers/${SRV}/grants/agent`,
      "POST /v1/chat/completions",
      `DELETE /v1/mcp/servers/${SRV}/grants/agent/${OPS}`,
      `DELETE /v1/mcp/servers/${SRV}`,
    ]);
    expect(fake.requests[1]?.body).toMatchObject({
      name: "terrarium-r1",
      transport: "streamable-http",
      url: "https://terrarium.test/mcp/runs/r1/tok",
      tool_prefix: "mcp_terrarium",
      enabled: true,
    });
    expect(fake.requests[2]?.body).toEqual({ agent_id: OPS });
    const chat = fake.requests[3];
    expect(chat?.body).toMatchObject({ model: "goclaw:ops", stream: false, user: "terrarium-r1" });
    expect(JSON.stringify(chat?.body)).toContain("mcp_terrarium_submit_diagnosis");
    expect(chat?.headers.traceparent).toBe("00-t-s-01");
  });

  test("stopping a run drops the chat request, which stops GoClaw's agent, and still takes the tools back", async () => {
    const stop = new AbortController();
    const fake = gateway(() => new Promise<Response>(() => {}));
    const pending = connect(fake).run(runRequest({ agentId: "ops", signal: stop.signal }));
    await new Promise((r) => setTimeout(r, 30));
    stop.abort();
    expect((await pending).status).toBe("cancelled");
    expect(calls(fake).slice(-2)).toEqual([
      `DELETE /v1/mcp/servers/${SRV}/grants/agent/${OPS}`,
      `DELETE /v1/mcp/servers/${SRV}`,
    ]);
  });

  test("a failing gateway is an error that says what was asked, and cleanup still happens", async () => {
    const fake = gateway(() => new Response("모델이 없어요", { status: 500 }));
    const out = await connect(fake).run(runRequest({ agentId: "ops" }));
    expect(out.status).toBe("error");
    expect(out.message).toMatch(/채팅 요청에 500/);
    expect(calls(fake).at(-1)).toBe(`DELETE /v1/mcp/servers/${SRV}`);
  });

  test("a refused tool server (private address) is told as it is, and nothing is left behind", async () => {
    const fake = new FakeFetch()
      .on("GET", /^\/v1\/agents$/, () => json({ agents: [{ id: OPS, agent_key: "ops" }] }))
      .on("POST", /^\/v1\/mcp\/servers$/, () =>
        json({ error: "invalid URL: private address" }, 400),
      );
    const out = await connect(fake).run(runRequest({ agentId: "ops" }));
    expect(out.status).toBe("error");
    expect(out.message).toMatch(/툴 서버 등록에 400로 답했어요.*private address/);
    expect(calls(fake)).toEqual(["GET /v1/agents", "POST /v1/mcp/servers"]);
  });

  test("an agent the gateway does not have, or a run without a tool address, fails before anything is registered", async () => {
    const fake = gateway();
    expect((await connect(fake).run(runRequest({ agentId: "nobody" }))).message).toMatch(
      /'nobody' 에이전트가 없어요/,
    );
    expect(calls(fake)).toEqual(["GET /v1/agents"]);
    const noUrl = gateway();
    const out = await connect(noUrl).run(
      runRequest({ agentId: "ops", tools: fakeTools(undefined, null).endpoint }),
    );
    expect(out.message).toMatch(/툴 서버 주소가 없어요/);
    expect(noUrl.requests).toHaveLength(0);
  });

  test("two runs of one agent go one after the other, because the grant belongs to the agent", async () => {
    const order: string[] = [];
    const fake = gateway(async () => {
      order.push("chat");
      await new Promise((r) => setTimeout(r, 20));
      return json({ usage: {} });
    });
    const harness = connect(fake);
    await Promise.all([
      harness.run(runRequest({ agentId: "ops", runId: "a" })),
      harness.run(runRequest({ agentId: "ops", runId: "b" })),
    ]);
    const path = calls(fake).filter((c) =>
      /servers$|completions|DELETE \/v1\/mcp\/servers\/[^/]+$/.test(c),
    );
    expect(path).toEqual([
      "POST /v1/mcp/servers",
      "POST /v1/chat/completions",
      `DELETE /v1/mcp/servers/${SRV}`,
      "POST /v1/mcp/servers",
      "POST /v1/chat/completions",
      `DELETE /v1/mcp/servers/${SRV}`,
    ]);
  });

  test("a server name is a slug GoClaw accepts, whatever the run id looks like", () => {
    expect(serverName("run_ABC.123")).toBe("terrarium-run-abc-123");
    expect(serverName("x".repeat(100)).length).toBeLessThanOrEqual(60);
    expect(serverName("run-9-")).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
  });

  test("the form says what GoClaw needs: the private-address allowance and one run per agent", () => {
    const guide = goClawConnector.spec.toolGuide.join(" ");
    expect(guide).toContain("GOCLAW_MCP_ALLOWED_HOSTS");
    expect(guide).toContain("한 번에 하나씩");
    expect(goClawConnector.spec.toolTransport).toBe("mcp");
  });
});
