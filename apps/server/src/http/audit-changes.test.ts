/**
 * Every route that changes something writes exactly one `allowed` entry with the right action and thing, written by the one
 * recording point and not by the handler (ADR-0193). A table with a row per route; a second test fails when a route of the
 * contract that changes something has no row.
 */
import { AUDIT_CLASSES, ROUTES, type RouteName } from "@terrarium/core/contract";
import type { AuditAction } from "@terrarium/core/experiments";
import { afterAll, describe, expect, test } from "vitest";
import { DEFAULT_SHAPE } from "../../../../packages/core/src/sources/worldgen";
import { sampleBlueprint } from "../../../../packages/core/src/world/test-support/sample";
import { recipe, until } from "../runtime/test-support/platform";
import { traced } from "./test-support/audit-support";
import { type AuditedApp, auditedApp } from "./test-support/audited-app";
import { BOSS, makeAll, OLIVIA, OMAR, type Person } from "./test-support/scoped-app";

const s: AuditedApp = auditedApp();
afterAll(async () => {
  // the quick experiment runs in real time: stop what is still going so the server can stop
  const all = (await s.send(BOSS, "GET", "/api/experiments")).body as unknown as {
    experiment: { id: string };
  }[];
  for (const e of all) await s.send(BOSS, "POST", `/api/experiments/${e.experiment.id}/cancel`);
  await s.close();
}, 60_000);

type Body = Record<string, any>;
const call = async (who: Person, method: string, url: string, payload?: object): Promise<Body> => {
  const r = await s.send(who, method, url, payload);
  if (r.status >= 300) throw new Error(`${method} ${url} -> ${r.status} ${r.text}`);
  return r.body;
};

/** Things a row can use, made once; a row that destroys something makes its own. */
const base = await (async () => {
  const made = await makeAll(s, OLIVIA, { scope: "everyone" });
  return made;
})();

interface Row {
  readonly route: RouteName;
  readonly who: Person;
  /** The request; may make what it needs first (those calls are not the one measured). */
  readonly request: () => Promise<readonly [string, string, object?]>;
  readonly action: AuditAction;
  readonly kind: string;
  /** The id the entry names: given, or read from the answer. */
  readonly id?: string | ((answer: Body) => string | undefined);
  /** The answer's status, when it is not 200. */
  readonly status?: number;
}

const world = async () =>
  (await call(OLIVIA, "POST", "/api/worlds", { name: "버릴 세계", blueprint: sampleBlueprint() }))
    .world;
const scenario = async () =>
  (
    await call(OLIVIA, "POST", "/api/scenarios", {
      worldId: base.world.id,
      templateId: "cooling-failure",
    })
  ).scenario;
const model = async (scope: "private" | "everyone" = "private") =>
  call(OLIVIA, "POST", "/api/models", {
    name: `모델 ${Math.random().toString(36).slice(2, 8)}`,
    kind: "openai",
    baseUrl: "https://llm.test/v1",
    apiKey: "sk-test-0001",
    scope,
  });
const connection = async () =>
  call(OLIVIA, "POST", "/api/connections", {
    connector: "http",
    name: `연결 ${Math.random().toString(36).slice(2, 8)}`,
    config: { url: "https://harness.test", token: "t-0001" },
  });
const experiment = async () => {
  const e = (
    await call(OLIVIA, "POST", "/api/experiments", {
      name: "버릴 실험",
      recipe: recipe(base.world.id, base.scenario.id, { seeds: [1] }),
    })
  ).experiment;
  await until(
    async () => (await call(OLIVIA, "GET", `/api/experiments/${e.id}`)).progress.finished === 1,
  );
  return e;
};
const card = async () =>
  call(OLIVIA, "POST", "/api/service-cards", { name: "카드", card: "cache" });
const preset = async () =>
  call(OLIVIA, "POST", "/api/presets", {
    kind: "instruction",
    name: `지시 ${Math.random()}`,
    body: "복구 먼저",
  });

