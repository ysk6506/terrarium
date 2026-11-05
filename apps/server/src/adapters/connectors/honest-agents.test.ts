import type { TalkRequest } from "@terrarium/core/experiments";
import { describe, expect, test } from "vitest";
import { FakeFetch, json } from "../test-support/fake-fetch";
import { goClawConnector } from "./goclaw";
import { httpTemplateConnector } from "./http-template";
import { openClawConnector } from "./openclaw";
import { openCodeConnector } from "./opencode";

const talkRequest = (extra: Partial<TalkRequest> = {}): TalkRequest => ({
  runId: "try-1",
  agentId: "ops",
  text: "지금 할 수 있는 일을 한 줄로 말해 줘",
  signal: new AbortController().signal,
  ...extra,
});

const gc = (fake: FakeFetch, extra: Record<string, unknown> = {}) =>
  goClawConnector.connect(
    goClawConnector.schema.parse({
      kind: "goclaw",
      id: "gc",
      name: "GoClaw",
      url: "http://goclaw.test",
      ...extra,
    }),
    { env: {}, fetch: fake.fetch },
  );

const row = (n: number, status = "active") => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  agent_key: `agent-${n}`,
  display_name: `에이전트 ${n}`,
  status,
});

describe("the agent list says what it left out and why [REQ-079]", () => {
  test("37 agents, one active: the other 36 are counted under the reason the gateway gave", async () => {
    const rows = [row(0), ...Array.from({ length: 36 }, (_, i) => row(i + 1, "inactive"))];
    const port = gc(new FakeFetch().on("GET", /^\/v1\/agents$/, () => json({ agents: rows })));
    const inv = await port.inventory?.();
    expect(inv?.shown.map((a) => a.id)).toEqual(["agent-0"]);
    expect(inv?.hidden).toHaveLength(1);
    expect(inv?.hidden[0]?.reason).toBe("status inactive");
    expect(inv?.hidden[0]?.agents).toHaveLength(36);
    expect(inv?.hidden[0]?.agents[0]).toMatchObject({ hidden: "status inactive" });
    expect((await port.agents()).map((a) => a.id)).toEqual(["agent-0"]);
  });

  test("different statuses are different reasons; the user-id hint appears when almost nothing is visible", async () => {
    const rows = [row(1), row(2, "summoning"), row(3, "summon_failed"), row(4, "inactive")];
    const port = gc(
      new FakeFetch().on("GET", /^\/v1\/agents$/, () => json({ agents: rows })),
      {
        userId: "terrarium",
      },
    );
    const inv = await port.inventory?.();
    expect(inv?.hidden.map((h) => h.reason).sort()).toEqual([
      "status inactive",
      "status summon_failed",
      "status summoning",
    ]);
    expect(inv?.notes?.[0]).toContain("'terrarium'");
    expect(inv?.notes?.[1]).toContain("system");
  });

  test("with several visible agents there is nothing to warn about", async () => {
    const rows = [row(1), row(2), row(3)];
    const port = gc(new FakeFetch().on("GET", /^\/v1\/agents$/, () => json({ agents: rows })));
    expect((await port.inventory?.())?.notes).toEqual([]);
  });

  test("showing everything lists the left-out agents too, each marked with why", async () => {
    const rows = [row(1), row(2, "inactive")];
    const port = gc(
      new FakeFetch().on("GET", /^\/v1\/agents$/, () => json({ agents: rows })),
      {
        showHidden: true,
      },
    );
    const all = await port.agents();
    expect(all.map((a) => [a.id, a.hidden])).toEqual([
      ["agent-1", undefined],
      ["agent-2", "status inactive"],
    ]);
    expect((await port.inventory?.())?.includesHidden).toBe(true);
  });

  test("nothing at all is told as what came back: an empty array, or no array", async () => {
    const empty = gc(new FakeFetch().on("GET", /^\/v1\/agents$/, () => json({ agents: [] })));
    expect((await empty.inventory?.())?.empty).toBe("응답의 agents 배열이 비어 있어요");
    const odd = gc(new FakeFetch().on("GET", /^\/v1\/agents$/, () => json({ items: [row(1)] })));
    expect((await odd.inventory?.())?.empty).toBe("응답에 agents 배열이 없어요(받은 것: items)");
  });

  test("a gateway that pages by cursor or by total and offset is followed to the end", async () => {
    const byCursor = new FakeFetch().on("GET", /^\/v1\/agents$/, (req) => {
      const cursor = new URL(req.url).searchParams.get("cursor");
      return cursor === null
        ? json({ agents: [row(1), row(2)], next_cursor: "c2" })
        : json({ agents: [row(3)] });
    });
    expect((await gc(byCursor).agents()).map((a) => a.id)).toEqual([
      "agent-1",
      "agent-2",
      "agent-3",
    ]);
    expect(byCursor.requests.map((r) => new URL(r.url).search)).toEqual(["", "?cursor=c2"]);

    const byOffset = new FakeFetch().on("GET", /^\/v1\/agents$/, (req) => {
      const offset = Number(new URL(req.url).searchParams.get("offset") ?? 0);
      return json({ agents: [row(offset + 1), row(offset + 2)].slice(0, 2), total: 4 });
    });
    expect((await gc(byOffset).agents()).map((a) => a.id)).toEqual([
      "agent-1",
      "agent-2",
      "agent-3",
      "agent-4",
    ]);
  });

  test("a gateway that repeats its page does not loop forever", async () => {
    const fake = new FakeFetch().on("GET", /^\/v1\/agents$/, () =>
      json({ agents: [row(1)], has_more: true }),
    );
    expect((await gc(fake).agents()).map((a) => a.id)).toEqual(["agent-1"]);
    expect(fake.requests).toHaveLength(2);
  });

  test("OpenCode's helper agents and subagents are counted under their own reasons", async () => {
    const fake = new FakeFetch().on("GET", /^\/agent$/, () =>
      json([
        { name: "build", mode: "primary" },
        { name: "title", mode: "primary", hidden: true },
        { name: "explore", mode: "subagent" },
      ]),
    );
    const oc = openCodeConnector.connect(
      openCodeConnector.schema.parse({
        kind: "opencode",
        id: "oc",
        name: "OC",
        url: "http://oc.test",
      }),
      { env: {}, fetch: fake.fetch },
    );
    const inv = await oc.inventory?.();
    expect(inv?.shown.map((a) => a.id)).toEqual(["build"]);
    expect(inv?.hidden.map((h) => [h.reason, h.agents.map((a) => a.id)])).toEqual([
      ["hidden helper", ["title"]],
      ["mode subagent", ["explore"]],
    ]);
  });
});

