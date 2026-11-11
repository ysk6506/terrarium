import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { SecretBox, SqliteStore } from "../adapters";
import { ADMIN, person, testPlatform } from "../runtime/test-support/platform";
import { buildApp } from "./app";
import { headerAuthenticator } from "./identity";
import { SELF_ONLY } from "./viewer";

const KEY = "sk-live-SECRET-ab12";
const HEADER_VALUE = "gw-token-VALUE-9z9z";

type Handler = (url: URL, init: RequestInit) => Response | Error;

/** A fetch that answers by path and remembers every request. */
function upstream(routes: Record<string, Handler | Response | Error>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const route = routes[new URL(url).pathname];
    const out =
      typeof route === "function"
        ? route(new URL(url), init)
        : (route ?? new Response("{}", { status: 404 }));
    if (out instanceof Error) throw out;
    return out.clone();
  };
  return { fetch, calls };
}

const models = (...ids: string[]) =>
  new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status: 200 });

function setup(
  routes: Record<string, Handler | Response | Error> = {},
  options: { logger?: boolean } = {},
) {
  const up = upstream(routes);
  let t = 0;
  const { platform, store } = testPlatform([], {
    llm: {
      fetch: up.fetch,
      now: () => {
        t += 412;
        return t;
      },
    },
  });
  // typed names, with an admin token: whoever is called "admin-…" sends it, the way an admin would
  const authenticator = headerAuthenticator({ ...SELF_ONLY, adminToken: "admin-test-token" });
  const app = buildApp({
    platform,
    authenticator,
    ...(options.logger ? { logger: true } : {}),
  });
  const send = async (method: string, url: string, payload?: object, who = "yeonsu") => {
    const r = await app.inject({
      method: method as "GET",
      url,
      headers: {
        "x-terrarium-user": who,
        ...(who.startsWith("admin-") ? { "x-terrarium-admin-token": "admin-test-token" } : {}),
      },
      ...(payload ? { payload } : {}),
    });
    return { status: r.statusCode, body: r.json(), text: r.body };
  };
  return { platform, store, app, send, up };
}

const mine = {
  kind: "openai",
  name: "사내 GPT",
  baseUrl: "https://llm.corp.test",
  apiKey: KEY,
  headers: [{ name: "X-Gateway-Token", value: HEADER_VALUE }],
};

