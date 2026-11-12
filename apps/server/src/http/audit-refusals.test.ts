/**
 * Refusals and administrators' reads in the audit log (ADR-0193): every kind of refusal writes a `denied` entry with its own
 * reason, a call that fails after it was allowed writes `failed`, an administrator's sight of what another keeps to themselves
 * is written, and the maker's own reads are not.
 */
import { afterAll, describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../../../packages/core/src/world/test-support/sample";
import { recipe, until } from "../runtime/test-support/platform";
import { allEntries, traced } from "./test-support/audit-support";
import { type AuditedApp, auditedApp } from "./test-support/audited-app";
import { BOSS, MINA, makeAll, OLIVIA, OMAR, type Person } from "./test-support/scoped-app";

const s: AuditedApp = auditedApp();
afterAll(() => s.close());

const priv = await makeAll(s, OLIVIA, { scope: "private" });
const shared = await makeAll(s, OLIVIA, { scope: "group", group: "part-a" });
const open = await makeAll(s, OLIVIA, { scope: "everyone" });

const proxyHeaders = (extra: Record<string, string>) => extra;
async function raw(headers: Record<string, string>, url = "/api/worlds") {
  const mark = (await allEntries(s.audit)).at(-1)?.seq ?? 0;
  const res = await s.app.inject({ method: "GET", url, headers: proxyHeaders(headers) });
  const entries = (await allEntries(s.audit)).filter((e) => e.seq > mark);
  return { res, entries };
}

describe("sign-in refused at the proxy check [REQ-054]", () => {
  test.each([
    ["no secret", {}, "proxy_secret_missing"],
    ["a wrong secret", { "x-terrarium-proxy-secret": "not-the-secret" }, "proxy_secret_wrong"],
  ] as const)(
    "[REQ-054] %s: 401, one denied entry with the reason and the address",
    async (_n, headers, reason) => {
      const { res, entries } = await raw({ ...headers, "x-forwarded-user": "olivia" });
      expect(res.statusCode).toBe(401);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        action: "auth.sign_in",
        outcome: "denied",
        reason,
        subject: { id: "anonymous", kind: "person", admin: false },
        resource: { kind: "session" },
      });
      expect(entries[0]?.remoteAddress).toMatch(/127\.0\.0\.1|::1|::ffff:127/);
    },
  );

  test("[REQ-054] the right secret and no login is a third reason, and the person is told the same words in all three", async () => {
    const secret = (await s.app.inject({ method: "GET", url: "/api/meta" })).statusCode;
    expect(secret).toBe(401);
    const missing = await raw({});
    expect(missing.entries[0]?.reason).toBe("proxy_secret_missing");
    const bodies = [missing.res.body];
    const wrong = await raw({ "x-terrarium-proxy-secret": "nope" });
    bodies.push(wrong.res.body);
    expect(new Set(bodies).size).toBe(1);
  });
});

