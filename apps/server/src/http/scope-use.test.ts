/**
 * Using something needs sight of it (ADR-0174): a person cannot build on a world, scenario or connection they cannot see, nor
 * spend a private connection's or model's credentials. Changing a scope goes through one path, and narrowing it keeps what others made.
 */

import { describe, expect, test } from "vitest";
import { recipe } from "../runtime/test-support/platform";
import {
  BOSS,
  LONE,
  MINA,
  makeAll,
  OLIVIA,
  OMAR,
  type ScopedApp,
  scopedApp,
} from "./test-support/scoped-app";

const PRIVATE = { scope: "private" } as const;

async function privateSetup() {
  const s = scopedApp();
  const made = await makeAll(s, OLIVIA, PRIVATE);
  return { s, made };
}

describe("[REQ-054] using needs sight", () => {
  test("[REQ-054] a scenario cannot be made on a world the person cannot see", async () => {
    const { s, made } = await privateSetup();
    const body = { worldId: made.world.id, templateId: "cooling-failure" };
    expect((await s.send(OMAR, "POST", "/api/scenarios", body)).status).toBe(404);
    expect((await s.send(OLIVIA, "POST", "/api/scenarios", body)).status).toBe(200);
    expect((await s.send(BOSS, "POST", "/api/scenarios", body)).status).toBe(200);
    await s.close();
  });

  test("[REQ-054] an experiment cannot be made on a world, scenario or connection the person cannot see", async () => {
    const { s, made } = await privateSetup();
    const ownWorld = (await s.send(OMAR, "GET", "/api/worlds")).body.worlds?.[0];
    const make = (r: object) =>
      s.send(OMAR, "POST", "/api/experiments", { name: "남의 것", recipe: r });
    const onHers = recipe(made.world.id, made.scenario.id, { seeds: [1] });
    expect((await make(onHers)).status).toBe(404);
    expect((await make({ ...onHers, harnessId: made.connection.id })).status).toBe(404);
    expect(ownWorld).toBeUndefined();
    await s.close();
  });

  test("[REQ-054] a fork cannot be pointed at a connection the person cannot see", async () => {
    const s = scopedApp();
    const made = await makeAll(s, OLIVIA, { scope: "everyone" });
    const mine = await s.send(OLIVIA, "POST", "/api/connections", {
      connector: "http",
      name: "내 것",
      config: { url: "https://harness.test", token: "olivia-secret" },
    });
    const fork = (who: typeof OMAR, harnessId: string, agentId = "triage") =>
      s.send(who, "POST", `/api/experiments/${made.experiment.id}/fork`, {
        change: { harnessId, agentId },
      });
    expect((await fork(OMAR, mine.body.id)).status).toBe(404);
    expect((await fork(OMAR, "builtin", "guess")).status).toBe(200);
    await s.close();
  });

  test("[REQ-054] quick experiment, talking, keeping and re-checking need sight of what they use", async () => {
    const { s, made } = await privateSetup();
    const base = `/api/connections/${made.connection.id}`;
    for (const [method, url, payload] of [
      ["POST", `${base}/try`, { agentId: "triage", text: "안녕" }],
      ["POST", `${base}/keep`, undefined],
      ["POST", `${base}/check`, undefined],
    ] as const) {
      expect((await s.send(OMAR, method, url, payload)).status, url).toBe(404);
      expect((await s.send(MINA, method, url, payload)).status, url).toBe(404);
      expect((await s.send(OLIVIA, method, url, payload)).status, url).toBe(200);
      expect((await s.send(BOSS, method, url, payload)).status, url).toBe(200);
    }
    expect(
      (await s.send(OMAR, "POST", `/api/worlds/${made.world.id}/quick-experiment`, {})).status,
    ).toBe(404);
    await s.close();
  });

  test("[REQ-054] checking a model needs sight of it; a model made for everyone is checked by anyone", async () => {
    const { s, made } = await privateSetup();
    expect((await s.send(OMAR, "POST", `/api/models/${made.model.id}/check`)).status).toBe(404);
    expect((await s.send(OLIVIA, "POST", `/api/models/${made.model.id}/check`)).status).toBe(200);
    // the admin's model from the setup is made for everyone, so it is the default and anyone may check it
    const list = (await s.send(OMAR, "GET", "/api/models")).body as unknown as {
      id: string;
      isDefault: boolean;
    }[];
    const theDefault = list.find((m) => m.isDefault);
    expect(theDefault).toBeDefined();
    expect((await s.send(OMAR, "POST", `/api/models/${theDefault?.id}/check`)).status).toBe(200);
    await s.close();
  });

  test("[REQ-054] a private connection's credentials are not spent by another person", async () => {
    const { s, made } = await privateSetup();
    const onHers = recipe(made.world.id, made.scenario.id, { harnessId: made.connection.id });
    const reached = async () =>
      (await s.send(OMAR, "POST", "/api/experiments", { name: "x", recipe: onHers })).status;
    expect(await reached()).toBe(404);
    // nor opened by naming it in a check, which would send its sealed token to wherever the check points
    const check = await s.send(OMAR, "POST", "/api/connections/check", {
      connector: "http",
      id: made.connection.id,
      config: { url: "https://elsewhere.test" },
    });
    expect(check.status).toBe(404);
    // nor read back: the sealed token never appears in what anyone is shown
    for (const who of [OLIVIA, MINA, OMAR, BOSS]) {
      const all =
        (await s.send(who, "GET", "/api/connections")).text +
        (await s.send(who, "GET", "/api/models")).text;
      expect(all).not.toContain("olivia-secret");
      expect(all).not.toContain("sk-olivia-secret-0001");
    }
    await s.close();
  });
});

