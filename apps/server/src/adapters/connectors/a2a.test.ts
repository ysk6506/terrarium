import { describe, expect, test } from "vitest";
import { FakeFetch, json } from "../test-support/fake-fetch";
import { fakeTools, runRequest } from "../test-support/run-request";
import { a2aConnector, stateOf, wireOf } from "./a2a";

const config = {
  kind: "a2a",
  id: "ag",
  name: "A2A 에이전트",
  url: "http://a2a.test",
  pollSeconds: 0.05,
};

function connect(fake: FakeFetch, extra: Record<string, unknown> = {}, env = {}) {
  const parsed = a2aConnector.schema.parse({ ...config, ...extra });
  return a2aConnector.connect(parsed, { env, fetch: fake.fetch });
}

const rpc = (result: unknown) => json({ jsonrpc: "2.0", id: 1, result });

/** An agent of the 1.0 wire: states are TASK_STATE_*, roles ROLE_*, parts carry no `kind`. */
function v1(states: string[], seen: string[] = []) {
  const fake = new FakeFetch()
    .on("GET", /agent-card\.json$/, () =>
      json({
        name: "분류 에이전트",
        description: "알람을 분류해요",
        version: "2.1",
        supportedInterfaces: [
          { url: "http://a2a.test/rpc", protocolBinding: "JSONRPC", protocolVersion: "1.0" },
        ],
      }),
    )
    .on("POST", /^\/rpc$/, (req) => {
      const body = req.body as { method: string };
      seen.push(body.method);
      if (body.method === "SendMessage")
        return rpc({ task: { id: "t1", status: { state: "TASK_STATE_SUBMITTED" } } });
      if (body.method === "GetTask") {
        const state = states.shift() ?? "TASK_STATE_COMPLETED";
        return rpc({
          task: {
            id: "t1",
            status: { state },
            artifacts: [{ parts: [{ text: "원인은 팬 고장" }] }],
          },
        });
      }
      return rpc({ task: { id: "t1", status: { state: "TASK_STATE_CANCELED" } } });
    });
  return fake;
}

/** An agent of the 0.3 wire: lowercase states, `kind` on messages and parts, `message/send`. */
function v03(states: string[], seen: string[] = []) {
  return new FakeFetch()
    .on("GET", /agent-card\.json$/, () =>
      json({ name: "옛 에이전트", url: "http://a2a.test/v03", protocolVersion: "0.3.0" }),
    )
    .on("POST", /^\/v03$/, (req) => {
      const body = req.body as { method: string };
      seen.push(body.method);
      if (body.method === "message/send")
        return rpc({ kind: "task", id: "t9", status: { state: "submitted" } });
      if (body.method === "tasks/get")
        return rpc({
          kind: "task",
          id: "t9",
          status: {
            state: states.shift() ?? "completed",
            message: { parts: [{ kind: "text", text: "끝났어요" }] },
          },
        });
      return rpc({});
    });
}

