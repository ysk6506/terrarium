import { afterEach, describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../../../packages/core/src/world/test-support/sample";
import { SecretBox } from "../adapters";
import { FakeFetch, json } from "../adapters/test-support/fake-fetch";
import { recipe, testPlatform, until } from "../runtime/test-support/platform";
import { buildApp } from "./app";
import { headerAuthenticator } from "./identity";
import { SELF_ONLY } from "./viewer";

/**
 * Every mutation the survey found open, asked by a second signed-in person (ADR-0174 step 1). People here are typed
 * names; whoever is called `admin-…` sends the admin token. The refusal is the point, so the second person is
 * always "bob" and the maker "alice".
 */
const TOKEN = "admin-token-for-tests-0002";
const stoppers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of stoppers.splice(0)) await stop();
});

function setup() {
  const fake = new FakeFetch().on("GET", /^\/agents$/, () =>
    json({ agents: [{ id: "triage", name: "분류" }] }),
  );
  const { platform } = testPlatform([], {
    adapters: { connect: { env: {}, fetch: fake.fetch }, secretBox: SecretBox.ephemeral() },
    llm: { fetch: async () => new Response(JSON.stringify({ data: [{ id: "m" }] })) },
  });
  stoppers.push(() => platform.stop());
  const app = buildApp({
    platform,
    authenticator: headerAuthenticator({ ...SELF_ONLY, adminToken: TOKEN }),
  });
  const send = async (who: string, method: string, url: string, payload?: object) => {
    const r = await app.inject({
      method: method as "GET",
      url,
      headers: {
        "x-terrarium-user": encodeURIComponent(who),
        ...(who.startsWith("admin-") ? { "x-terrarium-admin-token": TOKEN } : {}),
      },
      ...(payload ? { payload } : {}),
    });
    return { status: r.statusCode, body: r.json() as Record<string, any> };
  };
  return { send, platform };
}

type Send = ReturnType<typeof setup>["send"];

/** What alice has made: a world, a scenario, a connection of hers, a model, and an experiment on the built-in agent. */
async function alices(send: Send) {
  const world = (
    await send("alice", "POST", "/api/worlds", { name: "홀", blueprint: sampleBlueprint() })
  ).body.world;
  const scenario = (
    await send("alice", "POST", "/api/scenarios", {
      worldId: world.id,
      templateId: "cooling-failure",
    })
  ).body.scenario;
  const connection = (
    await send("alice", "POST", "/api/connections", {
      connector: "http",
      name: "앨리스 하네스",
      config: { url: "https://harness.test", token: "alice-secret" },
    })
  ).body;
  const model = (
    await send("alice", "POST", "/api/models", {
      name: "앨리스 모델",
      kind: "openai",
      baseUrl: "https://llm.test/v1",
      apiKey: "sk-alice-secret-0001",
    })
  ).body;
  const experiment = (
    await send("alice", "POST", "/api/experiments", {
      name: "앨리스 실험",
      recipe: recipe(world.id, scenario.id, { seeds: [1] }),
    })
  ).body.experiment;
  await until(
    async () =>
      (await send("alice", "GET", `/api/experiments/${experiment.id}`)).body.progress.finished ===
      1,
  );
  return { world, scenario, connection, model, experiment };
}