describe("[REQ-054] who may change a scope", () => {
  const change = (s: ScopedApp, who: typeof OLIVIA, url: string, body: object) =>
    s.send(who, "PUT", url, body);

  test("[REQ-054] only the maker and an admin change it, through the one scope route all five kinds share", async () => {
    const { s, made } = await privateSetup();
    // the same route for all five kinds, and nothing but the scope in its body
    const targets: readonly [string, string][] = [
      ["world", `/api/worlds/${made.world.id}/scope`],
      ["scenario", `/api/scenarios/${made.scenario.id}/scope`],
      ["connection", `/api/connections/${made.connection.id}/scope`],
      ["model", `/api/models/${made.model.id}/scope`],
      ["experiment", `/api/experiments/${made.experiment.id}/scope`],
    ];
    for (const [what, url] of targets) {
      const to = (scope: string, group?: string) => ({
        scope,
        ...(group ? { group } : {}),
      });
      // someone who cannot see it is told it is not there; someone who can see it but did not make it is told no
      expect((await change(s, OMAR, url, to("everyone"))).status, what).toBe(404);
      expect((await change(s, OLIVIA, url, to("group", "part-a"))).status, what).toBe(200);
      expect((await change(s, MINA, url, to("everyone"))).status, what).toBe(403);
      expect((await change(s, BOSS, url, to("private"))).status, what).toBe(200);
    }
    await s.close();
  });

  test("[REQ-054] the update routes no longer change a scope, and a scope change needs nothing else in its body", async () => {
    const { s, made } = await privateSetup();
    const world = await s.send(OLIVIA, "PUT", `/api/worlds/${made.world.id}`, {
      baseDigest: made.world.digest,
      scope: "everyone",
    });
    expect(world.status).toBe(400);
    const model = await s.send(OLIVIA, "PATCH", `/api/models/${made.model.id}`, {
      scope: "everyone",
    });
    expect(model.status).toBe(400);
    const connection = await s.send(OLIVIA, "PUT", `/api/connections/${made.connection.id}/scope`, {
      scope: "group",
      group: "part-a",
    });
    expect(connection.status).toBe(200);
    expect(connection.body.sharing).toMatchObject({
      scope: "group",
      group: "part-a",
      canChange: true,
    });
    await s.close();
  });

  test("[REQ-054] a group scope is refused with a reason when the person has no group, or names one that is not theirs", async () => {
    const s = scopedApp();
    const made = await makeAll(s, LONE, { scope: "everyone" });
    const r = await s.send(LONE, "PUT", `/api/worlds/${made.world.id}/scope`, {
      scope: "group",
    });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain("그룹");
    await s.close();
    const t = scopedApp();
    const mine = await makeAll(t, OLIVIA, { scope: "everyone" });
    const other = await t.send(OLIVIA, "PUT", `/api/worlds/${mine.world.id}/scope`, {
      scope: "group",
      group: "part-b",
    });
    expect(other.status).toBe(400);
    await t.close();
  });

  test("[REQ-054] the answer says what scope it has and whether the viewer may change it", async () => {
    const s = scopedApp();
    const made = await makeAll(s, OLIVIA, { scope: "group", group: "part-a" });
    const mineView = (await s.send(OLIVIA, "GET", `/api/experiments/${made.experiment.id}`)).body;
    expect(mineView.experiment).toMatchObject({ scope: "group", group: "part-a" });
    expect(mineView.canChangeScope).toBe(true);
    const hers = (await s.send(MINA, "GET", `/api/experiments/${made.experiment.id}`)).body;
    expect(hers.canChangeScope).toBe(false);
    const world = (await s.send(MINA, "GET", `/api/worlds/${made.world.id}`)).body;
    expect(world).toMatchObject({ scope: "group", group: "part-a", canChangeScope: false });
    await s.close();
  });

  test("[REQ-054] narrowing a world keeps other people's experiments, which stay readable to their owners", async () => {
    const s = scopedApp();
    const made = await makeAll(s, OLIVIA, { scope: "everyone" });
    const theirs = (
      await s.send(OMAR, "POST", "/api/experiments", {
        name: "오마의 실험",
        recipe: recipe(made.world.id, made.scenario.id, { seeds: [1] }),
      })
    ).body.experiment;
    expect(theirs).toBeDefined();
    expect(
      (
        await s.send(OLIVIA, "PUT", `/api/worlds/${made.world.id}/scope`, {
          scope: "private",
        })
      ).status,
    ).toBe(200);
    // the world is gone from his sight, the experiment is not
    expect((await s.send(OMAR, "GET", `/api/worlds/${made.world.id}`)).status).toBe(404);
    const kept = await s.send(OMAR, "GET", `/api/experiments/${theirs.id}`);
    expect(kept.status).toBe(200);
    expect(kept.body.experiment.id).toBe(theirs.id);
    expect(
      (await s.send(OMAR, "GET", `/api/experiments/${theirs.id}/report?format=md`)).status,
    ).toBe(200);
    await s.close();
  });
});