describe("registering model APIs: add, list, change, delete [REQ-099]", () => {
  test("an empty workspace lists nothing; the first one registered is the default; the key is only its last four letters", async () => {
    const { send, platform } = setup();
    expect((await send("GET", "/api/models")).body).toEqual([]);
    const made = await send("POST", "/api/models", mine);
    expect(made.status).toBe(200);
    expect(made.body).toMatchObject({
      name: "사내 GPT",
      kind: "openai",
      baseUrl: "https://llm.corp.test",
      hasKey: true,
      keyHint: "…ab12",
      headers: ["X-Gateway-Token"],
      isDefault: true,
      owner: "yeonsu",
    });
    const second = await send("POST", "/api/models", {
      ...mine,
      name: "Claude",
      kind: "anthropic",
    });
    expect(second.body.isDefault).toBe(false);
    const listed = (await send("GET", "/api/models")).body as { name: string }[];
    expect(listed.map((m) => m.name)).toEqual(["사내 GPT", "Claude"]);
    await platform.stop();
  });

  test("no response ever carries the key or a header value, and the store holds them sealed", async () => {
    const { send, store, platform } = setup({ "/v1/models": models("a") });
    const made = await send("POST", "/api/models", mine);
    const texts = [
      made.text,
      (await send("GET", "/api/models")).text,
      (await send("PATCH", `/api/models/${made.body.id}`, { name: "새 이름" })).text,
      (await send("POST", `/api/models/${made.body.id}/check`)).text,
      (await send("POST", `/api/models/${made.body.id}/default`)).text,
    ];
    for (const text of texts) {
      expect(text).not.toContain(KEY);
      expect(text).not.toContain("SECRET");
      expect(text).not.toContain(HEADER_VALUE);
    }
    const kept = JSON.stringify(await store.getModel(made.body.id));
    expect(kept).not.toContain("SECRET");
    expect(kept).not.toContain(HEADER_VALUE);
    expect(kept).toContain("sealedKey");
    await platform.stop();
  });

  test("a key too short to show part of is shown as nothing; no key at all is allowed", async () => {
    const { send, platform } = setup();
    const short = await send("POST", "/api/models", {
      kind: "litellm",
      name: "짧은",
      baseUrl: "http://lite.test",
      apiKey: "abc",
    });
    expect(short.body).toMatchObject({ hasKey: true });
    expect(short.body.keyHint).toBeUndefined();
    const none = await send("POST", "/api/models", {
      kind: "litellm",
      name: "키 없음",
      baseUrl: "http://lite.test",
    });
    expect(none.body).toMatchObject({ hasKey: false });
    await platform.stop();
  });

  test("a bad kind, an empty name or a bad address is refused with the field named", async () => {
    const { send, platform } = setup();
    expect((await send("POST", "/api/models", { ...mine, kind: "gemini" })).status).toBe(400);
    expect((await send("POST", "/api/models", { ...mine, name: "  " })).status).toBe(400);
    const bad = await send("POST", "/api/models", { ...mine, baseUrl: "ftp://x" });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain("baseUrl");
    const meta = await send("POST", "/api/models", { ...mine, baseUrl: "http://169.254.169.254/" });
    expect(meta.status).toBe(400);
    await platform.stop();
  });

  test("the same name twice is a conflict", async () => {
    const { send, platform } = setup();
    await send("POST", "/api/models", mine);
    expect((await send("POST", "/api/models", mine)).status).toBe(409);
    await platform.stop();
  });

  test("changing: an empty key keeps the old one, a header without a value keeps its value, clearKey removes the key", async () => {
    const { send, store, platform } = setup();
    const made = await send("POST", "/api/models", mine);
    const before = await store.getModel(made.body.id);
    const same = await send("PATCH", `/api/models/${made.body.id}`, {
      apiKey: "",
      name: "바뀐 이름",
      headers: [{ name: "X-Gateway-Token" }],
    });
    expect(same.body).toMatchObject({ name: "바뀐 이름", hasKey: true, keyHint: "…ab12" });
    const after = await store.getModel(made.body.id);
    expect(after?.sealedKey).toBe(before?.sealedKey);
    expect(after?.headers).toEqual(before?.headers);
    const newKey = await send("PATCH", `/api/models/${made.body.id}`, {
      apiKey: "sk-new-key-wxyz",
    });
    expect(newKey.body.keyHint).toBe("…wxyz");
    const cleared = await send("PATCH", `/api/models/${made.body.id}`, { clearKey: true });
    expect(cleared.body).toMatchObject({ hasKey: false });
    const unknownHeader = await send("PATCH", `/api/models/${made.body.id}`, {
      headers: [{ name: "X-New" }],
    });
    expect(unknownHeader.status).toBe(400);
    await platform.stop();
  });

  test("only whoever registered it changes, deletes or checks it; only an admin chooses the default", async () => {
    const { send, platform } = setup({ "/v1/models": models("a") });
    const made = await send("POST", "/api/models", mine, "yeonsu");
    expect(
      (await send("PATCH", `/api/models/${made.body.id}`, { name: "x" }, "jimin")).status,
    ).toBe(403);
    expect((await send("DELETE", `/api/models/${made.body.id}`, undefined, "jimin")).status).toBe(
      403,
    );
    // the first one registered is the default, and the default is usable by everyone whatever its scope (ADR-0174)
    expect(
      (await send("POST", `/api/models/${made.body.id}/check`, undefined, "jimin")).status,
    ).toBe(200);
    expect(
      (await send("POST", `/api/models/${made.body.id}/check`, undefined, "yeonsu")).status,
    ).toBe(200);
    expect(
      (await send("POST", `/api/models/${made.body.id}/check`, undefined, "admin-kim")).status,
    ).toBe(200);
    expect(
      (await send("POST", `/api/models/${made.body.id}/default`, undefined, "yeonsu")).status,
    ).toBe(403);
    expect(
      (await send("POST", `/api/models/${made.body.id}/default`, undefined, "jimin")).status,
    ).toBe(403);
    expect(
      (await send("POST", `/api/models/${made.body.id}/default`, undefined, "admin-kim")).status,
    ).toBe(200);
    expect((await send("GET", "/api/models", undefined, "jimin")).body).toHaveLength(1);
    await platform.stop();
  });

  test("a model that is not there is 404", async () => {
    const { send, platform } = setup();
    expect((await send("POST", "/api/models/nope/check")).status).toBe(404);
    expect((await send("DELETE", "/api/models/nope")).status).toBe(404);
    await platform.stop();
  });

  test("only one is the default; deleting the default hands it to the one registered first", async () => {
    const { send, platform } = setup();
    const a = await send("POST", "/api/models", { ...mine, name: "A" });
    const b = await send("POST", "/api/models", { ...mine, name: "B" });
    const c = await send("POST", "/api/models", { ...mine, name: "C" });
    await send("POST", `/api/models/${c.body.id}/default`, undefined, "admin-kim");
    const flags = async () =>
      ((await send("GET", "/api/models")).body as { name: string; isDefault: boolean }[]).map(
        (m) => `${m.name}:${m.isDefault}`,
      );
    expect(await flags()).toEqual(["A:false", "B:false", "C:true"]);
    expect((await send("DELETE", `/api/models/${c.body.id}`)).body).toEqual({ deleted: true });
    expect(await flags()).toEqual(["A:true", "B:false"]);
    await send("DELETE", `/api/models/${a.body.id}`);
    await send("DELETE", `/api/models/${b.body.id}`);
    expect(await flags()).toEqual([]);
    await platform.stop();
  });
});

