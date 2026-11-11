import { InvalidInputError } from "@terrarium/core/contract";
import { MemoryStore } from "@terrarium/core/experiments";
import { NotFoundError } from "@terrarium/core/kernel";
import { describe, expect, test } from "vitest";
import { SecretBox } from "../adapters";
import { FakeFetch, json } from "../adapters/test-support/fake-fetch";
import type { Stamps } from "./ids";
import { ADMIN, JIMIN, recipe, seed, testPlatform, YEONSU } from "./test-support/platform";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 1);

/** A clock the test moves by hand. */
function clock(): { stamps: Stamps; days(n: number): void } {
  let t = T0;
  let n = 0;
  return {
    stamps: { id: (p) => `${p}-${++n}`, now: () => new Date(t).toISOString() },
    days: (d) => {
      t = T0 + d * DAY;
    },
  };
}

function setup(env: Record<string, string> = {}, options: Parameters<typeof testPlatform>[1] = {}) {
  const fake = new FakeFetch().on("GET", /^\/agents$/, () =>
    json({ agents: [{ id: "triage", name: "분류" }] }),
  );
  const store = new MemoryStore();
  const box = SecretBox.ephemeral();
  const built = testPlatform(
    [],
    {
      ...options,
      adapters: { ...options.adapters, connect: { env, fetch: fake.fetch }, secretBox: box },
    },
    store,
  );
  return { ...built, fake, box, env };
}

const base = { connector: "http", name: "회사 하네스" };
const url = "https://harness.test";
const lastAgentsCall = (fake: FakeFetch) =>
  [...fake.requests].reverse().find((r) => r.url.endsWith("/agents"));

describe("a token typed on the screen is used, kept sealed and never shown again [REQ-051]", () => {
  test("it is sent to the harness, but not found in the view, the meta, the store or any answer", async () => {
    const { platform, fake, store } = setup();
    const view = await platform.connections.create(YEONSU, {
      ...base,
      config: { url, token: "s3cret-token" },
    });
    expect(lastAgentsCall(fake)?.headers.authorization).toBe("Bearer s3cret-token");
    expect(view.secrets).toEqual(["token"]);
    expect(view.config).toEqual({ url });
    const record = (await store.listConnections())[0];
    expect(record?.secrets?.token).toMatch(/^v1:/);
    for (const text of [
      JSON.stringify(view),
      JSON.stringify(await platform.connections.views(ADMIN)),
      JSON.stringify(await platform.meta(YEONSU)),
      JSON.stringify(record),
    ])
      expect(text).not.toContain("s3cret-token");
  });

  test("typing it and naming a server variable for it is one too many", async () => {
    const { platform } = setup({ HARNESS_TOKEN: "t" });
    const err = (await platform.connections
      .create(YEONSU, { ...base, config: { url, token: "x", tokenEnv: "HARNESS_TOKEN" } })
      .catch((e: InvalidInputError) => e)) as InvalidInputError;
    expect(err.issues).toEqual([
      {
        path: "tokenEnv",
        message: "비밀 값을 직접 입력했으면 환경 변수 이름은 비워 둬요. 둘 중 하나만 써요",
      },
    ]);
    const bad = (await platform.connections
      .create(YEONSU, { ...base, config: { url, token: 5 } })
      .catch((e: InvalidInputError) => e)) as InvalidInputError;
    expect(bad.issues[0]).toEqual({ path: "token", message: "글자로 입력해 주세요" });
  });

  test("after a restart it still opens; with another key it says what happened", async () => {
    const first = setup();
    await first.platform.connections.create(YEONSU, { ...base, config: { url, token: "kept" } });
    const again = testPlatform(
      [],
      { adapters: { connect: { env: {}, fetch: first.fake.fetch }, secretBox: first.box } },
      first.store,
    );
    await again.platform.start();
    const [, view] = await again.platform.connections.views(ADMIN);
    expect(view).toMatchObject({ status: "ok", secrets: ["token"] });
    expect(lastAgentsCall(first.fake)?.headers.authorization).toBe("Bearer kept");

    const lost = testPlatform(
      [],
      {
        adapters: {
          connect: { env: {}, fetch: first.fake.fetch },
          secretBox: SecretBox.ephemeral(),
        },
      },
      first.store,
    );
    await lost.platform.start();
    const [, broken] = await lost.platform.connections.views(ADMIN);
    expect(broken?.status).toBe("unreachable");
    expect(broken?.error).toContain("서버의 암호 키");
    expect(JSON.stringify(broken)).not.toContain("kept");
  });
});

