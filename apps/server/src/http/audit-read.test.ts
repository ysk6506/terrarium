/**
 * Reading the audit log (ADR-0193): the administrators' listing and file with their filters, newest first and a page at a
 * time; what a person sees of their own things; the reads that are themselves written; and the clock the entries are dated by.
 */
import type { AuditEntryView, AuditOwnView } from "@terrarium/core/contract";
import { afterAll, describe, expect, test } from "vitest";
import { allEntries, traced } from "./test-support/audit-support";
import { type AuditedApp, auditedApp } from "./test-support/audited-app";
import { BOSS, makeAll, OLIVIA, OMAR, type Person } from "./test-support/scoped-app";

async function scenario(s: AuditedApp) {
  const priv = await makeAll(s, OLIVIA, { scope: "private" });
  await s.send(OMAR, "GET", `/api/worlds/${priv.world.id}`);
  await s.send(OMAR, "DELETE", `/api/worlds/${priv.world.id}`);
  await s.send(BOSS, "GET", `/api/worlds/${priv.world.id}`);
  await s.send(OLIVIA, "PUT", `/api/worlds/${priv.world.id}/scope`, { scope: "everyone" });
  const mine = await makeAll(s, OMAR, { scope: "everyone" });
  return { priv, mine };
}

const s: AuditedApp = auditedApp();
afterAll(() => s.close());
const made = await scenario(s);

const list = async (who: Person, query = "") => s.send(who, "GET", `/api/audit${query}`);
const views = (r: { body: Record<string, any> }) => r.body.entries as AuditEntryView[];

describe("the administrators' listing [REQ-054]", () => {
  test("[REQ-054] newest first, each entry with the words a screen shows and the name the thing had", async () => {
    const r = await list(BOSS, "?limit=200");
    expect(r.status).toBe(200);
    const entries = views(r);
    const ids = entries.map((e) => Number(e.id));
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    const world = entries.find(
      (e) => e.action === "world.create" && e.resource.id === made.priv.world.id,
    );
    expect(world).toMatchObject({
      labelKey: "audit.action.world.create",
      label: expect.stringMatching(/세계/),
      outcome: "allowed",
      subject: { id: "olivia", kind: "person", source: "proxy", admin: false },
      resource: { name: "홀", owner: "olivia", scope: "private" },
    });
    const denied = entries.find((e) => e.outcome === "denied");
    expect(denied?.reasonLabel).toEqual(expect.any(String));
  });

  test("[REQ-054] every filter narrows, and together they all must hold", async () => {
    const all = views(await list(BOSS, "?limit=200"));
    const by = (f: (e: AuditEntryView) => boolean) => all.filter(f).map((e) => e.id);
    // every listing writes an entry of its own, newer than the snapshot: leave those out of the comparison
    const known = new Set(all.map((e) => e.id));
    const ids = async (q: string) =>
      views(await list(BOSS, `?limit=200&${q}`))
        .map((e) => e.id)
        .filter((id) => known.has(id));
    expect(await ids("subject=omar")).toEqual(by((e) => e.subject.id === "omar"));
    expect(await ids("action=world.create")).toEqual(by((e) => e.action === "world.create"));
    expect(await ids("outcome=denied")).toEqual(by((e) => e.outcome === "denied"));
    expect(await ids(`resourceKind=world&resourceId=${made.priv.world.id}`)).toEqual(
      by((e) => e.resource.kind === "world" && e.resource.id === made.priv.world.id),
    );
    const mid = all[Math.floor(all.length / 2)] as AuditEntryView;
    const from = encodeURIComponent(mid.at);
    expect(await ids(`from=${from}`)).toEqual(by((e) => e.at >= mid.at));
    expect(await ids(`to=${from}`)).toEqual(by((e) => e.at < mid.at));
    expect(await ids(`from=${from}&to=${from}`)).toEqual([]);
    expect(await ids("subject=omar&outcome=denied&action=world.update")).toEqual(
      by((e) => e.subject.id === "omar" && e.outcome === "denied" && e.action === "world.update"),
    );
    expect(by((e) => e.subject.id === "omar").length).toBeGreaterThan(0);
  });

  test("[REQ-054] pages follow a cursor: no entry twice, none missed, and the last page says it is the last", async () => {
    const all = views(await list(BOSS, "?limit=200")).map((e) => e.id);
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const r = await list(BOSS, `?limit=4${cursor ? `&cursor=${cursor}` : ""}`);
      expect(views(r).length).toBeLessThanOrEqual(4);
      seen.push(...views(r).map((e) => e.id));
      cursor = r.body.next as string | undefined;
      pages += 1;
    } while (cursor && pages < 100);
    // the listing itself writes an entry per page, newer than all of these, so the first page's view is a prefix
    expect(new Set(seen).size).toBe(seen.length);
    expect(all.every((id) => seen.includes(id))).toBe(true);
    expect(pages).toBeGreaterThan(2);
  });

  test("[REQ-054] a bad filter is a 400 in words, and nothing but an admin may ask", async () => {
    expect((await list(BOSS, "?outcome=maybe")).status).toBe(400);
    expect((await list(BOSS, "?from=yesterday")).status).toBe(400);
    expect((await list(BOSS, "?limit=0")).status).toBe(400);
    expect((await list(OLIVIA)).status).toBe(403);
    expect((await list(OMAR, "?subject=olivia")).status).toBe(403);
    const none = await s.app.inject({ method: "GET", url: "/api/audit" });
    expect(none.statusCode).toBe(401);
  });
});

