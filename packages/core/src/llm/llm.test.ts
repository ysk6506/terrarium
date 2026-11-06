import { describe, expect, test } from "vitest";
import { ANTHROPIC_VERSION, checkLlm, createLlmClient, type FetchLike, joinUrl, LlmError } from ".";

interface Seen {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: Record<string, unknown>;
}

type Reply = Response | Error | ((seen: Seen) => Response | Error);

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const status = (code: number) => new Response("{}", { status: code });

/** A fetch that answers from a script by path and remembers what it was asked. */
function fake(script: Record<string, Reply>) {
  const seen: Seen[] = [];
  const fetch: FetchLike = async (url, init) => {
    const record: Seen = {
      url,
      method: init.method ?? "GET",
      headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)),
      ...(init.body ? { body: JSON.parse(String(init.body)) } : {}),
    };
    seen.push(record);
    const path = new URL(url).pathname;
    const reply = script[path] ?? status(404);
    const out = typeof reply === "function" ? reply(record) : reply;
    if (out instanceof Error) throw out;
    return out.clone();
  };
  return { fetch, seen };
}

describe("addresses are joined without doubling /v1 [REQ-099]", () => {
  test.each([
    ["https://api.openai.com", "/v1/models", "https://api.openai.com/v1/models"],
    ["https://api.openai.com/v1", "/v1/models", "https://api.openai.com/v1/models"],
    ["https://gw.corp/llm/", "/v1/chat/completions", "https://gw.corp/llm/v1/chat/completions"],
    ["https://gw.corp/v1/", "/model/info", "https://gw.corp/model/info"],
  ])("%s + %s", (base, path, expected) => {
    expect(joinUrl(base, path)).toBe(expected);
  });
});

describe("the OpenAI-compatible client asks the way OpenAI does [REQ-099]", () => {
  test("listModels is GET /v1/models with a bearer key and extra headers winning over defaults", async () => {
    const { fetch, seen } = fake({
      "/v1/models": ok({ data: [{ id: "gpt-a" }, { id: "gpt-b" }] }),
    });
    const client = createLlmClient("openai", {
      baseUrl: "https://llm.example.com",
      apiKey: "sk-test-1234",
      headers: { "X-Team": "dc", accept: "text/plain" },
      fetch,
    });
    expect(await client.listModels()).toEqual(["gpt-a", "gpt-b"]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: "GET", url: "https://llm.example.com/v1/models" });
    expect(seen[0]?.headers).toMatchObject({
      authorization: "Bearer sk-test-1234",
      "X-Team": "dc",
      accept: "text/plain",
    });
  });

  test("complete is POST /v1/chat/completions; the system text becomes the first message and usage is mapped", async () => {
    const { fetch, seen } = fake({
      "/v1/chat/completions": ok({
        choices: [{ message: { content: "안녕" } }],
        usage: { prompt_tokens: 7, completion_tokens: 2 },
      }),
    });
    const client = createLlmClient("openai", { baseUrl: "https://x.test/v1", model: "m1", fetch });
    const out = await client.complete({
      system: "짧게",
      messages: [{ role: "user", content: "안녕?" }],
      maxTokens: 5,
    });
    expect(out).toEqual({ text: "안녕", usage: { inputTokens: 7, outputTokens: 2 } });
    expect(seen[0]?.url).toBe("https://x.test/v1/chat/completions");
    expect(seen[0]?.body).toEqual({
      model: "m1",
      messages: [
        { role: "system", content: "짧게" },
        { role: "user", content: "안녕?" },
      ],
      max_tokens: 5,
    });
    expect(seen[0]?.headers.authorization).toBeUndefined();
  });

  test("a gateway that answers with a list of text parts is read too", async () => {
    const { fetch } = fake({
      "/v1/chat/completions": ok({
        choices: [{ message: { content: [{ text: "가" }, { text: "나" }] } }],
      }),
    });
    const client = createLlmClient("openai", { baseUrl: "https://x.test", model: "m", fetch });
    expect((await client.complete({ messages: [{ role: "user", content: "." }] })).text).toBe(
      "가나",
    );
  });

  test("a call without any model name is refused before anything is sent", async () => {
    const { fetch, seen } = fake({});
    const client = createLlmClient("openai", { baseUrl: "https://x.test", fetch });
    await expect(client.complete({ messages: [] })).rejects.toBeInstanceOf(LlmError);
    expect(seen).toHaveLength(0);
  });
});

