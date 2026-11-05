import { describe, expect, test } from "vitest";
import { FakeFetch, json } from "../test-support/fake-fetch";
import { runRequest } from "../test-support/run-request";
import { hermesConnector } from "./hermes";

const config = {
  kind: "hermes",
  id: "hm",
  name: "Hermes",
  url: "http://hermes.test:8642",
  pollSeconds: 0.2,
};

function connect(fake: FakeFetch, extra: Record<string, unknown> = {}, env = {}) {
  const parsed = hermesConnector.schema.parse({ ...config, ...extra });
  return hermesConnector.connect(parsed, { env, fetch: fake.fetch });
}

/** A Hermes whose run goes through these statuses, one per poll. */
function hermes(statuses: object[], onStop?: () => void) {
  const queue = [...statuses];
  return new FakeFetch()
    .on("GET", /^\/v1\/models$/, () => json({ data: [{ id: "hermes-agent" }] }))
    .on("POST", /^\/v1\/runs$/, () =>
      json({ run_id: "run_1", status: "started", replayed: false }, 202),
    )
    .on("GET", /^\/v1\/runs\/run_1$/, () => json(queue.length > 1 ? queue.shift() : queue[0]))
    .on("POST", /^\/v1\/runs\/run_1\/stop$/, () => {
      onStop?.();
      return json({ run_id: "run_1", status: "stopping" });
    });
}

const paths = (fake: FakeFetch) =>
  fake.requests.map((r) => `${r.method} ${new URL(r.url).pathname}`);

describe("a Hermes Agent: runs are started, watched and stopped through its runs API [REQ-051]", () => {
  test("it offers its one agent, with the model the server names, and marks its fixed tool address", async () => {
    const fake = hermes([]);
    const h = connect(fake, { tokenEnv: "HK" }, { HK: "key" });
    expect(await h.agents()).toEqual([
      {
        id: "default",
        name: "Hermes Agent",
        description: "Hermes의 기본 프로필. 다른 프로필은 연결을 따로 만들어요.",
        model: "hermes-agent",
      },
    ]);
    expect(fake.requests[0]?.headers.authorization).toBe("Bearer key");
    expect(h.info).toMatchObject({ kind: "hermes", toolTransport: "mcp", mcpSlot: "hm" });
  });

  test("a profile has its API under /p/<profile>", async () => {
    const fake = new FakeFetch().on("GET", /^\/p\/ops\/v1\/models$/, () => json({ data: [] }));
    const list = await connect(fake, { profile: "ops" }).agents();
    expect(list[0]).toMatchObject({ id: "ops", name: "Hermes (ops)" });
  });

  test("a wrong key is an error, but a missing model list is not", async () => {
    const denied = new FakeFetch().on(
      "GET",
      /^\/v1\/models$/,
      () => new Response("no", { status: 401 }),
    );
    await expect(connect(denied).agents()).rejects.toThrow(/에 401/);
    const none = new FakeFetch();
    expect(await connect(none).agents()).toHaveLength(1);
  });

  test("a run is started once, polled until it completes, and reports the tokens", async () => {
    const fake = hermes([
      { run_id: "run_1", status: "queued" },
      { run_id: "run_1", status: "running" },
      {
        run_id: "run_1",
        status: "completed",
        output: "끝",
        model: "qwen3",
        usage: { input_tokens: 90, output_tokens: 12 },
      },
    ]);
    const out = await connect(fake).run(
      runRequest({ agentId: "default", traceparent: "00-t-s-01" }),
    );
    expect(out).toEqual({
      status: "finished",
      harness: { inputTokens: 90, outputTokens: 12, model: "qwen3" },
    });
    expect(paths(fake).filter((p) => p === "POST /v1/runs")).toHaveLength(1);
    const start = fake.requests.find((r) => r.method === "POST" && r.url.endsWith("/v1/runs"));
    expect(JSON.stringify(start?.body)).toContain("submit_diagnosis");
    expect(start?.headers.traceparent).toBe("00-t-s-01");
    expect(paths(fake)).not.toContain("POST /v1/runs/run_1/stop");
  });

  test("a failed run is an error that carries Hermes's words", async () => {
    const fake = hermes([
      { run_id: "run_1", status: "failed", error: { message: "모델에 닿지 않아요" } },
    ]);
    const out = await connect(fake).run(runRequest());
    expect(out).toMatchObject({ status: "error", message: "모델에 닿지 않아요" });
  });

  test("stopping calls Hermes's stop and says cancelled", async () => {
    const stop = new AbortController();
    let stopped = false;
    const fake = hermes([{ run_id: "run_1", status: "running" }], () => {
      stopped = true;
    });
    const pending = connect(fake).run(runRequest({ signal: stop.signal }));
    await new Promise((r) => setTimeout(r, 450));
    stop.abort();
    expect((await pending).status).toBe("cancelled");
    expect(stopped).toBe(true);
  });

  test("a run that waits for a person's approval is stopped and told, since nobody is there to answer", async () => {
    let stopped = false;
    const fake = hermes([{ run_id: "run_1", status: "waiting_for_approval" }], () => {
      stopped = true;
    });
    const out = await connect(fake).run(runRequest());
    expect(out.status).toBe("error");
    expect(out.message).toMatch(/승인을 기다리고 있어요/);
    expect(stopped).toBe(true);
  });

  test("a few failed polls are forgiven, many are not", async () => {
    let n = 0;
    const flaky = new FakeFetch()
      .on("POST", /^\/v1\/runs$/, () => json({ run_id: "run_1" }, 202))
      .on("GET", /^\/v1\/runs\/run_1$/, () =>
        ++n < 3 ? new Response("busy", { status: 503 }) : json({ status: "completed" }),
      )
      .on("POST", /^\/v1\/runs\/run_1\/stop$/, () => json({}));
    expect((await connect(flaky).run(runRequest())).status).toBe("finished");
    const dead = new FakeFetch()
      .on("POST", /^\/v1\/runs$/, () => json({ run_id: "run_1" }, 202))
      .on("GET", /^\/v1\/runs\/run_1$/, () => new Response("down", { status: 503 }))
      .on("POST", /^\/v1\/runs\/run_1\/stop$/, () => json({}));
    const out = await connect(dead).run(runRequest());
    expect(out.status).toBe("error");
    expect(out.message).toMatch(/실행 상태에 503/);
  });

  test("the fixed address means one run, so two runs of the connection go one after the other", async () => {
    const order: string[] = [];
    let id = 0;
    const fake = new FakeFetch()
      .on("POST", /^\/v1\/runs$/, () => {
        order.push("start");
        return json({ run_id: `run_${++id}` }, 202);
      })
      .on("GET", /^\/v1\/runs\/[^/]+$/, () => {
        order.push("poll");
        return json({ status: "completed" });
      });
    const h = connect(fake);
    await Promise.all([h.run(runRequest({ runId: "a" })), h.run(runRequest({ runId: "b" }))]);
    expect(order).toEqual(["start", "poll", "start", "poll"]);
  });

  test("the form tells where to write the fixed address and what Hermes must allow", () => {
    const guide = hermesConnector.spec.toolGuide.join(" ");
    expect(guide).toContain("mcp_servers");
    expect(guide).toContain("한 번에 한 실행");
    expect(guide).toContain("API_SERVER_KEY");
  });
});