describe("one question to one agent, with no tools [REQ-079]", () => {
  test("GoClaw: a chat request with the trace headers, and the answer, model and tokens", async () => {
    const fake = new FakeFetch().on("POST", /^\/v1\/chat\/completions$/, () =>
      json({
        model: "qwen3",
        choices: [{ message: { content: "서버 상태를 봐요." } }],
        usage: { prompt_tokens: 12, completion_tokens: 6 },
      }),
    );
    const reply = await gc(fake).talk?.(
      talkRequest({
        telemetry: {
          traceparent: "00-aaaa-bbbb-01",
          headers: { traceparent: "00-aaaa-bbbb-01", "x-terrarium-run-id": "try-1" },
          tags: { run_id: "try-1" },
        },
      }),
    );
    expect(reply).toEqual({
      text: "서버 상태를 봐요.",
      model: "qwen3",
      inputTokens: 12,
      outputTokens: 6,
      toolCalls: 0,
    });
    const sent = fake.requests[0];
    expect(sent?.body).toMatchObject({ model: "goclaw:ops", stream: false });
    expect((sent?.body as { tools?: unknown }).tools).toBeUndefined();
    expect(sent?.headers["x-terrarium-run-id"]).toBe("try-1");
    expect(sent?.headers.traceparent).toBe("00-aaaa-bbbb-01");
  });

  test("a refused request is an error that says the status and what the gateway said", async () => {
    const fake = new FakeFetch().on(
      "POST",
      /^\/v1\/chat\/completions$/,
      () => new Response("bad token", { status: 401 }),
    );
    await expect(gc(fake).talk?.(talkRequest())).rejects.toThrow(
      "채팅 요청에 401로 답했어요: bad token",
    );
  });

  test("OpenClaw: the same chat request under its own model name", async () => {
    const fake = new FakeFetch().on("POST", /^\/v1\/chat\/completions$/, () =>
      json({ choices: [{ message: { content: [{ type: "text", text: "안녕" }] } }] }),
    );
    const port = openClawConnector.connect(
      openClawConnector.schema.parse({
        kind: "openclaw",
        id: "oc",
        name: "OC",
        url: "http://claw.test",
      }),
      { env: {}, fetch: fake.fetch },
    );
    expect((await port.talk?.(talkRequest({ agentId: "default" })))?.text).toBe("안녕");
    expect(fake.requests[0]?.body).toMatchObject({ model: "openclaw/default" });
  });

  test("OpenCode: a session of its own, the agent asked once, the session removed", async () => {
    let polls = 0;
    const fake = new FakeFetch()
      .on("POST", /^\/session$/, () => json({ id: "s1" }))
      .on("POST", /\/prompt_async$/, () => new Response(null, { status: 204 }))
      .on("GET", /^\/session\/status$/, () => json(++polls <= 1 ? { s1: { type: "busy" } } : {}))
      .on("GET", /^\/session\/s1\/message$/, () =>
        json([
          {
            info: {
              role: "assistant",
              providerID: "anthropic",
              modelID: "claude-x",
              tokens: { input: 5, output: 2 },
            },
            parts: [{ type: "tool" }, { type: "text", text: "코드를 읽어요" }],
          },
        ]),
      )
      .on("DELETE", /^\/session\/s1$/, () => json(true));
    const port = openCodeConnector.connect(
      openCodeConnector.schema.parse({
        kind: "opencode",
        id: "oc",
        name: "OC",
        url: "http://oc.test",
        pollSeconds: 0.05,
      }),
      { env: {}, fetch: fake.fetch },
    );
    const reply = await port.talk?.(talkRequest({ agentId: "build" }));
    expect(reply).toMatchObject({
      text: "코드를 읽어요",
      model: "anthropic/claude-x",
      toolCalls: 1,
    });
    expect(fake.requests.at(-1)).toMatchObject({ method: "DELETE" });
    expect(fake.requests.some((r) => r.url.endsWith("/mcp"))).toBe(false);
  });

  test("an HTTP API reads the answer where the form says, and says when it is not there", async () => {
    const fake = new FakeFetch().on("POST", /^\/ask$/, () => json({ text: "네", extra: 1 }));
    const make = (extra: object) =>
      httpTemplateConnector.connect(
        httpTemplateConnector.schema.parse({
          kind: "http-template",
          id: "api",
          name: "API",
          url: "http://api.test",
          startPath: "/ask",
          startBody: '{"prompt": "{{prompt}}"}',
          ...extra,
        }),
        { env: {}, fetch: fake.fetch },
      );
    expect((await make({ replyPointer: "/text" }).talk?.(talkRequest()))?.text).toBe("네");
    expect(fake.requests[0]?.body).toEqual({ prompt: "지금 할 수 있는 일을 한 줄로 말해 줘" });
    await expect(make({ replyPointer: "/missing" }).talk?.(talkRequest())).rejects.toThrow(
      "답에서 /missing 자리를 찾지 못했어요",
    );
    expect((await make({}).talk?.(talkRequest()))?.text).toBe('{"text":"네","extra":1}');
    await expect(
      make({ mode: "poll", statusPath: "/s", statusPointer: "/s" }).talk?.(talkRequest()),
    ).rejects.toThrow("poll");
  });

  test("the presets say what they send, and the template they stand for is a valid setting", () => {
    const presets = httpTemplateConnector.spec.presets ?? [];
    expect(presets.map((p) => p.key)).toEqual(["openai", "simple"]);
    for (const p of presets) {
      expect(p.promise.request.length).toBeGreaterThan(10);
      const startBody = String(p.fixed.startBody).replace("[[model]]", "gpt-4o");
      const parsed = httpTemplateConnector.schema.safeParse({
        kind: "http-template",
        id: "x",
        name: "x",
        url: "http://a.test",
        startBody,
        replyPointer: p.fixed.replyPointer,
        preset: p.fixed.preset,
      });
      expect(parsed.success).toBe(true);
    }
  });
});