describe("what was open to every signed-in person is for its maker and admins [REQ-054]", () => {
  test("[REQ-054] talking through, keeping, re-checking a connection a person made on the screen is for that person", async () => {
    const { send } = setup();
    const { connection } = await alices(send);
    const base = `/api/connections/${connection.id}`;
    for (const [method, url, payload] of [
      ["POST", `${base}/try`, { agentId: "triage", text: "안녕" }],
      ["POST", `${base}/keep`, undefined],
      ["POST", `${base}/check`, undefined],
    ] as const) {
      expect((await send("bob", method, url, payload)).status, url).toBe(404);
      expect((await send("alice", method, url, payload)).status, url).toBe(200);
      expect((await send("admin-kim", method, url, payload)).status, url).toBe(200);
    }
  });

  test("[REQ-054] a connection of the config file may be used by every signed-in person", async () => {
    const { send } = setup();
    await alices(send);
    expect((await send("bob", "POST", "/api/connections/builtin/check")).status).toBe(200);
    expect(
      (
        await send("bob", "POST", "/api/connections/builtin/try", {
          agentId: "triage",
          text: "안녕",
        })
      ).status,
    ).toBe(200);
  });

  test("[REQ-054] checking a model opens its sealed key, so it is for whoever registered it; choosing the default is for admins", async () => {
    const { send } = setup();
    const { model } = await alices(send);
    // alice registered the first model, which is the default, and the default is usable by everyone whatever its scope
    expect((await send("bob", "POST", `/api/models/${model.id}/check`)).status).toBe(200);
    expect((await send("alice", "POST", `/api/models/${model.id}/check`)).status).toBe(200);
    // even the one who registered it does not choose what every user's helper answers with
    expect((await send("alice", "POST", `/api/models/${model.id}/default`)).status).toBe(403);
    expect((await send("bob", "POST", `/api/models/${model.id}/default`)).status).toBe(403);
    expect((await send("admin-kim", "POST", `/api/models/${model.id}/default`)).status).toBe(200);
  });

  test("[REQ-054] marking a scenario's calibration is for the scenario's maker and admins", async () => {
    const { send } = setup();
    const { scenario } = await alices(send);
    const url = `/api/scenarios/${scenario.id}/calibrate`;
    expect((await send("bob", "POST", url, { seed: 1 })).status).toBe(403);
    expect((await send("alice", "POST", url, { seed: 1 })).status).toBe(200);
  });

  test("[REQ-054] a share link is made by the experiment's maker or an admin, and taken back by its maker, the experiment's maker or an admin", async () => {
    const { send } = setup();
    const { experiment } = await alices(send);
    const url = `/api/experiments/${experiment.id}/shares`;
    expect((await send("bob", "POST", url, {})).status).toBe(403);
    const first = await send("alice", "POST", url, {});
    expect(first.status).toBe(200);
    const byAdmin = await send("admin-kim", "POST", url, {});
    expect(byAdmin.status).toBe(200);
    expect((await send("bob", "DELETE", `/api/shares/${first.body.token}`)).status).toBe(403);
    // the admin's own link: its maker takes it back; so does the experiment's maker
    expect((await send("admin-kim", "DELETE", `/api/shares/${byAdmin.body.token}`)).status).toBe(
      200,
    );
    expect((await send("alice", "DELETE", `/api/shares/${first.body.token}`)).status).toBe(200);
  });

  test("[REQ-054] the current-process table is written by the scenario's maker, not by whoever came first", async () => {
    const { send } = setup();
    const { scenario } = await alices(send);
    const url = `/api/scenarios/${scenario.id}/current-process`;
    const steps = [{ who: "담당", what: "확인", minutes: 5, kind: "check" }];
    expect((await send("bob", "PUT", url, { steps })).status).toBe(403);
    expect((await send("alice", "PUT", url, { steps })).status).toBe(200);
    expect((await send("admin-kim", "PUT", url, { steps })).status).toBe(200);
    expect((await send("bob", "GET", url)).body.canEdit).toBe(false);
  });

  test("[REQ-054] a config-file connection's agent versions are managed by admins; a screen-made one's by its maker", async () => {
    const { send } = setup();
    const { connection } = await alices(send);
    const config = "/api/connections/builtin/agents/triage/versions";
    expect((await send("bob", "POST", config, { label: "v" })).status).toBe(403);
    expect((await send("alice", "POST", config, { label: "v" })).status).toBe(403);
    const added = await send("admin-kim", "POST", config, { label: "관리자" });
    expect(added.status).toBe(200);
    expect((await send("bob", "PUT", `${config}/1`, { label: "x" })).status).toBe(403);
    expect((await send("bob", "DELETE", `${config}/1`)).status).toBe(403);
    expect((await send("admin-kim", "DELETE", `${config}/1`)).status).toBe(200);
    const own = `/api/connections/${connection.id}/agents/triage/versions`;
    expect((await send("bob", "POST", own, { label: "v" })).status).toBe(404);
    expect((await send("alice", "POST", own, { label: "v" })).status).toBe(200);
  });

  test("[REQ-054] importing a world from a source is for admins", async () => {
    const { send } = setup();
    expect((await send("bob", "POST", "/api/worlds/import", { source: "sample" })).status).toBe(
      403,
    );
    expect(
      (await send("admin-kim", "POST", "/api/worlds/import", { source: "sample" })).status,
    ).toBe(200);
  });

  test("[REQ-054] an experiment on someone's screen-made connection, created or forked, is for that person and admins; the config file's is open", async () => {
    const { send } = setup();
    const { world, scenario, connection, experiment } = await alices(send);
    const onHers = {
      recipe: recipe(world.id, scenario.id, { harnessId: connection.id, seeds: [1] }),
      name: "빌려 쓰기",
    };
    expect((await send("bob", "POST", "/api/experiments", onHers)).status).toBe(404);
    const fork = (who: string, harnessId: string, agentId: string) =>
      send(who, "POST", `/api/experiments/${experiment.id}/fork`, {
        change: { harnessId, agentId },
      });
    expect((await fork("bob", connection.id, "triage")).status).toBe(404);
    // bob forking onto the built-in agent is fine: the config file's connections are for everyone
    expect((await fork("bob", "builtin", "guess")).status).toBe(200);
    expect(
      (await send("bob", "POST", `/api/worlds/${world.id}/quick-experiment`, {})).status,
    ).not.toBe(403);
  });

  test("[REQ-054] stopping an experiment and adding runs stay with its maker and admins", async () => {
    const { send } = setup();
    const { experiment } = await alices(send);
    expect((await send("bob", "POST", `/api/experiments/${experiment.id}/cancel`)).status).toBe(
      403,
    );
    expect(
      (await send("bob", "POST", `/api/experiments/${experiment.id}/runs`, { count: 1 })).status,
    ).toBe(403);
    expect(
      (await send("admin-kim", "POST", `/api/experiments/${experiment.id}/runs`, { count: 1 }))
        .status,
    ).toBe(200);
  });

  test("[REQ-054] a like is any signed-in person's; a request with no name cannot like", async () => {
    const { send, platform } = setup();
    const { world } = await alices(send);
    expect((await send("bob", "POST", `/api/worlds/${world.id}/like`)).status).toBe(200);
    const unnamed = await buildApp({ platform }).inject({
      method: "POST",
      url: `/api/worlds/${world.id}/like`,
    });
    expect(unnamed.statusCode).toBe(403);
  });
});
