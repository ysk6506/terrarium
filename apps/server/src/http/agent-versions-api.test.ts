import { describe, expect, test } from "vitest";
import { FakeFetch, json } from "../adapters/test-support/fake-fetch";
import { recipe, seed, testPlatform, YEONSU } from "../runtime/test-support/platform";
import { buildApp } from "./app";

describe("the versions of an agent over HTTP [REQ-053]", () => {
  test("list, add, edit and delete by address; an agent with a slash in its id works", async () => {
    const fake = new FakeFetch().on("GET", /^\/agents$/, () =>
      json({ agents: [{ id: "team/ops", name: "운영" }] }),
    );
    const { platform } = testPlatform([], {
      adapters: { connect: { env: {}, fetch: fake.fetch } },
    });
    const connection = await platform.connections.create(YEONSU, {
      connector: "http",
      name: "회사 하네스",
      config: { url: "https://harness.test" },
    });
    const { world, scenario } = await seed(platform);
    await platform.experiments.create(YEONSU, {
      name: "실험",
      recipe: recipe(world.id, scenario.id, { harnessId: connection.id, agentId: "team/ops" }),
    });
    const a = buildApp({ platform });
    const send = async (method: string, url: string, payload?: object, who = "yeonsu") => {
      const r = await a.inject({
        method: method as "GET",
        url,
        headers: { "x-terrarium-user": who },
        ...(payload ? { payload } : {}),
      });
      return { status: r.statusCode, body: r.json() };
    };
    const base = `/api/connections/${connection.id}/agents/${encodeURIComponent("team/ops")}/versions`;
    const listed = await send("GET", base);
    expect(listed.status).toBe(200);
    expect(listed.body).toMatchObject({
      agentId: "team/ops",
      versions: [{ n: 1, experiments: 1 }],
    });
    const added = await send("POST", base, { label: "수동", attributes: { prompt: "v3" } });
    expect(added.body.versions[0]).toMatchObject({ n: 2, label: "수동" });
    const edited = await send("PUT", `${base}/2`, { note: "메모", label: null });
    expect(edited.body.versions[0]).toMatchObject({ n: 2, note: "메모" });
    expect((await send("PUT", `${base}/2`, { label: "" })).status).toBe(400);
    expect((await send("PUT", `${base}/x`, { note: "a" })).status).toBe(404);
    expect((await send("PUT", `${base}/0`, { note: "a" })).status).toBe(404);
    expect((await send("DELETE", `${base}/2`, undefined, "jimin")).status).toBe(403);
    expect(
      (await send("DELETE", `${base}/2`)).body.versions.map((v: { n: number }) => v.n),
    ).toEqual([1]);
    expect((await send("GET", "/api/connections/nope/agents/a/versions")).status).toBe(404);
    await platform.stop();
  });
});