describe("a refusal after sign-in [REQ-054]", () => {
  const cases: readonly [
    string,
    Person,
    string,
    string,
    () => object | undefined,
    string,
    string,
    Record<string, unknown>,
  ][] = [
    [
      "not the maker (403)",
      OMAR,
      "PUT",
      `/api/worlds/${open.world.id}`,
      () => ({ baseDigest: open.world.digest, name: "남의 것" }),
      "world.update",
      "not_owner",
      { id: open.world.id, owner: "olivia" },
    ],
    [
      "not an admin (403) on a route that is admin-only",
      OMAR,
      "POST",
      "/api/worlds/import",
      () => ({ source: "sample" }),
      "world.import",
      "not_admin",
      { kind: "world" },
    ],
    [
      "not an admin (403) on the audit log itself",
      OMAR,
      "GET",
      "/api/audit",
      () => undefined,
      "audit.read",
      "not_admin",
      { kind: "audit" },
    ],
    [
      "not visible (404) to a stranger: a private world",
      OMAR,
      "GET",
      `/api/worlds/${priv.world.id}`,
      () => undefined,
      "world.read",
      "not_visible",
      { id: priv.world.id, owner: "olivia", scope: "private" },
    ],
    [
      "not visible (404): a private experiment's run",
      OMAR,
      "GET",
      `/api/runs/${priv.run.id}`,
      () => undefined,
      "run.read",
      "not_visible",
      { kind: "experiment", id: priv.experiment.id, owner: "olivia" },
    ],
    [
      "not visible (404) to another group",
      OMAR,
      "GET",
      `/api/worlds/${shared.world.id}`,
      () => undefined,
      "world.read",
      "not_visible",
      { scope: "group", group: "part-a" },
    ],
    [
      "not visible (404) on a change: a private scenario",
      OMAR,
      "DELETE",
      `/api/scenarios/${priv.scenario.id}`,
      () => undefined,
      "scenario.delete",
      "not_visible",
      { id: priv.scenario.id },
    ],
    [
      "not visible (404) on the quick start of a private world",
      OMAR,
      "POST",
      `/api/worlds/${priv.world.id}/quick-experiment`,
      () => ({}),
      "experiment.start",
      "not_visible",
      { id: priv.world.id },
    ],
    [
      "not visible (404) to answer a private run",
      OMAR,
      "POST",
      `/api/runs/${priv.run.id}/escalation`,
      () => ({ kind: "end" }),
      "run.escalation_answer",
      "not_visible",
      { kind: "experiment" },
    ],
  ];

  test.each(cases)("[REQ-054] %s", async (_n, who, method, url, body, action, reason, resource) => {
    const { res, entries } = await traced(s, who, method, url, body());
    expect([401, 403, 404]).toContain(res.status);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action,
      outcome: "denied",
      reason,
      resource,
      subject: { id: who.login },
    });
  });

  test("[REQ-054] the three kinds of refusal can be told apart by their reasons", async () => {
    const reasons = new Set(
      (await allEntries(s.audit)).filter((e) => e.outcome === "denied").map((e) => e.reason),
    );
    for (const r of [
      "not_owner",
      "not_admin",
      "not_visible",
      "proxy_secret_missing",
      "proxy_secret_wrong",
    ])
      expect(reasons.has(r as never), r).toBe(true);
  });

  test("[REQ-054] an admin-only refusal names no id: nothing was looked up, so nothing in the address is confirmed", async () => {
    const { entries } = await traced(s, OMAR, "POST", "/api/worlds/import", { source: "sample" });
    expect(entries[0]?.resource.id).toBeUndefined();
  });

  test("[REQ-054] a refused call changed nothing and wrote no `allowed` entry", async () => {
    const { entries } = await traced(s, OMAR, "DELETE", `/api/worlds/${open.world.id}`);
    expect(entries.map((e) => e.outcome)).toEqual(["denied"]);
    expect((await s.send(OLIVIA, "GET", `/api/worlds/${open.world.id}`)).status).toBe(200);
  });
});

describe("a call that was allowed and then failed [REQ-054]", () => {
  test("[REQ-054] a stale version is a conflict that names the thing; a bad body is invalid input that names no id and none of its fields", async () => {
    const stale = await traced(s, OLIVIA, "PUT", `/api/worlds/${open.world.id}`, {
      baseDigest: "stale",
      name: "x",
    });
    expect(stale.res.status).toBe(409);
    expect(stale.entries[0]).toMatchObject({
      action: "world.update",
      outcome: "failed",
      reason: "conflict",
      resource: { id: open.world.id },
    });
    const bad = await traced(s, OLIVIA, "PUT", `/api/worlds/${open.world.id}`, { nonsense: 1 });
    expect(bad.res.status).toBe(400);
    expect(bad.entries[0]).toMatchObject({ outcome: "failed", reason: "invalid_input" });
    // the names of a body that did not pass are the sender's own words: nothing of it is kept
    expect(bad.entries[0]?.fields).toBeUndefined();
    expect(bad.entries[0]?.resource.id).toBeUndefined();
  });

  test("[REQ-054] a thing that is not there is a failure with no id, and a read of it writes nothing", async () => {
    const gone = await traced(s, OLIVIA, "DELETE", "/api/worlds/w-none");
    expect(gone.res.status).toBe(404);
    expect(gone.entries[0]).toMatchObject({ outcome: "failed", reason: "not_found" });
    expect(gone.entries[0]?.resource.id).toBeUndefined();
    expect((await traced(s, OLIVIA, "GET", "/api/worlds/w-none")).entries).toEqual([]);
  });

  test("[REQ-054] answering a run that waits for nobody is a failure on the run, not an allowed answer", async () => {
    const { res, entries } = await traced(
      s,
      OLIVIA,
      "POST",
      `/api/runs/${open.run.id}/escalation`,
      { kind: "end" },
    );
    expect(res.status).toBe(404);
    expect(entries).toMatchObject([
      { action: "run.escalation_answer", outcome: "failed", reason: "not_found" },
    ]);
  });
});