describe("custom headers go with every request [REQ-051]", () => {
  test("a plain one is shown, a secret one only by name, and both are sent", async () => {
    const { platform, fake, store } = setup();
    const view = await platform.connections.create(YEONSU, {
      ...base,
      config: { url },
      headers: [
        { name: "X-Gateway-Key", value: "gw-secret", secret: true },
        { name: "X-Team", value: "ai-center", secret: false },
      ],
    });
    const sent = lastAgentsCall(fake)?.headers;
    expect(sent?.["x-gateway-key"]).toBe("gw-secret");
    expect(sent?.["x-team"]).toBe("ai-center");
    expect(view.headers).toEqual([
      { name: "X-Gateway-Key", secret: true },
      { name: "X-Team", secret: false, value: "ai-center" },
    ]);
    expect(JSON.stringify(view)).not.toContain("gw-secret");
    expect(JSON.stringify(await store.listConnections())).not.toContain("gw-secret");
  });

  test("a header without the value it needs is said by position", async () => {
    const { platform } = setup();
    const err = (await platform.connections
      .create(YEONSU, {
        ...base,
        config: { url },
        headers: [
          { name: "A", secret: true },
          { name: "B", secret: false },
        ],
      })
      .catch((e: InvalidInputError) => e)) as InvalidInputError;
    expect(err.issues).toEqual([
      { path: "headers.0.value", message: "비밀 헤더는 값을 입력해 주세요" },
      { path: "headers.1.value", message: "값을 입력해 주세요" },
    ]);
  });

  test("what a person typed beats the connector's own default, and trying it uses them too", async () => {
    const { platform, fake } = setup();
    const checked = await platform.connections.check(YEONSU, {
      connector: "http",
      config: { url, token: "from-token" },
      headers: [{ name: "Authorization", value: "Basic abc", secret: false }],
    });
    expect(checked.ok).toBe(true);
    expect(lastAgentsCall(fake)?.headers.authorization).toBe("Basic abc");
  });
});