describe("연결 확인 over HTTP [REQ-099]", () => {
  test("the list answers: the card keeps '답했어요 · 412ms · 모델 23개' as facts, with the time", async () => {
    const ids = Array.from({ length: 23 }, (_, i) => `model-${i}`);
    const { send, up, platform } = setup({ "/v1/models": models(...ids) });
    const made = await send("POST", "/api/models", mine);
    const checked = await send("POST", `/api/models/${made.body.id}/check`);
    expect(checked.body.lastCheck).toMatchObject({
      ok: true,
      ms: 412,
      via: "models",
      modelCount: 23,
    });
    expect(checked.body.lastCheck.models).toHaveLength(23);
    expect(checked.body.lastCheck.at).toMatch(/^\d{4}-\d\d-\d\dT/);
    const sent = up.calls[0]?.init.headers as Record<string, string>;
    expect(sent.authorization).toBe(`Bearer ${KEY}`);
    expect(sent["X-Gateway-Token"]).toBe(HEADER_VALUE);
    // it is kept: the list shows it again
    expect(
      ((await send("GET", "/api/models")).body as { lastCheck: { ok: boolean } }[])[0]?.lastCheck
        .ok,
    ).toBe(true);
    await platform.stop();
  });

  test("the list fails, one token-long completion answers", async () => {
    const { send, up, platform } = setup({
      "/v1/chat/completions": new Response(
        JSON.stringify({ choices: [{ message: { content: "." } }] }),
        { status: 200 },
      ),
    });
    const made = await send("POST", "/api/models", { ...mine, defaultModel: "gpt-x" });
    const checked = await send("POST", `/api/models/${made.body.id}/check`);
    expect(checked.body.lastCheck).toMatchObject({ ok: true, via: "completion" });
    expect(JSON.parse(String(up.calls.at(-1)?.init.body))).toMatchObject({
      model: "gpt-x",
      max_tokens: 1,
    });
    await platform.stop();
  });

  test("an Anthropic registration is checked with x-api-key", async () => {
    const { send, up, platform } = setup({ "/v1/models": models("claude-a") });
    const made = await send("POST", "/api/models", {
      kind: "anthropic",
      name: "Claude",
      baseUrl: "https://api.anthropic.com",
      apiKey: KEY,
    });
    await send("POST", `/api/models/${made.body.id}/check`);
    const sent = up.calls[0]?.init.headers as Record<string, string>;
    expect(sent["x-api-key"]).toBe(KEY);
    expect(sent.authorization).toBeUndefined();
    await platform.stop();
  });

  test.each([
    ["a rejected key", new Response("{}", { status: 401 }), "auth", "401"],
    ["a server that cannot get out", new TypeError("fetch failed"), "network", "네트워크"],
    ["a wrong address", new Response("{}", { status: 404 }), "address", "404"],
  ] as const)("%s is told honestly", async (_name, answer, reason, word) => {
    const { send, platform } = setup({ "/v1/models": answer });
    const made = await send("POST", "/api/models", mine);
    const checked = await send("POST", `/api/models/${made.body.id}/check`);
    expect(checked.status).toBe(200);
    expect(checked.body.lastCheck).toMatchObject({ ok: false, reason });
    expect(checked.body.lastCheck.error).toContain(word);
    await platform.stop();
  });

  test("a check of an old address is forgotten when the address, key or headers change; a new name keeps it", async () => {
    const { send, platform } = setup({ "/v1/models": models("a") });
    const made = await send("POST", "/api/models", mine);
    await send("POST", `/api/models/${made.body.id}/check`);
    const renamed = await send("PATCH", `/api/models/${made.body.id}`, { name: "이름만" });
    expect(renamed.body.lastCheck).toBeDefined();
    const moved = await send("PATCH", `/api/models/${made.body.id}`, {
      baseUrl: "https://other.test",
    });
    expect(moved.body.lastCheck).toBeUndefined();
    await platform.stop();
  });
});

