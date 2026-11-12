/**
 * Visibility scopes (ADR-0174, permissions.md section 5): who sees what, for each scope, in lists, in gets, and in every route that
 * follows its experiment or world. Table-driven: scope x resource x (maker, same-group member, other person, admin).
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  BOSS,
  type Made,
  MINA,
  makeAll,
  OLIVIA,
  OMAR,
  type Person,
  type ScopedApp,
  scopedApp,
} from "./test-support/scoped-app";

type Scope = "private" | "group" | "everyone";
const SCOPES: readonly Scope[] = ["private", "group", "everyone"];

/** Who sees a resource under a scope: the maker always, the group's members under group, everyone under everyone, an admin always. */
const sees = (scope: Scope, who: Person) =>
  who === OLIVIA || who === BOSS || scope === "everyone" || (scope === "group" && who === MINA);

const WHO: readonly [string, Person][] = [
  ["maker", OLIVIA],
  ["same-group member", MINA],
  ["other person", OMAR],
  ["admin", BOSS],
];

const apps = new Map<Scope, { s: ScopedApp; made: Made }>();

beforeAll(async () => {
  for (const scope of SCOPES) {
    const s = scopedApp();
    const made = await makeAll(
      s,
      OLIVIA,
      scope === "group" ? { scope, group: "part-a" } : { scope },
    );
    apps.set(scope, { s, made });
  }
});
afterAll(async () => {
  for (const { s } of apps.values()) await s.close();
});

const at = (scope: Scope) => apps.get(scope) as { s: ScopedApp; made: Made };

describe("[REQ-054] a list holds only what the viewer may see", () => {
  const LISTS: readonly [string, string, (m: Made) => string, (b: any) => any[]][] = [
    ["worlds", "/api/worlds", (m) => m.world.id, (b) => b.worlds ?? b],
    ["scenarios", "/api/scenarios", (m) => m.scenario.id, (b) => b.scenarios ?? b],
    ["experiments", "/api/experiments", (m) => m.experiment.id, (b) => b.experiments ?? b],
    ["connections", "/api/connections", (m) => m.connection.id, (b) => b.connections ?? b],
    ["models", "/api/models", (m) => m.model.id, (b) => b.models ?? b],
  ];
  const cases = SCOPES.flatMap((scope) =>
    LISTS.flatMap(([kind, url, idOf, rows]) =>
      WHO.map(([label, who]) => ({ scope, kind, url, idOf, rows, label, who })),
    ),
  );
  test.each(cases)("$kind under $scope, asked by the $label", async (c) => {
    const { s, made } = at(c.scope);
    const r = await s.send(c.who, "GET", c.url);
    expect(r.status).toBe(200);
    const ids = c.rows(r.body).map((x: any) => x.id ?? x.experiment?.id ?? x.world?.id);
    expect(ids.includes(c.idOf(made))).toBe(sees(c.scope, c.who));
  });
});

describe("[REQ-054] a get of what the viewer may not see answers like 'not found'", () => {
  /** The last is true for a route that answers 404 also for a run with nothing to answer, so only the refusal is read. */
  const GETS: readonly [string, (m: Made) => string, boolean?][] = [
    ["world", (m) => `/api/worlds/${m.world.id}`],
    ["scenario", (m) => `/api/scenarios/${m.scenario.id}`],
    ["scenario runbook draft", (m) => `/api/scenarios/${m.scenario.id}/runbook-draft`],
    ["experiment", (m) => `/api/experiments/${m.experiment.id}`],
    ["experiment report", (m) => `/api/experiments/${m.experiment.id}/report?format=md`],
    ["experiment diagnoses", (m) => `/api/experiments/${m.experiment.id}/diagnoses`],
    ["run", (m) => `/api/runs/${m.run.id}`],
    ["run events", (m) => `/api/runs/${m.run.id}/events`],
    ["run world", (m) => `/api/runs/${m.run.id}/world`],
    ["run telemetry", (m) => `/api/runs/${m.run.id}/telemetry`],
    ["run escalation", (m) => `/api/runs/${m.run.id}/escalation`, true],
  ];
  const cases = SCOPES.flatMap((scope) =>
    GETS.flatMap(([route, urlOf, refusalOnly]) =>
      WHO.map(([label, who]) => ({ scope, route, urlOf, refusalOnly, label, who })),
    ),
  );
  test.each(cases)("$route under $scope, asked by the $label", async (c) => {
    const { s, made } = at(c.scope);
    const r = await s.send(c.who, "GET", c.urlOf(made));
    if (sees(c.scope, c.who)) {
      if (!c.refusalOnly) expect(r.status).not.toBe(404);
    } else {
      expect(r.status).toBe(404);
      // the same words as for something that does not exist, so a name cannot be found by asking
      expect(r.body.error?.code).toBe("not_found");
    }
  });
});

describe("[REQ-054] streams and exports follow the experiment's scope", () => {
  const cases = SCOPES.flatMap((scope) => WHO.map(([label, who]) => ({ scope, label, who })));
  test.each(cases)("twin export under $scope, asked by the $label", async (c) => {
    const { s, made } = at(c.scope);
    const twin = await s.send(c.who, "GET", "/api/twin/diagnoses");
    expect(twin.status).toBe(200);
    expect(twin.text.includes(made.experiment.id)).toBe(sees(c.scope, c.who));
  });
  // a stream that is open stays open, so only the refusals are asked for (what a viewer may see opens, and is read elsewhere)
  test.each(cases.filter((c) => !sees(c.scope, c.who)))(
    "the event streams of an experiment under $scope are closed to the $label",
    async (c) => {
      const { s, made } = at(c.scope);
      for (const url of [
        `/api/experiments/${made.experiment.id}/events`,
        `/api/worlds/${made.world.id}/activity`,
        `/api/runs/${made.run.id}/events`,
      ])
        expect((await s.send(c.who, "GET", url)).status).toBe(404);
    },
  );
});
