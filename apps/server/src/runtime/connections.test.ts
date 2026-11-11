import { ForbiddenError, InvalidInputError } from "@terrarium/core/contract";
import { MemoryStore } from "@terrarium/core/experiments";
import { ConflictError, NotFoundError } from "@terrarium/core/kernel";
import { describe, expect, test } from "vitest";
import { FakeFetch, json } from "../adapters/test-support/fake-fetch";
import { addressProblem } from "./connections";
import {
  JIMIN,
  recipe,
  ScriptHarness,
  seed,
  testPlatform,
  untilStopped,
  YEONSU,
} from "./test-support/platform";

const AGENTS = [
  { id: "triage", name: "분류 에이전트", model: "m-1" },
  { id: "fixer", name: "수리 에이전트" },
];

/** A platform whose connections reach a fake harness at https://harness.test. */
function setup(env: Record<string, string> = { HARNESS_TOKEN: "t" }) {
  const fake = new FakeFetch().on("GET", /^\/agents$/, () => json({ agents: AGENTS }));
  const store = new MemoryStore();
  const built = testPlatform([], { adapters: { connect: { env, fetch: fake.fetch } } }, store);
  return { ...built, fake, env };
}

const harness = { connector: "http", name: "회사 하네스", config: { url: "https://harness.test" } };