describe("[REQ-054] counts and boards only hold what everyone may see", () => {
  test("[REQ-054] the leaderboard ignores experiments that are not everyone's", async () => {
    const s = scopedApp();
    const open = await makeAll(s, OLIVIA, { scope: "everyone" });
    const shut = await makeAll(s, MINA, { scope: "private" });
    const board = (await s.send(BOSS, "GET", "/api/leaderboards")).text;
    expect(board).toContain(open.experiment.id);
    expect(board).not.toContain(shut.experiment.id);
    await s.close();
  });

  test("[REQ-054] the world board counts nothing of a private world, even for its maker", async () => {
    const s = scopedApp();
    const shut = await makeAll(s, OLIVIA, { scope: "private" });
    const mine = (await s.send(OLIVIA, "GET", "/api/worlds")).body;
    const row = (mine.worlds ?? mine).find?.((w: any) => w.id === shut.world.id);
    if (row) expect(row.stats?.experiments ?? 0).toBe(0);
    const theirs = (await s.send(OMAR, "GET", "/api/worlds")).text;
    expect(theirs).not.toContain(shut.world.id);
    await s.close();
  });
});

describe("[REQ-038] links to an experiment's report", () => {
  test("[REQ-038] the list of links is for the maker and admins, and a lost link stays lost", async () => {
    const s = scopedApp();
    const made = await makeAll(s, OLIVIA, { scope: "everyone" });
    const url = `/api/experiments/${made.experiment.id}/shares`;
    const created = await s.send(OLIVIA, "POST", url, { expiresInDays: 7 });
    expect(created.status).toBe(200);
    const mine = await s.send(OLIVIA, "GET", url);
    expect(mine.status).toBe(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].createdBy).toBe("olivia");
    expect((await s.send(BOSS, "GET", url)).status).toBe(200);
    expect((await s.send(MINA, "GET", url)).status).toBe(403);
    const priv = await makeAll(s, OLIVIA, { scope: "private" });
    expect(
      (await s.send(OMAR, "GET", `/api/experiments/${priv.experiment.id}/shares`)).status,
    ).toBe(404);
    await s.close();
  });
});