describe("the file [REQ-054]", () => {
  test("[REQ-054] JSON Lines, a line for each entry the filters match, the same as the listing, and a name to save it under", async () => {
    const res = await s.app.inject({
      method: "GET",
      url: "/api/audit/export?subject=olivia",
      headers: {
        "x-terrarium-proxy-secret": "proxy-secret-for-scope-tests-0001",
        "x-forwarded-user": "boss",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/ndjson/);
    expect(res.headers["content-disposition"]).toContain("terrarium-audit.jsonl");
    const lines = res.body
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as AuditEntryView);
    const listed = views(await list(BOSS, "?limit=200&subject=olivia"));
    expect(lines.map((l) => l.id)).toEqual(listed.map((l) => l.id));
    expect(lines.length).toBeGreaterThan(5);
    expect(lines.every((l) => l.subject.id === "olivia")).toBe(true);
  });

  test("[REQ-054] only an admin may download it", async () => {
    expect((await s.send(OLIVIA, "GET", "/api/audit/export")).status).toBe(403);
  });
});

describe("what a person sees of their own things [REQ-054]", () => {
  const own = async (who: Person, query = "") =>
    (await s.send(who, "GET", `/api/audit/mine${query}`)).body.entries as AuditOwnView[];

  test("[REQ-054] who, when, what and how it ended, for what they made: the stranger's refused try and the admin's read among them", async () => {
    const mine = await own(OLIVIA, "?limit=200");
    const world = mine.filter((e) => e.resource.id === made.priv.world.id);
    expect(world.map((e) => `${e.who.id}:${e.action}:${e.outcome}`)).toEqual(
      expect.arrayContaining([
        "olivia:world.create:allowed",
        "omar:world.read:denied",
        "omar:world.delete:denied",
        "boss:world.read:allowed",
        "olivia:scope.change:allowed",
      ]),
    );
    for (const e of mine) {
      expect(Object.keys(e).sort()).toEqual([
        "action",
        "at",
        "id",
        "label",
        "labelKey",
        "outcome",
        "resource",
        "who",
      ]);
      expect(Object.keys(e.who).sort()).toEqual(["id", "name"]);
    }
    const text = JSON.stringify(mine);
    for (const secret of [
      "requestId",
      "reason",
      "remoteAddress",
      "changes",
      "fields",
      "route",
      "owner",
    ])
      expect(text).not.toContain(`"${secret}"`);
  });

  test("[REQ-054] only their own things: another person's list has nothing of the first person's, and the filters apply", async () => {
    const theirs = await own(OMAR, "?limit=200");
    expect(theirs.every((e) => e.resource.id !== made.priv.world.id)).toBe(true);
    expect(theirs.some((e) => e.resource.id === made.mine.world.id)).toBe(true);
    expect(
      (await own(OLIVIA, "?limit=200&outcome=denied")).every((e) => e.outcome === "denied"),
    ).toBe(true);
    expect(await own(OLIVIA, `?resourceKind=world&resourceId=${made.mine.world.id}`)).toEqual([]);
    const sign = await own(BOSS, "?limit=200");
    expect(sign.every((e) => e.resource.kind !== "session")).toBe(true);
  });

  test("[REQ-054] it pages like the listing, and a bad filter is a 400", async () => {
    const first = await s.send(OLIVIA, "GET", "/api/audit/mine?limit=2");
    expect(first.body.entries).toHaveLength(2);
    expect(first.body.next).toEqual(expect.any(String));
    const next = await s.send(OLIVIA, "GET", `/api/audit/mine?limit=2&cursor=${first.body.next}`);
    const ids = [...first.body.entries, ...next.body.entries].map((e: AuditOwnView) => e.id);
    expect(new Set(ids).size).toBe(4);
    expect((await s.send(OLIVIA, "GET", "/api/audit/mine?outcome=maybe")).status).toBe(400);
    // a filter by who is not part of this view
    expect((await s.send(OLIVIA, "GET", "/api/audit/mine?subject=omar")).status).toBe(400);
  });
});

describe("reading the log is written too [REQ-054]", () => {
  test.each([
    ["the listing", BOSS, "/api/audit?outcome=denied&limit=5", "audit.read", ["outcome", "limit"]],
    ["the file", BOSS, "/api/audit/export?subject=olivia", "audit.export", ["subject"]],
    ["the person's own view", OLIVIA, "/api/audit/mine", "audit.read_own", undefined],
  ] as const)(
    "[REQ-054] %s: one entry with who asked and which filters, not the values",
    async (_n, who, url, action, fields) => {
      const { entries } = await traced(s, who, "GET", url);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        action,
        outcome: "allowed",
        subject: { id: who.login },
        resource: { kind: "audit" },
      });
      expect(entries[0]?.fields).toEqual(fields);
      expect(JSON.stringify(entries[0])).not.toContain('olivia"}]');
    },
  );

  test("[REQ-054] a refused attempt to read it is written as a refusal", async () => {
    const { res, entries } = await traced(s, OMAR, "GET", "/api/audit/export");
    expect(res.status).toBe(403);
    expect(entries).toMatchObject([
      { action: "audit.export", outcome: "denied", reason: "not_admin", subject: { id: "omar" } },
    ]);
  });
});

describe("the clock [REQ-054]", () => {
  test("[REQ-054] entries are dated by the clock the platform was given: the same run, the same times, in order", async () => {
    const times = async () => {
      const a = auditedApp();
      await scenario(a);
      const at = (await allEntries(a.audit)).map((e) => e.at);
      await a.close();
      return at;
    };
    const [one, two] = [await times(), await times()];
    expect(one).toEqual(two);
    expect(one.length).toBeGreaterThan(10);
    expect(one.every((t) => t.startsWith("2026-10-29"))).toBe(true);
    expect([...one].sort()).toEqual(one);
  });
});