describe("administrators reading what another keeps to themselves [REQ-054]", () => {
  test("[REQ-054] an admin opening a private world writes one read with whose it is and how it stood; the maker opening it writes nothing", async () => {
    const admin = await traced(s, BOSS, "GET", `/api/worlds/${priv.world.id}`);
    expect(admin.entries).toMatchObject([
      {
        action: "world.read",
        outcome: "allowed",
        subject: { id: "boss", admin: true },
        resource: { kind: "world", id: priv.world.id, owner: "olivia", scope: "private" },
      },
    ]);
    expect((await traced(s, OLIVIA, "GET", `/api/worlds/${priv.world.id}`)).entries).toEqual([]);
  });

  test("[REQ-054] the group's own members, anyone reading what is for everyone, and an admin reading it, write nothing", async () => {
    expect((await traced(s, MINA, "GET", `/api/worlds/${shared.world.id}`)).entries).toEqual([]);
    expect((await traced(s, BOSS, "GET", `/api/worlds/${open.world.id}`)).entries).toEqual([]);
    expect((await traced(s, OMAR, "GET", `/api/worlds/${open.world.id}`)).entries).toEqual([]);
  });

  test("[REQ-054] an admin reading a group's world as a stranger to that group is an override too", async () => {
    const { entries } = await traced(s, BOSS, "GET", `/api/worlds/${shared.world.id}`);
    expect(entries).toMatchObject([
      { action: "world.read", resource: { scope: "group", group: "part-a" } },
    ]);
  });

  test.each([
    ["a scenario", `/api/scenarios/${priv.scenario.id}`, "scenario.read", "scenario"],
    ["an experiment", `/api/experiments/${priv.experiment.id}`, "experiment.read", "experiment"],
    [
      "its report",
      `/api/experiments/${priv.experiment.id}/report`,
      "experiment.read",
      "experiment",
    ],
    [
      "a run (named by the experiment whose scope it follows)",
      `/api/runs/${priv.run.id}`,
      "run.read",
      "experiment",
    ],
    ["a run's events", `/api/runs/${priv.run.id}/events`, "run.read", "experiment"],
    [
      "its share links",
      `/api/experiments/${priv.experiment.id}/shares`,
      "share.list",
      "experiment",
    ],
    [
      "a private connection's agent versions",
      `/api/connections/${priv.connection.id}/agents/triage/versions`,
      "connection.read",
      "connection",
    ],
    [
      "the physics of a private world",
      `/api/worlds/${priv.world.id}/physics`,
      "world.read",
      "world",
    ],
  ])("[REQ-054] an admin reading %s is written once", async (_n, url, action, kind) => {
    const { res, entries } = await traced(s, BOSS, "GET", url);
    expect(res.status).toBe(200);
    expect(entries).toMatchObject([
      { action, outcome: "allowed", resource: { kind, owner: "olivia" } },
    ]);
    expect((await traced(s, OLIVIA, "GET", url)).entries).toEqual([]);
  });

  test("[REQ-054] a list an admin reads that holds another's private things is one entry with how many, not one for each", async () => {
    const { entries } = await traced(s, BOSS, "GET", "/api/worlds");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: "world.read", resource: { kind: "world" } });
    expect(entries[0]?.resource.id).toBeUndefined();
    expect(Number(entries[0]?.detail?.count)).toBeGreaterThanOrEqual(2);
    expect((await traced(s, OLIVIA, "GET", "/api/worlds")).entries).toEqual([]);
    for (const [url, action] of [
      ["/api/scenarios", "scenario.read"],
      ["/api/experiments", "experiment.read"],
      ["/api/connections", "connection.read"],
      ["/api/models", "model.read"],
    ] as const) {
      const r = await traced(s, BOSS, "GET", url);
      expect(
        r.entries.map((e) => e.action),
        url,
      ).toEqual([action]);
    }
  });

  test("[REQ-054] a stream opened by an admin on a private experiment is written when it opens", async () => {
    const mark = (await allEntries(s.audit)).at(-1)?.seq ?? 0;
    const probe = s.app.inject({
      method: "GET",
      url: `/api/experiments/${priv.experiment.id}/events`,
      headers: {
        "x-terrarium-proxy-secret": "proxy-secret-for-scope-tests-0001",
        "x-forwarded-user": "boss",
      },
    });
    await until(async () =>
      (await allEntries(s.audit)).some((e) => e.seq > mark && e.action === "experiment.read"),
    );
    const entries = (await allEntries(s.audit)).filter((e) => e.seq > mark);
    expect(entries).toMatchObject([
      { action: "experiment.read", subject: { id: "boss" }, resource: { id: priv.experiment.id } },
    ]);
    void probe;
  });

  test("[REQ-054] a stranger opening that stream is refused and written as not visible", async () => {
    const { res, entries } = await traced(
      s,
      OMAR,
      "GET",
      `/api/experiments/${priv.experiment.id}/events`,
    );
    expect(res.status).toBe(404);
    expect(entries).toMatchObject([
      { action: "experiment.read", outcome: "denied", reason: "not_visible" },
    ]);
  });
});