describe("an A2A agent: the card says who it is, a run is a task [REQ-051]", () => {
  test("the card gives the agent its name, its description and what the card knows of its version", async () => {
    const agents = await connect(v1([])).agents();
    expect(agents).toEqual(
      [
        {
          id: "-",
          name: "분류 에이전트",
          description: "알람을 분류해요",
          facts: { agentVersion: "2.1", protocol: "1.0" },
        },
      ].map((a) => ({ ...a, id: expect.any(String) })),
    );
    const named = await connect(v1([]), { agentId: "triage" }).agents();
    expect(named[0]?.id).toBe("triage");
  });

  test("a card that is missing, or whose interfaces cannot be spoken to, is said so", async () => {
    const none = new FakeFetch();
    await expect(connect(none).agents()).rejects.toThrow("에이전트 카드를 읽지 못했어요");
    const grpc = new FakeFetch().on("GET", /agent-card\.json$/, () =>
      json({
        name: "x",
        supportedInterfaces: [{ url: "http://a2a.test", protocolBinding: "GRPC" }],
      }),
    );
    await expect(connect(grpc).agents()).rejects.toThrow("JSON-RPC로 말하는 인터페이스가 없어요");
    const nowhere = new FakeFetch().on("GET", /agent-card\.json$/, () => json({ name: "x" }));
    await expect(connect(nowhere).agents()).rejects.toThrow("에이전트 카드에 주소가 없어요");
  });

  test("an older card is found at agent.json, and a card file address can be given as it is", async () => {
    const old = new FakeFetch().on("GET", /agent\.json$/, () =>
      json({ name: "옛 카드", url: "http://a2a.test/v03" }),
    );
    expect((await connect(old).agents())[0]?.name).toBe("옛 카드");
    const direct = new FakeFetch().on("GET", /my-card\.json$/, () =>
      json({ name: "직접", url: "http://a2a.test/v03" }),
    );
    expect(
      (await connect(direct, { url: "http://a2a.test/cards/my-card.json" }).agents())[0]?.name,
    ).toBe("직접");
    expect(direct.requests).toHaveLength(1);
  });

  test("1.0: one message with the task and the tools' address, then the task is asked about until it completes", async () => {
    const seen: string[] = [];
    const fake = v1(["TASK_STATE_WORKING", "TASK_STATE_COMPLETED"], seen);
    const out = await connect(fake, {}, {}).run(runRequest({ traceparent: "00-a-b-01" }));
    expect(out).toMatchObject({ status: "finished", harness: { message: "원인은 팬 고장" } });
    expect(seen).toEqual(["SendMessage", "GetTask", "GetTask"]);
    const send = fake.requests.find(
      (r) => (r.body as { method?: string })?.method === "SendMessage",
    );
    expect(send?.headers["a2a-version"]).toBe("1.0");
    const params = (
      send?.body as {
        params: {
          message: { role: string; parts: Array<Record<string, unknown>> };
          configuration: object;
        };
      }
    ).params;
    expect(params.message.role).toBe("ROLE_USER");
    expect(params.configuration).toEqual({ returnImmediately: true });
    expect(params.message.parts[0]?.text).toContain("https://terrarium.test/mcp/runs/r1/tok");
    expect(params.message.parts[1]).toMatchObject({
      data: {
        terrarium: {
          runId: "r1",
          seed: 3,
          traceparent: "00-a-b-01",
          tools: ["get_entity", "submit_diagnosis"],
        },
      },
    });
  });

  test("0.3: the old method names, a kind on every part, lowercase states", async () => {
    const seen: string[] = [];
    const fake = v03(["working", "completed"], seen);
    const out = await connect(fake).run(runRequest());
    expect(out).toMatchObject({ status: "finished", harness: { message: "끝났어요" } });
    expect(seen).toEqual(["message/send", "tasks/get", "tasks/get"]);
    const send = fake.requests.find(
      (r) => (r.body as { method?: string })?.method === "message/send",
    );
    expect(send?.headers["a2a-version"]).toBeUndefined();
    const params = (
      send?.body as {
        params: {
          message: { kind: string; role: string; parts: Array<{ kind: string }> };
          configuration: object;
        };
      }
    ).params;
    expect(params.message).toMatchObject({ kind: "message", role: "user" });
    expect(params.message.parts.map((p) => p.kind)).toEqual(["text", "data"]);
    expect(params.configuration).toEqual({ blocking: false });
  });

  test("the version can be forced when the card does not say", async () => {
    const seen: string[] = [];
    const fake = v03(["completed"], seen);
    await connect(fake, { protocolVersion: "0.3" }).run(runRequest());
    expect(seen[0]).toBe("message/send");
  });

  test("an agent that answers with a message, not a task, is done at once", async () => {
    const fake = new FakeFetch()
      .on("GET", /agent-card\.json$/, () =>
        json({ name: "x", url: "http://a2a.test/v03", protocolVersion: "0.3.0" }),
      )
      .on("POST", /^\/v03$/, () =>
        rpc({ kind: "message", parts: [{ kind: "text", text: "바로 답해요" }] }),
      );
    expect(await connect(fake).run(runRequest())).toMatchObject({
      status: "finished",
      harness: { message: "바로 답해요" },
    });
  });

  test("how a task ends: failed, rejected, canceled, or stuck waiting for a person", async () => {
    const ending = async (state: string) => {
      const seen: string[] = [];
      const out = await connect(v03([state], seen)).run(runRequest());
      return { out, seen };
    };
    expect((await ending("failed")).out).toMatchObject({
      status: "error",
      message: "에이전트가 실패했어요: 끝났어요",
    });
    expect((await ending("rejected")).out.message).toBe("에이전트가 과제를 거절했어요");
    expect((await ending("canceled")).out).toEqual({ status: "cancelled" });
    const waiting = await ending("input-required");
    expect(waiting.out.message).toContain("사람의 입력을 요구하며 멈췄어요");
    expect(waiting.seen.at(-1)).toBe("tasks/cancel");
    expect((await ending("auth-required")).out.message).toContain("인증을 요구하며 멈췄어요");
  });

  test("a task without an id, an unreachable agent and unreadable statuses are errors with reasons", async () => {
    const noId = new FakeFetch()
      .on("GET", /agent-card\.json$/, () =>
        json({ name: "x", url: "http://a2a.test/v03", protocolVersion: "0.3.0" }),
      )
      .on("POST", /^\/v03$/, () => rpc({ kind: "task", status: { state: "working" } }));
    expect((await connect(noId).run(runRequest())).message).toBe(
      "에이전트가 과제 id를 주지 않았어요",
    );
    expect((await connect(new FakeFetch()).run(runRequest())).message).toContain(
      "A2A 에이전트에 연결하지 못했어요",
    );
    const refusing = new FakeFetch()
      .on("GET", /agent-card\.json$/, () => json({ name: "x", url: "http://a2a.test/v03" }))
      .on("POST", /^\/v03$/, () => json({ error: { message: "과제를 받을 수 없어요" } }));
    expect((await connect(refusing).run(runRequest())).message).toContain("과제를 받을 수 없어요");
    const down = new FakeFetch()
      .on("GET", /agent-card\.json$/, () => json({ name: "x", url: "http://a2a.test/v03" }))
      .on("POST", /^\/v03$/, () => new Response("", { status: 503 }));
    expect((await connect(down).run(runRequest())).message).toContain(
      "message/send에 503로 답했어요",
    );
    let n = 0;
    const flaky = new FakeFetch()
      .on("GET", /agent-card\.json$/, () =>
        json({ name: "x", url: "http://a2a.test/v03", protocolVersion: "0.3.0" }),
      )
      .on("POST", /^\/v03$/, (req) =>
        (req.body as { method: string }).method === "message/send" && n++ === 0
          ? rpc({ kind: "task", id: "t", status: { state: "working" } })
          : new Response("", { status: 500 }),
      );
    expect((await connect(flaky).run(runRequest())).message).toContain(
      "과제 상태를 5번 연달아 못 읽었어요",
    );
  });

  test("stopping a run cancels the task on the agent", async () => {
    const seen: string[] = [];
    const fake = v1(Array(1000).fill("TASK_STATE_WORKING"), seen);
    const stop = new AbortController();
    const done = connect(fake).run(runRequest({ signal: stop.signal }));
    await new Promise((r) => setTimeout(r, 250));
    stop.abort();
    expect(await done).toEqual({ status: "cancelled" });
    expect(seen).toContain("CancelTask");
  });

  test("states and wires are read the same whichever version said them", () => {
    expect(stateOf("TASK_STATE_INPUT_REQUIRED")).toBe("input-required");
    expect(stateOf("working")).toBe("working");
    expect(stateOf(undefined)).toBe("");
    expect(wireOf({ url: "u", protocolVersion: "0.3.0" }, "auto")).toEqual({
      version: "0.3",
      url: "u",
    });
    expect(
      wireOf({ supportedInterfaces: [{ url: "u", protocolBinding: "JSONRPC" }] }, "auto"),
    ).toEqual({
      version: "1.0",
      url: "u",
    });
    expect(wireOf({ url: "u" }, "auto").version).toBe("0.3");
    expect(wireOf({ url: "u", protocolVersion: "0.3.0" }, "1.0").version).toBe("1.0");
    expect(fakeTools().calls).toEqual([]);
  });
});