describe("the connections people register, and the ones the config file names [REQ-051]", () => {
  test("a fresh server lists the built-in agent as a read-only connection", async () => {
    const { platform } = setup();
    const [builtin] = await platform.connections.views();
    expect(builtin).toMatchObject({
      id: "builtin",
      source: "config",
      connector: "scripted",
      scope: "harness",
      status: "ok",
    });
    expect(builtin?.agents.length).toBeGreaterThan(0);
    expect(builtin?.owner).toBeUndefined();
  });

  test("connecting a harness finds its agents, and they can be chosen in an experiment", async () => {
    const { platform } = setup();
    const view = await platform.connections.create(YEONSU, harness);
    expect(view).toMatchObject({
      id: expect.any(String),
      source: "screen",
      owner: "yeonsu",
      connector: "http",
      scope: "harness",
      status: "ok",
    });
    expect(view.agents.map((a) => a.id)).toEqual(["triage", "fixer"]);

    const meta = await platform.meta(YEONSU);
    expect(meta.harnesses.find((h) => h.id === view.id)?.agents).toHaveLength(2);

    const { world, scenario } = await seed(platform);
    await expect(
      platform.experiments.create(YEONSU, {
        name: "연결한 하네스",
        recipe: recipe(world.id, scenario.id, { harnessId: view.id, agentId: "chef" }),
      }),
    ).rejects.toMatchObject({ issues: [{ message: "하네스에 'chef' 에이전트가 없어요" }] });
    const made = await platform.experiments.create(YEONSU, {
      name: "연결한 하네스",
      recipe: recipe(world.id, scenario.id, { harnessId: view.id, agentId: "fixer" }),
    });
    expect(made.experiment.recipe.harnessId).toBe(view.id);
  });

  test("trying a connection reports the agents it found and the time it took, and saves nothing", async () => {
    const { platform } = setup();
    const checked = await platform.connections.check(YEONSU, {
      connector: "http",
      config: harness.config,
    });
    expect(checked).toMatchObject({ ok: true, notes: [] });
    expect(checked.agents).toHaveLength(2);
    expect(checked.ms).toBeGreaterThanOrEqual(0);
    expect(await platform.connections.views()).toHaveLength(1);
  });

  test("a harness that answers badly, or finds nothing, is told apart from a wrong form", async () => {
    const down = new FakeFetch().on(
      "GET",
      /^\/agents$/,
      () => new Response("boom", { status: 502 }),
    );
    const a = testPlatform([], { adapters: { connect: { env: {}, fetch: down.fetch } } });
    expect(
      await a.platform.connections.check(YEONSU, { connector: "http", config: harness.config }),
    ).toMatchObject({
      ok: false,
      error: "하네스가 에이전트 목록에 502로 답했어요",
      agents: [],
    });
    const none = new FakeFetch().on("GET", /^\/agents$/, () => json({ agents: [] }));
    const b = testPlatform([], { adapters: { connect: { env: {}, fetch: none.fetch } } });
    expect(
      await b.platform.connections.check(YEONSU, { connector: "http", config: harness.config }),
    ).toMatchObject({
      ok: true,
      notes: ["연결은 되지만 에이전트를 하나도 찾지 못했어요"],
    });
  });

  test("one that never answers is given up on, and shows as unreachable", async () => {
    const hang = new FakeFetch().on(
      "GET",
      /^\/agents$/,
      () => new Promise<Response>(() => undefined),
    );
    const { platform } = testPlatform([], {
      agentsTimeoutMs: 40,
      adapters: { connect: { env: {}, fetch: hang.fetch } },
    });
    const view = await platform.connections.create(YEONSU, harness);
    expect(view.status).toBe("unreachable");
    expect(view.error).toBe("0초 안에 답이 없어요");
    expect(view.agents).toEqual([]);
  });

  test("what is wrong with the form is said by field", async () => {
    const { platform } = setup();
    const wrong = (config: Record<string, unknown>, connector = "http") =>
      platform.connections.check(YEONSU, { connector, config }).catch((e: InvalidInputError) => e);
    const missing = await wrong({});
    expect(missing).toBeInstanceOf(InvalidInputError);
    expect((missing as InvalidInputError).issues.map((i) => i.path)).toContain("url");
    const extra = (await wrong({ ...harness.config, speed: 9 })) as InvalidInputError;
    expect(extra).toBeInstanceOf(InvalidInputError);
    const nope = (await wrong({}, "gopher")) as InvalidInputError;
    expect(nope.issues).toEqual([{ path: "connector", message: "연결 방식 'gopher'을 몰라요" }]);
    // An empty field on a form means "not given".
    expect(
      await platform.connections.check(YEONSU, {
        connector: "http",
        config: { ...harness.config, tokenEnv: "" },
      }),
    ).toMatchObject({ ok: true });
  });

  test("a secret is only ever the name of a variable the server has", async () => {
    const { platform, fake } = setup({ HARNESS_TOKEN: "s3cret" });
    const missing = (await platform.connections
      .check(YEONSU, { connector: "http", config: { ...harness.config, tokenEnv: "NOT_SET" } })
      .catch((e: InvalidInputError) => e)) as InvalidInputError;
    expect(missing.issues).toEqual([
      { path: "tokenEnv", message: "서버에는 'NOT_SET'라는 환경 변수가 없어요" },
    ]);
    const view = await platform.connections.create(YEONSU, {
      ...harness,
      config: { ...harness.config, tokenEnv: "HARNESS_TOKEN" },
    });
    expect(JSON.stringify(view)).not.toContain("s3cret");
    expect(fake.requests.at(-1)?.headers.authorization).toBe("Bearer s3cret");
  });

  test("a cloud's credentials address is refused; a server can allow only some hosts", async () => {
    const { platform } = setup();
    const at = (url: string) =>
      platform.connections
        .check(YEONSU, { connector: "http", config: { url } })
        .catch((e: InvalidInputError) => e.issues[0]?.message);
    expect(await at("http://169.254.169.254/latest")).toBe(
      "클라우드의 메타데이터 주소에는 연결할 수 없어요",
    );
    expect(await at("http://metadata.google.internal")).toBe(
      "클라우드의 메타데이터 주소에는 연결할 수 없어요",
    );
    expect(await at("http://2852039166")).toBe("클라우드의 메타데이터 주소에는 연결할 수 없어요");

    const strict = testPlatform([], {
      adapters: {
        connect: {
          env: {},
          fetch: new FakeFetch().on("GET", /^\/agents$/, () => json({ agents: AGENTS })).fetch,
        },
        allowedHosts: ["harness.test", "*.corp.example"],
      },
    }).platform;
    const via = (url: string) =>
      strict.connections
        .check(YEONSU, { connector: "http", config: { url } })
        .then(() => "ok")
        .catch((e: InvalidInputError) => e.issues[0]?.message);
    expect(await via("https://harness.test")).toBe("ok");
    expect(await via("https://ai.corp.example")).toBe("ok");
    expect(await via("https://evil.example")).toBe(
      "서버 설정(connections.allowedHosts)이 허용하지 않은 주소예요: evil.example",
    );
  });

  test("addresses are judged on their own: shape, scheme, host rules", () => {
    expect(addressProblem("not a url", undefined)).toBe("주소 형식이 맞지 않아요");
    expect(addressProblem("ftp://files.test", undefined)).toBe("http나 https 주소여야 해요");
    expect(addressProblem("http://[fd00:ec2::254]/", undefined)).toBe(
      "클라우드의 메타데이터 주소에는 연결할 수 없어요",
    );
    expect(addressProblem("http://10.0.0.5:8080", undefined)).toBeUndefined();
    expect(addressProblem("http://10.0.0.5", ["10.0.0.5"])).toBeUndefined();
    expect(addressProblem("http://10.0.0.6", ["10.0.0.5"])).toContain("10.0.0.6");
  });

  test("the command connector is for the config file only", async () => {
    const { platform } = setup();
    const err = (await platform.connections
      .create(YEONSU, {
        connector: "command",
        name: "내 스크립트",
        config: { command: ["agent.sh"] },
      })
      .catch((e: InvalidInputError) => e)) as InvalidInputError;
    expect(err.issues).toEqual([
      { path: "connector", message: "이 연결 방식은 서버 설정 파일에서만 더할 수 있어요" },
    ]);
  });

  test("an id comes from the name, a taken one gets a number, a chosen one that is taken is refused", async () => {
    const { platform } = setup();
    const a = await platform.connections.create(YEONSU, { ...harness, name: "My Harness" });
    const b = await platform.connections.create(YEONSU, { ...harness, name: "My Harness" });
    const c = await platform.connections.create(YEONSU, { ...harness, name: "한글 이름" });
    expect([a.id, b.id]).toEqual(["my-harness", "my-harness-2"]);
    expect(c.id).toMatch(/^c-/);
    const chosen = await platform.connections.create(YEONSU, { ...harness, name: "x", id: "mine" });
    expect(chosen.id).toBe("mine");
    for (const id of ["mine", "builtin"]) {
      const dup = (await platform.connections
        .create(YEONSU, { ...harness, name: "또", id })
        .catch((e: InvalidInputError) => e)) as InvalidInputError;
      expect(dup.issues).toEqual([{ path: "id", message: "같은 id의 연결이 이미 있어요" }]);
    }
  });

  test("only whoever connected it can remove it, and not while runs are on it", async () => {
    const { platform } = setup();
    const view = await platform.connections.create(YEONSU, harness);
    await expect(platform.connections.remove(JIMIN, view.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(platform.connections.remove(YEONSU, "builtin")).rejects.toMatchObject({
      message: "서버 설정 파일에 적힌 연결은 화면에서 지울 수 없어요",
    });
    await expect(platform.connections.remove(YEONSU, "nobody")).rejects.toBeInstanceOf(
      NotFoundError,
    );

    const { world, scenario } = await seed(platform);
    await platform.connections.create(YEONSU, { ...harness, name: "바쁜 하네스", id: "busy" });
    const run = await platform.experiments.create(YEONSU, {
      name: "돌리는 중",
      recipe: recipe(world.id, scenario.id, { harnessId: "busy", agentId: "triage" }),
    });
    await expect(platform.connections.remove(YEONSU, "busy")).rejects.toBeInstanceOf(ConflictError);
    await platform.experiments.cancel(YEONSU, run.experiment.id);

    expect(await platform.connections.remove(YEONSU, view.id)).toEqual({ deleted: true });
    expect(platform.connections.get(view.id)).toBeUndefined();
    expect((await platform.connections.views()).map((v) => v.id)).not.toContain(view.id);
  });

  test("what people connected is still there after a restart; one that no longer builds is shown, not lost", async () => {
    const env: Record<string, string> = { HARNESS_TOKEN: "t" };
    const first = setup(env);
    const kept = await first.platform.connections.create(YEONSU, {
      ...harness,
      config: { ...harness.config, tokenEnv: "HARNESS_TOKEN" },
    });

    // The server restarts with the same store, and the token variable is gone.
    delete env.HARNESS_TOKEN;
    const second = testPlatform(
      [],
      { adapters: { connect: { env, fetch: first.fake.fetch } } },
      first.store,
    );
    await second.platform.start();
    const broken = (await second.platform.connections.views()).find((v) => v.id === kept.id);
    expect(broken).toMatchObject({ status: "unreachable", owner: "yeonsu", source: "screen" });
    expect(broken?.error).toBe("서버에는 'HARNESS_TOKEN'라는 환경 변수가 없어요");
    expect(second.platform.connections.get(kept.id)).toBeUndefined();

    // Set it right, ask again.
    env.HARNESS_TOKEN = "t";
    const healed = await second.platform.connections.recheck(YEONSU, kept.id);
    expect(healed.status).toBe("ok");
    expect(healed.agents).toHaveLength(2);
    expect(second.platform.connections.get(kept.id)).toBeDefined();
  });

  test("asking again sees a harness's new agents without waiting for the cache", async () => {
    const { platform, fake } = setup();
    const view = await platform.connections.create(YEONSU, harness);
    expect(view.agents).toHaveLength(2);
    fake.on("GET", /^\/agents$/, () => json({ agents: [AGENTS[0]] }));
    expect((await platform.connections.views()).find((v) => v.id === view.id)?.agents).toHaveLength(
      2,
    );
    expect((await platform.connections.recheck(YEONSU, view.id)).agents).toHaveLength(2);
  });

  test("a harness from the config file keeps its settings for display, and ports of any kind are listed", async () => {
    const odd = new ScriptHarness("odd", untilStopped);
    const { platform } = testPlatform([odd], {
      adapters: {
        harnessConfigs: [
          {
            kind: "test",
            id: "odd",
            name: "별난 하네스",
            description: "설정 파일에서",
            url: "http://h.test",
          },
        ],
      },
    });
    const view = (await platform.connections.views()).find((v) => v.id === "odd");
    expect(view).toMatchObject({
      source: "config",
      connector: "test",
      scope: "harness",
      config: { url: "http://h.test" },
    });
    expect(platform.connections.specs().map((s) => s.kind)).toEqual([
      "langgraph",
      "opencode",
      "openclaw",
      "goclaw",
      "hermes",
      "http-template",
      "a2a",
      "mcp-agent",
      "command",
      "http",
      "scripted",
    ]);
  });

  test("a harness that reads its tools from its own config shows the fixed tool address; others show none [REQ-051]", async () => {
    const fake = new FakeFetch()
      .on("GET", /^\/v1\/models$/, () => json({ data: [{ id: "hermes-agent" }] }))
      .on("GET", /^\/agents$/, () => json({ agents: AGENTS }));
    const gateway = {
      open: () => ({ url: "https://t.test/run", close: () => undefined }),
      slotUrl: (slot: string) => `https://t.test/mcp/slots/${slot}/secret`,
    };
    const { platform } = testPlatform(
      [],
      { gateway, adapters: { connect: { env: {}, fetch: fake.fetch } } },
      new MemoryStore(),
    );
    const hermes = await platform.connections.create(YEONSU, {
      connector: "hermes",
      name: "내 헤르메스",
      config: { url: "https://hermes.test" },
    });
    expect(hermes.mcpSlotUrl).toBe(`https://t.test/mcp/slots/${hermes.id}/secret`);
    const plain = await platform.connections.create(YEONSU, harness);
    expect(plain.mcpSlotUrl).toBeUndefined();
  });
});