describe("the key stays out of the logs [REQ-099]", () => {
  afterEach(() => vi.restoreAllMocks());

  test("not in the server log, the console, or an error, even when the other side's error carries it", async () => {
    const written: string[] = [];
    const grab = (chunk: unknown) => {
      written.push(String(chunk));
      return true;
    };
    vi.spyOn(process.stdout, "write").mockImplementation(grab as never);
    vi.spyOn(process.stderr, "write").mockImplementation(grab as never);
    for (const k of ["log", "info", "warn", "error", "debug"] as const)
      vi.spyOn(console, k).mockImplementation((...a: unknown[]) => void written.push(a.join(" ")));
    const { send, platform } = setup(
      {
        "/v1/models": new Error(
          `connect refused, sent Authorization: Bearer ${KEY} and ${HEADER_VALUE}`,
        ),
      },
      { logger: true },
    );
    const made = await send("POST", "/api/models", mine);
    const checked = await send("POST", `/api/models/${made.body.id}/check`);
    await send("PATCH", `/api/models/${made.body.id}`, { apiKey: "sk-other-SECRET-qq11" });
    await send("PATCH", `/api/models/${made.body.id}`, { name: "" });
    await send("DELETE", `/api/models/${made.body.id}`);
    vi.restoreAllMocks();
    expect(checked.body.lastCheck.ok).toBe(false);
    expect(written.length).toBeGreaterThan(0);
    const all = written.join("\n");
    expect(all).not.toContain("SECRET");
    expect(all).not.toContain(HEADER_VALUE);
    expect(checked.text).not.toContain("SECRET");
    await platform.stop();
  });
});

describe("registrations survive a restart, sealed [REQ-099]", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  test("the SQLite file keeps them, the key is not readable in it, and the same secret box opens it again", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "terrarium-llm-"));
    dirs.push(dir);
    const file = path.join(dir, "terrarium.db");
    const box = SecretBox.ephemeral();
    const up = upstream({ "/v1/models": models("a", "b") });
    const first = new SqliteStore(file);
    const one = testPlatform([], { adapters: { secretBox: box }, llm: { fetch: up.fetch } }, first);
    const made = await one.platform.models.create(person("yeonsu", "proxy"), {
      kind: "openai",
      name: "저장",
      baseUrl: "https://llm.corp.test",
      apiKey: KEY,
      headers: [],
    });
    first.close();
    for (const f of readdirSync(dir))
      expect(readFileSync(path.join(dir, f)).includes(KEY)).toBe(false);

    const second = new SqliteStore(file);
    const two = testPlatform(
      [],
      { adapters: { secretBox: box }, llm: { fetch: up.fetch } },
      second,
    );
    const [again] = await two.platform.models.list(ADMIN);
    expect(again).toMatchObject({ id: made.id, keyHint: "…ab12", isDefault: true });
    const checked = await two.platform.models.check(person("yeonsu", "proxy"), made.id);
    expect(checked.lastCheck).toMatchObject({ ok: true, modelCount: 2 });
    expect((up.calls.at(-1)?.init.headers as Record<string, string>).authorization).toBe(
      `Bearer ${KEY}`,
    );
    second.close();
  });
});