describe("changing a connection keeps its secrets unless told otherwise [REQ-051]", () => {
  async function made() {
    const s = setup({ HARNESS_TOKEN: "from-env" });
    const view = await s.platform.connections.create(YEONSU, {
      ...base,
      config: { url, token: "old-token" },
      headers: [{ name: "X-Key", value: "old-key", secret: true }],
      metadata: { team: "a" },
    });
    return { ...s, id: view.id };
  }

  test("what is left blank stays, what is typed replaces, null removes", async () => {
    const { platform, fake, id } = await made();
    const same = await platform.connections.update(YEONSU, id, {
      name: "새 이름",
      config: { url, token: "" },
      headers: [{ name: "x-key", secret: true }],
    });
    expect(same).toMatchObject({ name: "새 이름", secrets: ["token"], metadata: { team: "a" } });
    expect(lastAgentsCall(fake)?.headers.authorization).toBe("Bearer old-token");
    expect(lastAgentsCall(fake)?.headers["x-key"]).toBe("old-key");

    await platform.connections.update(YEONSU, id, {
      config: { url, token: "new-token" },
      headers: [{ name: "X-Key", value: "new-key", secret: true }],
      metadata: { team: "b" },
    });
    expect(lastAgentsCall(fake)?.headers.authorization).toBe("Bearer new-token");
    expect(lastAgentsCall(fake)?.headers["x-key"]).toBe("new-key");

    const gone = await platform.connections.update(YEONSU, id, {
      config: { url, token: null },
      headers: [],
    });
    expect(gone).toMatchObject({ secrets: [], headers: [] });
    expect(lastAgentsCall(fake)?.headers.authorization).toBeUndefined();
    expect(lastAgentsCall(fake)?.headers["x-key"]).toBeUndefined();
  });

  test("leaving the headers out keeps them; naming a server variable replaces a typed token", async () => {
    const { platform, fake, id } = await made();
    await platform.connections.update(YEONSU, id, { config: { url, token: "" } });
    expect(lastAgentsCall(fake)?.headers["x-key"]).toBe("old-key");
    const view = await platform.connections.update(YEONSU, id, {
      config: { url, tokenEnv: "HARNESS_TOKEN" },
    });
    expect(view.secrets).toEqual([]);
    expect(lastAgentsCall(fake)?.headers.authorization).toBe("Bearer from-env");
  });

  test("only its owner may change it or try a change; a change that does not build changes nothing", async () => {
    const { platform, fake, id } = await made();
    await expect(
      platform.connections.update(JIMIN, id, { config: { url } }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      platform.connections.check(JIMIN, { connector: "http", id, config: { url } }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      platform.connections.update(YEONSU, "builtin", { config: {} }),
    ).rejects.toMatchObject({ message: "서버 설정 파일에 적힌 연결은 화면에서 바꿀 수 없어요" });
    await expect(
      platform.connections.update(YEONSU, id, { config: { url: "ftp://nope.test" } }),
    ).rejects.toBeInstanceOf(InvalidInputError);
    const [, view] = await platform.connections.views(ADMIN);
    expect(view?.config).toEqual({ url });
    const tried = await platform.connections.check(YEONSU, {
      connector: "http",
      id,
      config: { url },
    });
    expect(tried.ok).toBe(true);
    expect(lastAgentsCall(fake)?.headers.authorization).toBe("Bearer old-token");
  });
});

describe("a connection nobody uses for a month is removed, after a warning [REQ-051]", () => {
  test("its owner is told a week before, and keeping it starts the month again", async () => {
    const c = clock();
    const { platform } = setup({}, { stamps: c.stamps });
    const view = await platform.connections.create(YEONSU, { ...base, config: { url } });
    expect(view).toMatchObject({ daysLeft: 30, lastUsedAt: new Date(T0).toISOString() });
    expect(view.expiresAt).toBe(new Date(T0 + 30 * DAY).toISOString());

    c.days(10);
    expect((await platform.meta(YEONSU)).expiring).toEqual([]);
    c.days(24);
    const warned = (await platform.connections.recheck(YEONSU, view.id)).daysLeft;
    expect(warned).toBe(6);
    expect((await platform.meta(YEONSU)).expiring).toEqual([
      { id: view.id, name: "회사 하네스", daysLeft: 6 },
    ]);
    expect((await platform.meta(JIMIN)).expiring).toEqual([]);

    const kept = await platform.connections.keep(YEONSU, view.id);
    expect(kept.daysLeft).toBe(30);
    c.days(60);
    expect(await platform.sweepConnections()).toEqual([view.id]);
    expect(platform.connections.get(view.id)).toBeUndefined();
  });

  test("an experiment made on it counts as use; the config file's connections never expire", async () => {
    const c = clock();
    const { platform } = setup({}, { stamps: c.stamps });
    const view = await platform.connections.create(YEONSU, { ...base, config: { url } });
    const { world, scenario } = await seed(platform);
    c.days(20);
    const made = await platform.experiments.create(YEONSU, {
      name: "써요",
      recipe: recipe(world.id, scenario.id, { harnessId: view.id, agentId: "triage" }),
    });
    await platform.experiments.cancel(YEONSU, made.experiment.id);
    c.days(45);
    expect(await platform.sweepConnections()).toEqual([]);
    c.days(51);
    expect(await platform.sweepConnections()).toEqual([view.id]);
    const builtin = (await platform.connections.views(ADMIN)).find((v) => v.id === "builtin");
    expect(builtin?.daysLeft).toBeUndefined();
    expect(builtin?.expiresAt).toBeUndefined();
  });

  test("runs still going keep a connection from being removed, and removal can be switched off", async () => {
    const c = clock();
    const { platform } = setup({}, { stamps: c.stamps });
    const view = await platform.connections.create(YEONSU, { ...base, config: { url } });
    const { world, scenario } = await seed(platform);
    const running = await platform.experiments.create(YEONSU, {
      name: "돌리는 중",
      recipe: recipe(world.id, scenario.id, { harnessId: view.id, agentId: "triage" }),
    });
    c.days(90);
    expect(await platform.sweepConnections()).toEqual([]);
    await platform.experiments.cancel(YEONSU, running.experiment.id);

    const never = setup(
      {},
      { stamps: c.stamps, adapters: { retention: { days: 0, warnDays: 7 } } },
    );
    const kept = await never.platform.connections.create(YEONSU, { ...base, config: { url } });
    expect(kept.daysLeft).toBeUndefined();
    c.days(900);
    expect(await never.platform.sweepConnections()).toEqual([]);
    expect(await never.platform.meta(YEONSU)).toMatchObject({ expiring: [] });
  });

  test("the sweep also runs when the server starts", async () => {
    const c = clock();
    const first = setup({}, { stamps: c.stamps });
    const view = await first.platform.connections.create(YEONSU, { ...base, config: { url } });
    c.days(40);
    const second = testPlatform(
      [],
      {
        stamps: c.stamps,
        adapters: { connect: { env: {}, fetch: first.fake.fetch }, secretBox: first.box },
      },
      first.store,
    );
    await second.platform.start();
    expect(second.platform.connections.get(view.id)).toBeUndefined();
    expect(await first.store.listConnections()).toEqual([]);
  });
});

describe("a harness that cannot reach Terrarium's tools is told so when it is tried [REQ-051]", () => {
  test("only when Terrarium is on this very computer and the harness is on another", async () => {
    const { platform } = setup();
    const remote = { connector: "http", config: { url } };
    const local = await platform.connections.check(YEONSU, remote, "http://localhost:8787");
    expect(local.notes.join(" ")).toContain("publicUrl");
    const same = await platform.connections.check(
      YEONSU,
      { connector: "http", config: { url: "http://127.0.0.1:9000" } },
      "http://localhost:8787",
    );
    expect(same.notes).toEqual([]);
    const reachable = await platform.connections.check(YEONSU, remote, "https://terrarium.corp");
    expect(reachable.notes).toEqual([]);
    const unknown = await platform.connections.check(YEONSU, remote, "not a url");
    expect(unknown.notes).toEqual([]);
  });
});