const ROWS: readonly Row[] = [
  {
    route: "createConnection",
    who: OLIVIA,
    action: "connection.create",
    kind: "connection",
    id: (a) => a.id,
    request: async () => [
      "POST",
      "/api/connections",
      { connector: "http", name: "새 연결", config: { url: "https://harness.test", token: "t-9" } },
    ],
  },
  {
    route: "updateConnection",
    who: OLIVIA,
    action: "connection.update",
    kind: "connection",
    id: (a) => a.id,
    request: async () => {
      const c = await connection();
      return [
        "PUT",
        `/api/connections/${c.id}`,
        { name: "고친 연결", config: { url: "https://harness.test" } },
      ];
    },
  },
  {
    route: "tryConnection",
    who: OLIVIA,
    action: "connection.try",
    kind: "connection",
    request: async () => {
      const c = await connection();
      return ["POST", `/api/connections/${c.id}/try`, { agentId: "triage", text: "안녕" }];
    },
  },
  {
    route: "keepConnection",
    who: OLIVIA,
    action: "connection.keep",
    kind: "connection",
    request: async () => {
      const c = await connection();
      return ["POST", `/api/connections/${c.id}/keep`];
    },
  },
  {
    route: "recheckConnection",
    who: OLIVIA,
    action: "connection.check",
    kind: "connection",
    request: async () => {
      const c = await connection();
      return ["POST", `/api/connections/${c.id}/check`];
    },
  },
  {
    route: "deleteConnection",
    who: OLIVIA,
    action: "connection.delete",
    kind: "connection",
    request: async () => {
      const c = await connection();
      return ["DELETE", `/api/connections/${c.id}`];
    },
  },
  {
    route: "setConnectionScope",
    who: OLIVIA,
    action: "scope.change",
    kind: "connection",
    request: async () => {
      const c = await connection();
      return ["PUT", `/api/connections/${c.id}/scope`, { scope: "group", group: "part-a" }];
    },
  },
  {
    route: "addAgentVersion",
    who: OLIVIA,
    action: "connection.agent_version_add",
    kind: "connection",
    request: async () => {
      const c = await connection();
      return [
        "POST",
        `/api/connections/${c.id}/agents/triage/versions`,
        { label: "수동", attributes: { prompt: "v3" } },
      ];
    },
  },
  {
    route: "editAgentVersion",
    who: OLIVIA,
    action: "connection.agent_version_update",
    kind: "connection",
    request: async () => {
      const c = await connection();
      const url = `/api/connections/${c.id}/agents/triage/versions`;
      await call(OLIVIA, "POST", url, { label: "수동", attributes: { prompt: "v3" } });
      return ["PUT", `${url}/1`, { note: "메모" }];
    },
  },
  {
    route: "deleteAgentVersion",
    who: OLIVIA,
    action: "connection.agent_version_delete",
    kind: "connection",
    request: async () => {
      const c = await connection();
      const url = `/api/connections/${c.id}/agents/triage/versions`;
      await call(OLIVIA, "POST", url, { label: "수동", attributes: { prompt: "v3" } });
      return ["DELETE", `${url}/1`];
    },
  },

  {
    route: "savePreset",
    who: OLIVIA,
    action: "preset.save",
    kind: "preset",
    id: (a) => a.id,
    request: async () => [
      "POST",
      "/api/presets",
      { kind: "instruction", name: "지시", body: "복구 먼저" },
    ],
  },
  {
    route: "importPresets",
    who: OLIVIA,
    action: "preset.import",
    kind: "preset",
    request: async () => [
      "POST",
      "/api/presets/import",
      { items: [{ kind: "instruction", name: "옮김", body: "복구 먼저" }] },
    ],
  },
  {
    route: "renamePreset",
    who: OLIVIA,
    action: "preset.rename",
    kind: "preset",
    request: async () => {
      const p = await preset();
      return ["PUT", `/api/presets/${p.id}`, { name: "새 이름" }];
    },
  },
  {
    route: "deletePreset",
    who: OLIVIA,
    action: "preset.delete",
    kind: "preset",
    request: async () => {
      const p = await preset();
      return ["DELETE", `/api/presets/${p.id}`];
    },
  },
  {
    route: "restorePreset",
    who: OLIVIA,
    action: "preset.restore",
    kind: "preset",
    request: async () => {
      const p = await preset();
      await call(OLIVIA, "DELETE", `/api/presets/${p.id}`);
      return ["POST", `/api/presets/${p.id}/restore`];
    },
  },

  {
    route: "createModel",
    who: OLIVIA,
    action: "model.create",
    kind: "model",
    id: (a) => a.id,
    request: async () => [
      "POST",
      "/api/models",
      { name: "새 모델", kind: "openai", baseUrl: "https://llm.test/v1", apiKey: "sk-9" },
    ],
  },
  {
    route: "updateModel",
    who: OLIVIA,
    action: "model.update",
    kind: "model",
    request: async () => {
      const m = await model();
      return ["PATCH", `/api/models/${m.id}`, { name: "고친 모델" }];
    },
  },
  {
    route: "deleteModel",
    who: OLIVIA,
    action: "model.delete",
    kind: "model",
    request: async () => {
      const m = await model();
      return ["DELETE", `/api/models/${m.id}`];
    },
  },
  {
    route: "checkModel",
    who: OLIVIA,
    action: "model.check",
    kind: "model",
    request: async () => {
      const m = await model();
      return ["POST", `/api/models/${m.id}/check`];
    },
  },
  {
    route: "setDefaultModel",
    who: BOSS,
    action: "model.set_default",
    kind: "model",
    request: async () => {
      const m = await model("everyone");
      return ["POST", `/api/models/${m.id}/default`];
    },
  },
  {
    route: "setModelScope",
    who: OLIVIA,
    action: "scope.change",
    kind: "model",
    request: async () => {
      const m = await model();
      return ["PUT", `/api/models/${m.id}/scope`, { scope: "everyone" }];
    },
  },

  {
    route: "createWorld",
    who: OLIVIA,
    action: "world.create",
    kind: "world",
    id: (a) => a.world.id,
    request: async () => ["POST", "/api/worlds", { name: "새 세계", blueprint: sampleBlueprint() }],
  },
  {
    route: "generateWorld",
    who: OLIVIA,
    action: "world.generate",
    kind: "world",
    id: (a) => a.world.id,
    request: async () => [
      "POST",
      "/api/worlds/generate",
      { shape: { ...DEFAULT_SHAPE, servers: 24 } },
    ],
  },
  {
    route: "updateWorld",
    who: OLIVIA,
    action: "world.update",
    kind: "world",
    request: async () => {
      const w = await world();
      return ["PUT", `/api/worlds/${w.id}`, { baseDigest: w.digest, name: "고친 세계" }];
    },
  },
  {
    route: "deleteWorld",
    who: OLIVIA,
    action: "world.delete",
    kind: "world",
    request: async () => {
      const w = await world();
      return ["DELETE", `/api/worlds/${w.id}`];
    },
  },
  {
    route: "putWorldPhysics",
    who: OLIVIA,
    action: "world.physics_update",
    kind: "world",
    request: async () => {
      const w = await world();
      return [
        "PUT",
        `/api/worlds/${w.id}/physics`,
        { profile: { base: "v1" }, baseDigest: w.digest },
      ];
    },
  },
  {
    route: "setWorldScope",
    who: OLIVIA,
    action: "scope.change",
    kind: "world",
    request: async () => {
      const w = await world();
      return ["PUT", `/api/worlds/${w.id}/scope`, { scope: "private" }];
    },
  },
  {
    route: "likeWorld",
    who: OMAR,
    action: "world.like",
    kind: "world",
    id: () => base.world.id,
    request: async () => ["POST", `/api/worlds/${base.world.id}/like`],
  },
  {
    route: "unlikeWorld",
    who: OMAR,
    action: "world.unlike",
    kind: "world",
    id: () => base.world.id,
    request: async () => ["DELETE", `/api/worlds/${base.world.id}/like`],
  },

  {
    route: "createServiceCard",
    who: OLIVIA,
    action: "service_card.create",
    kind: "service_card",
    id: (a) => a.id,
    request: async () => ["POST", "/api/service-cards", { name: "카드", card: "cache" }],
  },
  {
    route: "updateServiceCard",
    who: OLIVIA,
    action: "service_card.update",
    kind: "service_card",
    request: async () => {
      const c = await card();
      return ["PATCH", `/api/service-cards/${c.id}`, { name: "바꿈" }];
    },
  },
  {
    route: "copyServiceCard",
    who: OMAR,
    action: "service_card.copy",
    kind: "service_card",
    id: (a) => a.id,
    request: async () => {
      const c = await call(OLIVIA, "POST", "/api/service-cards", {
        name: "공유",
        card: "cache",
        shared: true,
      });
      return ["POST", `/api/service-cards/${c.id}/copy`, {}];
    },
  },
  {
    route: "deleteServiceCard",
    who: OLIVIA,
    action: "service_card.delete",
    kind: "service_card",
    request: async () => {
      const c = await card();
      return ["DELETE", `/api/service-cards/${c.id}`];
    },
  },

  {
    route: "createScenario",
    who: OLIVIA,
    action: "scenario.create",
    kind: "scenario",
    id: (a) => a.scenario.id,
    request: async () => [
      "POST",
      "/api/scenarios",
      { worldId: base.world.id, templateId: "cooling-failure" },
    ],
  },
  {
    route: "updateScenario",
    who: OLIVIA,
    action: "scenario.update",
    kind: "scenario",
    request: async () => {
      const c = await scenario();
      const got = await call(OLIVIA, "GET", `/api/scenarios/${c.id}`);
      return ["PUT", `/api/scenarios/${c.id}`, { baseDigest: got.digest, name: "고친 시나리오" }];
    },
  },
  {
    route: "deleteScenario",
    who: OLIVIA,
    action: "scenario.delete",
    kind: "scenario",
    request: async () => {
      const c = await scenario();
      return ["DELETE", `/api/scenarios/${c.id}`];
    },
  },
  {
    route: "setScenarioScope",
    who: OLIVIA,
    action: "scope.change",
    kind: "scenario",
    request: async () => {
      const c = await scenario();
      return ["PUT", `/api/scenarios/${c.id}/scope`, { scope: "private" }];
    },
  },
  {
    route: "calibrateScenario",
    who: OLIVIA,
    action: "scenario.calibrate",
    kind: "scenario",
    request: async () => ["POST", `/api/scenarios/${base.scenario.id}/calibrate`, {}],
  },
  {
    route: "putCurrentProcess",
    who: OLIVIA,
    action: "scenario.process_update",
    kind: "scenario",
    request: async () => [
      "PUT",
      `/api/scenarios/${base.scenario.id}/current-process`,
      { steps: [{ what: "확인", who: "당직", minutes: 5, kind: "check" }] },
    ],
  },

  {
    route: "createExperiment",
    who: OLIVIA,
    action: "experiment.start",
    kind: "experiment",
    id: (a) => a.experiment.id,
    request: async () => [
      "POST",
      "/api/experiments",
      { name: "새 실험", recipe: recipe(base.world.id, base.scenario.id, { seeds: [1] }) },
    ],
  },
  {
    route: "forkExperiment",
    who: OLIVIA,
    action: "experiment.fork",
    kind: "experiment",
    id: (a) => a.experiment.id,
    request: async () => [
      "POST",
      `/api/experiments/${base.experiment.id}/fork`,
      { change: { agentId: "guess" } },
    ],
  },
  {
    route: "addRuns",
    who: OLIVIA,
    action: "experiment.add_runs",
    kind: "experiment",
    request: async () => {
      const e = await experiment();
      return ["POST", `/api/experiments/${e.id}/runs`, { count: 1 }];
    },
  },
  {
    route: "cancelExperiment",
    who: OLIVIA,
    action: "experiment.cancel",
    kind: "experiment",
    request: async () => {
      const e = await experiment();
      return ["POST", `/api/experiments/${e.id}/cancel`];
    },
  },
  {
    route: "setExperimentScope",
    who: OLIVIA,
    action: "scope.change",
    kind: "experiment",
    request: async () => {
      const e = await experiment();
      return ["PUT", `/api/experiments/${e.id}/scope`, { scope: "private" }];
    },
  },
  {
    route: "createShare",
    who: OLIVIA,
    action: "share.create",
    kind: "experiment",
    id: () => base.experiment.id,
    request: async () => ["POST", `/api/experiments/${base.experiment.id}/shares`, {}],
  },
  {
    route: "deleteShare",
    who: OLIVIA,
    action: "share.revoke",
    kind: "experiment",
    id: () => base.experiment.id,
    request: async () => {
      const l = await call(OLIVIA, "POST", `/api/experiments/${base.experiment.id}/shares`, {});
      return ["DELETE", `/api/shares/${l.token}`];
    },
  },
  {
    route: "listAudit",
    who: BOSS,
    action: "audit.read",
    kind: "audit",
    request: async () => ["GET", "/api/audit"],
  },
  {
    route: "exportAudit",
    who: BOSS,
    action: "audit.export",
    kind: "audit",
    request: async () => ["GET", "/api/audit/export"],
  },
  {
    route: "listAuditMine",
    who: OLIVIA,
    action: "audit.read_own",
    kind: "audit",
    request: async () => ["GET", "/api/audit/mine"],
  },
];