describe("LiteLLM reads its model list from either place [REQ-099]", () => {
  test("/v1/models first; when that path is not there, /model/info", async () => {
    const { fetch, seen } = fake({
      "/model/info": ok({
        data: [{ model_name: "claude-gw" }, { model_name: "gpt-gw" }, { model_name: "gpt-gw" }],
      }),
    });
    const client = createLlmClient("litellm", {
      baseUrl: "https://lite.corp",
      apiKey: "sk-1",
      fetch,
    });
    expect(await client.listModels()).toEqual(["claude-gw", "gpt-gw"]);
    expect(seen.map((s) => new URL(s.url).pathname)).toEqual(["/v1/models", "/model/info"]);
  });

  test("a rejected key stops at the first path: the second would say the same", async () => {
    const { fetch, seen } = fake({
      "/v1/models": status(401),
      "/model/info": ok({ data: [{ model_name: "x" }] }),
    });
    const client = createLlmClient("litellm", { baseUrl: "https://lite.corp", fetch });
    await expect(client.listModels()).rejects.toMatchObject({ reason: "auth", status: 401 });
    expect(seen).toHaveLength(1);
  });

  test("plain OpenAI never tries /model/info", async () => {
    const { fetch, seen } = fake({ "/model/info": ok({ data: [{ model_name: "x" }] }) });
    const client = createLlmClient("openai", { baseUrl: "https://a.test", fetch });
    await expect(client.listModels()).rejects.toMatchObject({ reason: "address", status: 404 });
    expect(seen).toHaveLength(1);
  });
});

describe("the Claude-compatible client asks the way Anthropic does [REQ-099]", () => {
  test("listModels is GET /v1/models with x-api-key and anthropic-version, no bearer", async () => {
    const { fetch, seen } = fake({ "/v1/models": ok({ data: [{ id: "claude-a" }] }) });
    const client = createLlmClient("anthropic", {
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant-9999",
      fetch,
    });
    expect(await client.listModels()).toEqual(["claude-a"]);
    expect(seen[0]?.url).toBe("https://api.anthropic.com/v1/models?limit=1000");
    expect(seen[0]?.headers).toMatchObject({
      "x-api-key": "sk-ant-9999",
      "anthropic-version": ANTHROPIC_VERSION,
    });
    expect(seen[0]?.headers.authorization).toBeUndefined();
  });

  test("complete is POST /v1/messages with max_tokens, a top-level system, and text blocks joined", async () => {
    const { fetch, seen } = fake({
      "/v1/messages": ok({
        content: [{ type: "text", text: "가" }, { type: "tool_use" }, { type: "text", text: "나" }],
        usage: { input_tokens: 3, output_tokens: 1 },
      }),
    });
    const client = createLlmClient("anthropic", {
      baseUrl: "https://gw.test/v1",
      model: "claude-a",
      fetch,
    });
    const out = await client.complete({
      system: "짧게",
      messages: [{ role: "user", content: "?" }],
    });
    expect(out).toEqual({ text: "가나", usage: { inputTokens: 3, outputTokens: 1 } });
    expect(seen[0]?.url).toBe("https://gw.test/v1/messages");
    expect(seen[0]?.body).toEqual({
      model: "claude-a",
      max_tokens: 1024,
      system: "짧게",
      messages: [{ role: "user", content: "?" }],
    });
  });
});

