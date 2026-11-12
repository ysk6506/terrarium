import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { observe } from "@terrarium/core/experiments";
import { afterAll, describe, expect, test } from "vitest";
import { SecretBox, SqliteStore } from "../adapters";
import { FakeFetch, json } from "../adapters/test-support/fake-fetch";
import { ADMIN, person, testPlatform } from "../runtime/test-support/platform";
import { buildApp } from "./app";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const as = (name: string) => ({ "x-terrarium-user": name });

function app() {
  const fake = new FakeFetch().on("GET", /^\/agents$/, () =>
    json({ agents: [{ id: "triage", name: "분류" }] }),
  );
  const { platform } = testPlatform([], {
    adapters: { connect: { env: {}, fetch: fake.fetch }, secretBox: SecretBox.ephemeral() },
  });
  return { a: buildApp({ platform }), fake, platform };
}

describe("connecting a harness from the screen, over HTTP [REQ-051]", () => {
  test("try, save, change, keep, re-check and remove; strangers may not change it", async () => {
    const { a, fake, platform } = app();
    const send = async (who: string, method: string, url: string, payload?: object) => {
      const r = await a.inject({
        method: method as "GET",
        url,
        headers: as(who),
        ...(payload ? { payload } : {}),
      });
      return { status: r.statusCode, body: r.json(), text: r.body };
    };
    const config = { url: "https://harness.test", token: "typed-secret" };

    const specs = await send("haneul", "GET", "/api/connectors");
    expect(specs.body.map((s: { kind: string }) => s.kind)).toContain("http");
    expect(specs.body.every((s: { toolGuide: string[] }) => s.toolGuide.length > 0)).toBe(true);

    const tried = await send("haneul", "POST", "/api/connections/check", {
      connector: "http",
      config,
      headers: [{ name: "X-Team", value: "ai", secret: false }],
    });
    expect(tried.body).toMatchObject({ ok: true, agents: [{ id: "triage" }] });
    expect((await send("haneul", "GET", "/api/connections")).body).toHaveLength(1);

    const made = await send("haneul", "POST", "/api/connections", {
      connector: "http",
      name: "회사 하네스",
      config,
      metadata: { team: "ai" },
    });
    expect(made.status).toBe(200);
    expect(made.text).not.toContain("typed-secret");
    const id = made.body.id as string;
    expect(made.body).toMatchObject({ owner: "haneul", secrets: ["token"], daysLeft: 30 });

    const stranger = await send("jimin", "PUT", `/api/connections/${id}`, {
      name: "가로채기",
      config: { url: "https://evil.test" },
    });
    expect(stranger.status).toBe(404);
    expect((await send("jimin", "DELETE", `/api/connections/${id}`)).status).toBe(404);

    const changed = await send("haneul", "PUT", `/api/connections/${id}`, {
      name: "새 이름",
      config: { url: "https://harness.test", token: "" },
    });
    expect(changed.body).toMatchObject({ name: "새 이름", secrets: ["token"] });
    expect(fake.requests.at(-1)?.headers.authorization).toBe("Bearer typed-secret");
    const bad = await send("haneul", "PUT", `/api/connections/${id}`, {
      config: { url: "not a url" },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.issues[0].path).toBe("url");

    expect((await send("jimin", "POST", `/api/connections/${id}/keep`)).status).toBe(404);
    expect((await send("jimin", "POST", `/api/connections/${id}/check`)).status).toBe(404);
    expect((await send("haneul", "POST", `/api/connections/${id}/keep`)).body.daysLeft).toBe(30);
    expect((await send("haneul", "POST", `/api/connections/${id}/check`)).body.status).toBe("ok");
    expect((await send("haneul", "GET", "/api/meta")).body.expiring).toEqual([]);

    expect((await send("haneul", "DELETE", `/api/connections/${id}`)).body).toEqual({
      deleted: true,
    });
    expect((await send("haneul", "POST", `/api/connections/${id}/keep`)).status).toBe(404);
    await platform.stop();
  });
});

describe("what was typed on the screen is still there after a restart [REQ-051]", () => {
  test("the SQLite store keeps the sealed secrets, headers, metadata and agent versions", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "terrarium-conn-"));
    dirs.push(dir);
    const file = path.join(dir, "terrarium.db");
    const box = SecretBox.ephemeral();
    const fake = new FakeFetch().on("GET", /^\/agents$/, () => json({ agents: [] }));
    const first = new SqliteStore(file);
    const one = testPlatform(
      [],
      { adapters: { connect: { env: {}, fetch: fake.fetch }, secretBox: box } },
      first,
    );
    const made = await one.platform.connections.create(person("haneul", "proxy"), {
      connector: "http",
      name: "저장",
      config: { url: "https://harness.test", token: "t0ken" },
      headers: [{ name: "X-K", value: "v4lue", secret: true }],
      metadata: { team: "ai" },
    });
    const history = observe(
      undefined,
      { harnessId: made.id, agentId: "a/b" },
      { name: "x" },
      "2026-10-01T00:00:00.000Z",
      "haneul",
    ).history;
    await first.putAgentHistory(history);
    first.close();

    const second = new SqliteStore(file);
    const two = testPlatform(
      [],
      { adapters: { connect: { env: {}, fetch: fake.fetch }, secretBox: box } },
      second,
    );
    await two.platform.start();
    const [, view] = await two.platform.connections.views(ADMIN);
    expect(view).toMatchObject({
      id: made.id,
      secrets: ["token"],
      metadata: { team: "ai" },
      headers: [{ name: "X-K", secret: true }],
      status: "ok",
    });
    expect(fake.requests.at(-1)?.headers.authorization).toBe("Bearer t0ken");
    expect(fake.requests.at(-1)?.headers["x-k"]).toBe("v4lue");
    expect((await second.listConnections())[0]?.createdAt).toBeDefined();
    expect(await second.getAgentHistory(made.id, "a/b")).toEqual(history);
    expect(await second.getAgentHistory(made.id, "other")).toBeUndefined();
    expect(await second.listAgentHistories(made.id)).toEqual([history]);
    expect(await second.deleteAgentHistories(made.id)).toBe(1);
    expect(await second.listAgentHistories(made.id)).toEqual([]);
    second.close();
  });
});
