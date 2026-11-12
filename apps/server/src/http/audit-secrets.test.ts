/**
 * What the audit log never holds (ADR-0193, permissions.md section 6): a recognisable secret is put into every part of every
 * route's input, and the store, the export, the metrics and the server's log lines are searched for it afterwards.
 */
import { ROUTES } from "@terrarium/core/contract";
import { afterAll, describe, expect, test } from "vitest";
import { auditMetricsText } from "../runtime";
import { allEntries } from "./test-support/audit-support";
import { auditedApp } from "./test-support/audited-app";
import { BOSS, makeAll, OLIVIA } from "./test-support/scoped-app";

const PLANT = "PLANTED-secret-7c41d9";
const KEY_PLANT = "PLANTEDKEY7c41d9";
const PROXY_SECRET = "proxy-secret-for-scope-tests-0001";
const SECRET_FIELDS = [
  "apiKey",
  "token",
  "password",
  "secret",
  "authorization",
  "name",
  "title",
  "note",
  "text",
  "url",
];

const lines: { action: string; outcome: string }[] = [];
const s = auditedApp({ auditLine: (l) => lines.push(l) });
afterAll(() => s.close());

/** Every part of a call that a person controls, carrying the plant. */
async function call(who: typeof OLIVIA, name: string, ids: string) {
  const spec = ROUTES[name as keyof typeof ROUTES];
  const url = spec.path.replace(/:\w+/g, ids);
  const query = new URLSearchParams([
    ...SECRET_FIELDS.map((k) => [k, PLANT]),
    [KEY_PLANT, PLANT],
  ]).toString();
  const body = {
    ...Object.fromEntries(SECRET_FIELDS.map((k) => [k, PLANT])),
    [KEY_PLANT]: PLANT,
    nested: { apiKey: PLANT, list: [PLANT] },
    scope: PLANT,
    group: PLANT,
  };
  const hasBody = spec.method !== "GET";
  return s.app.inject({
    method: spec.method,
    url: `${url}?${query}`,
    headers: {
      "x-terrarium-proxy-secret": PROXY_SECRET,
      "x-forwarded-user": who.login,
      "x-forwarded-groups": who.groups.join(","),
      authorization: `Bearer ${PLANT}`,
      cookie: `session=${PLANT}`,
      "x-api-key": PLANT,
      "x-request-id": PLANT,
      referer: `https://example.test/${PLANT}`,
    },
    ...(hasBody ? { payload: body } : {}),
  });
}

const names = (Object.keys(ROUTES) as (keyof typeof ROUTES)[]).filter(
  (n) => ROUTES[n].produces !== "sse",
);

describe("a planted secret never reaches the audit log [REQ-054]", () => {
  test("[REQ-054] in the path, the query, the body, the headers: every route, with ids that are nothing and ids that are real", async () => {
    const made = await makeAll(s, OLIVIA, { scope: "private" });
    for (const who of [OLIVIA, BOSS]) {
      for (const name of names) {
        await call(who, name, PLANT);
        await call(who, name, made.world.id);
      }
    }
    // a sign-in that fails carries the plant as the user and as a wrong secret
    await s.app.inject({
      method: "GET",
      url: "/api/meta",
      headers: { "x-terrarium-proxy-secret": PLANT, "x-forwarded-user": PLANT },
    });
    const entries = await allEntries(s.audit);
    expect(entries.length).toBeGreaterThan(names.length);
    const stored = JSON.stringify(entries);
    // the test can fail: the names of what was sent are kept, so the search is looking at entries that were written from this input
    expect(stored).toContain('"fields"');
    expect(stored).not.toContain(PLANT);
    expect(stored).not.toContain(KEY_PLANT);
    expect(stored).not.toContain(PROXY_SECRET);
    expect(stored).not.toContain("sk-olivia-secret-0001");
    expect(stored).not.toContain("olivia-secret");
    expect(stored.toLowerCase()).not.toContain("authorization");
    expect(stored.toLowerCase()).not.toContain("bearer");
  });

  test("[REQ-054] nor in what the log gives back, the file, the counters or the server's log", async () => {
    const list = await s.send(BOSS, "GET", "/api/audit?limit=200");
    const file = await s.send(BOSS, "GET", "/api/audit/export");
    const mine = await s.send(OLIVIA, "GET", "/api/audit/mine?limit=200");
    const metrics = auditMetricsText(s.platform.audit.counts());
    for (const text of [list.text, file.text, mine.text, metrics, JSON.stringify(lines)]) {
      expect(text).not.toContain(PLANT);
      expect(text).not.toContain(PROXY_SECRET);
    }
  });

  test("[REQ-054] the values an entry may hold are the scope, group, role, owner and sharing ones, and no others", async () => {
    const entries = await allEntries(s.audit);
    const fields = new Set(entries.flatMap((e) => (e.changes ?? []).map((c) => c.field)));
    for (const f of fields) expect(["scope", "group", "role", "owner", "sharing"]).toContain(f);
  });
});