describe("failures are told apart and never repeat the other side's words [REQ-099]", () => {
  const client = (reply: Reply) =>
    createLlmClient("openai", {
      baseUrl: "https://x.test",
      fetch: fake({ "/v1/models": reply }).fetch,
    });

  test.each([
    [401, "auth"],
    [403, "auth"],
    [404, "address"],
    [429, "rate"],
    [503, "server"],
    [418, "other"],
  ] as const)("HTTP %i is %s", async (code, reason) => {
    await expect(client(status(code)).listModels()).rejects.toMatchObject({ reason, status: code });
  });

  test("a name that does not resolve is an address problem; any other thrown error is a network problem", async () => {
    const dns = Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    await expect(client(dns).listModels()).rejects.toMatchObject({ reason: "address" });
    await expect(client(new TypeError("fetch failed")).listModels()).rejects.toMatchObject({
      reason: "network",
    });
  });

  test("a request that takes too long is a timeout", async () => {
    const slow: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) =>
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        ),
      );
    const c = createLlmClient("openai", { baseUrl: "https://x.test", fetch: slow, timeoutMs: 20 });
    await expect(c.listModels()).rejects.toMatchObject({ reason: "timeout" });
  });

  test("the error text is ours: a key inside the thrown error or the body never reaches it", async () => {
    const leaky = new Error("connect failed for Authorization: Bearer sk-secret-0000");
    const err = await client(leaky)
      .listModels()
      .catch((e: Error) => e);
    expect(String((err as Error).message)).not.toContain("sk-secret");
    const bodyLeak = new Response("bad key sk-secret-0000", { status: 401 });
    const err2 = await client(bodyLeak)
      .listModels()
      .catch((e: Error) => e);
    expect(String((err2 as Error).message)).not.toContain("sk-secret");
  });

  test("a 200 with no models is no-models", async () => {
    await expect(client(ok({ data: [] })).listModels()).rejects.toMatchObject({
      reason: "no-models",
    });
  });
});

describe("연결 확인 reads the list, then tries one short completion [REQ-099]", () => {
  let t = 1000;
  const now = () => {
    t += 50;
    return t;
  };

  test("the list answers: ok with the time and the count, no completion is made", async () => {
    const { fetch, seen } = fake({ "/v1/models": ok({ data: [{ id: "a" }, { id: "b" }] }) });
    const c = createLlmClient("openai", { baseUrl: "https://x.test", fetch });
    const out = await checkLlm(c, { now, model: "a" });
    expect(out).toMatchObject({
      ok: true,
      via: "models",
      modelCount: 2,
      models: ["a", "b"],
      ms: 50,
    });
    expect(seen).toHaveLength(1);
  });

  test("the list fails but a one-token completion answers: ok via completion with max_tokens 1", async () => {
    const { fetch, seen } = fake({
      "/v1/chat/completions": ok({ choices: [{ message: { content: "." } }] }),
    });
    const c = createLlmClient("openai", { baseUrl: "https://x.test", fetch });
    const out = await checkLlm(c, { now, model: "m" });
    expect(out).toMatchObject({ ok: true, via: "completion", models: [] });
    expect(seen.at(-1)?.body).toMatchObject({ model: "m", max_tokens: 1 });
  });

  test("without a model name, a failed list is the answer: it says what to do", async () => {
    const { fetch, seen } = fake({});
    const c = createLlmClient("openai", { baseUrl: "https://x.test", fetch });
    const out = await checkLlm(c, { now });
    expect(out).toMatchObject({ ok: false, reason: "address" });
    expect(seen).toHaveLength(1);
  });

  test("a key the list refused but the completion also refuses is reported as the completion's failure", async () => {
    const { fetch } = fake({ "/v1/models": status(401), "/v1/chat/completions": status(401) });
    const c = createLlmClient("openai", { baseUrl: "https://x.test", fetch });
    const out = await checkLlm(c, { now, model: "m" });
    expect(out).toMatchObject({ ok: false, reason: "auth" });
    expect(out.error).toContain("401");
  });

  test("a server that cannot get out is told so once: no second request", async () => {
    const { fetch, seen } = fake({ "/v1/models": new TypeError("fetch failed") });
    const c = createLlmClient("openai", { baseUrl: "https://x.test", fetch });
    const out = await checkLlm(c, { now, model: "m" });
    expect(out).toMatchObject({ ok: false, reason: "network" });
    expect(out.error).toContain("네트워크");
    expect(seen).toHaveLength(1);
  });
});