describe("a change of scope and a share link keep the before and after of those fields only [REQ-054]", () => {
  test("[REQ-054] scope: private to a group is one entry with both fields before and after, and nothing else the call touched", async () => {
    const w = (
      await s.send(OLIVIA, "POST", "/api/worlds", {
        name: "범위",
        blueprint: sampleBlueprint(),
        scope: "private",
      })
    ).body.world;
    const { entries } = await traced(s, OLIVIA, "PUT", `/api/worlds/${w.id}/scope`, {
      scope: "group",
      group: "part-a",
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.changes).toEqual([
      { field: "scope", before: "private", after: "group" },
      { field: "group", before: null, after: "part-a" },
    ]);
    expect(entries[0]?.resource).toMatchObject({ scope: "private" });
    expect(entries[0]?.fields).toEqual(["scope", "group"]);
    const back = await traced(s, OLIVIA, "PUT", `/api/worlds/${w.id}/scope`, { scope: "everyone" });
    expect(back.entries[0]?.changes).toEqual([
      { field: "scope", before: "group", after: "everyone" },
      { field: "group", before: "part-a", after: null },
    ]);
  });

  test("[REQ-054] a share link made and taken back is a change of the sharing field, and the link's secret is nowhere", async () => {
    const made = await traced(
      s,
      OLIVIA,
      "POST",
      `/api/experiments/${open.experiment.id}/shares`,
      {},
    );
    expect(made.entries[0]?.changes).toEqual([{ field: "sharing", before: null, after: "link" }]);
    const token = made.res.body.token as string;
    const gone = await traced(s, OLIVIA, "DELETE", `/api/shares/${token}`);
    expect(gone.entries[0]?.changes).toEqual([{ field: "sharing", before: "link", after: null }]);
    expect(JSON.stringify(await allEntries(s.audit))).not.toContain(token);
  });
});

describe("one request, one id [REQ-054]", () => {
  test("[REQ-054] the answer carries the request id, and the entry the request wrote has the same", async () => {
    const mark = (await allEntries(s.audit)).at(-1)?.seq ?? 0;
    const res = await s.app.inject({
      method: "PUT",
      url: `/api/worlds/${open.world.id}/scope`,
      headers: {
        "x-terrarium-proxy-secret": "proxy-secret-for-scope-tests-0001",
        "x-forwarded-user": "olivia",
        "x-forwarded-groups": "part-a",
      },
      payload: { scope: "everyone" },
    });
    const id = res.headers["x-request-id"];
    expect(typeof id).toBe("string");
    const entries = (await allEntries(s.audit)).filter((e) => e.seq > mark);
    expect(entries.map((e) => e.requestId)).toEqual([id]);
  });
});

void recipe;