describe("a call that changes something writes one entry [REQ-054]", () => {
  test.each(ROWS.map((r) => [r.route, r] as const))("[REQ-054] %s", async (_name, row) => {
    const [method, url, payload] = await row.request();
    const { res, entries } = await traced(s, row.who, method, url, payload);
    expect(res.status, `${method} ${url}: ${res.text.slice(0, 200)}`).toBe(row.status ?? 200);
    expect(entries.map((e) => `${e.action}/${e.outcome}`)).toEqual([`${row.action}/allowed`]);
    const [entry] = entries;
    expect(entry?.subject).toMatchObject({ kind: "person", id: row.who.login });
    expect(entry?.route).toBe(row.route);
    expect(entry?.resource.kind).toBe(row.kind);
    const expectedId = typeof row.id === "function" ? row.id(res.body) : row.id;
    if (expectedId) expect(entry?.resource.id).toBe(expectedId);
    // a call tied to its entries by the id the person was given
    expect(entry?.requestId).toMatch(/\w{6,}/);
  });

  test("[REQ-054] every route of the contract that is classified as a change has a row here, except the two that cannot be run to the end here (a run waiting for a person, an operation that never ends; audit-refusals.test.ts)", () => {
    const changing = (Object.keys(ROUTES) as RouteName[]).filter(
      (n) =>
        AUDIT_CLASSES[n].records === "change" &&
        n !== "answerEscalation" &&
        n !== "quickExperiment",
    );
    expect(ROWS.map((r) => r.route).sort()).toEqual([...changing].sort());
  });

  test("[REQ-054] each row's action and thing are what the route's classification says", () => {
    for (const row of ROWS) {
      const cls = AUDIT_CLASSES[row.route];
      expect(cls.records).toBe("change");
      if (cls.records === "change") {
        expect(cls.action, row.route).toBe(row.action);
        expect(cls.resource, row.route).toBe(row.kind);
      }
    }
  });
});
