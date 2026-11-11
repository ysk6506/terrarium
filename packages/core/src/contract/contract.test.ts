import { InvalidValueError, NotFoundError } from "@terrarium/core/kernel";
import { SCENARIO_TEMPLATES } from "@terrarium/core/scenario";
import { DEFAULT_WORLDGEN, generateWorld } from "@terrarium/core/sources/worldgen";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { sampleBlueprint } from "../world/test-support/sample";
import {
  AddRunsBody,
  BlueprintSchema,
  CreateExperimentBody,
  CreateScenarioBody,
  ExperimentQuery,
  errorReply,
  ForkBody,
  GenerateWorldBody,
  ImportWorldBody,
  invalidInput,
  isApiError,
  koreanErrorMap,
  paramNames,
  parseWith,
  pathFor,
  ReportQuery,
  ROUTES,
  type RouteSpec,
  ScenarioDocSchema,
  toErrorReply,
  UpdateWorldBody,
  WorldgenSpecSchema,
} from ".";

const messages = (schema: z.ZodTypeAny, data: unknown) => {
  const r = parseWith(schema, data);
  return r.ok ? [] : r.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message));
};

const recipe = {
  worldId: "w1",
  scenarioId: "s1",
  harnessId: "h1",
  agentId: "triage",
  tools: ["list_alarms", "get_entity"],
};

describe("the route table [REQ-030]", () => {
  const routes = Object.entries(ROUTES) as [string, RouteSpec][];

  test("every route is unique, lives under /api unless it is a public share link, and says what it does", () => {
    const keys = routes.map(([, r]) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const [name, r] of routes) {
      expect(r.summary.length, name).toBeGreaterThan(3);
      expect(r.path.startsWith(r.public ? "/r/" : "/api/"), name).toBe(true);
      if (r.method === "GET") expect(r.body, name).toBeUndefined();
    }
    expect(routes.filter(([, r]) => r.public).map(([n]) => n)).toEqual(["sharedReport"]);
  });

  test("paths are filled in and encoded; a missing parameter is an error, not a broken link", () => {
    expect(paramNames(ROUTES.getRun.path)).toEqual(["id"]);
    expect(pathFor("getRun", { id: "r 1/2" })).toBe("/api/runs/r%201%2F2");
    expect(
      pathFor("listExperiments", {}, { owner: "연수", status: undefined, limit: 20, q: "" }),
    ).toBe("/api/experiments?owner=%EC%97%B0%EC%88%98&limit=20");
    expect(pathFor("meta")).toBe("/api/meta");
    expect(() => pathFor("getWorld", {})).toThrow("getWorld: 'id' 값이 없어요");
    expect(() => pathFor("getWorld", { id: "" })).toThrow();
  });
});

describe("worlds cross the wire intact [REQ-001] [REQ-009]", () => {
  test("the sample world and a generated world pass the schema unchanged", () => {
    const sample = sampleBlueprint();
    expect(parseWith(BlueprintSchema, JSON.parse(JSON.stringify(sample)))).toEqual({
      ok: true,
      value: sample,
    });
    const generated = generateWorld({
      ...DEFAULT_WORLDGEN,
      site: "pyeongtaek",
      seed: 3,
      rows: 2,
      racksPerRow: 4,
    }).blueprint;
    const parsed = parseWith(BlueprintSchema, JSON.parse(JSON.stringify(generated)));
    expect(parsed.ok).toBe(true);
  });

  test("broken blueprints are pointed at field by field, in Korean", () => {
    const bp = sampleBlueprint();
    const broken = {
      ...bp,
      entities: [{ ...bp.entities[0], kind: "spaceship", colour: "red" }, ...bp.entities.slice(1)],
      links: [{ ...bp.links[0], from: "has space" }],
    };
    const found = messages(BlueprintSchema, broken);
    expect(found).toContain("entities.0: 모르는 항목이 있어요: 'colour'");
    expect(found.some((m) => m.startsWith("entities.0.kind: 'site', 'building'"))).toBe(true);
    expect(found.some((m) => m.endsWith("('spaceship'은 없어요)"))).toBe(true);
    expect(found).toContain("links.0.from: 형식이 맞지 않아요");
    expect(messages(BlueprintSchema, { ...bp, schemaVersion: 9 })).toEqual([
      "schemaVersion: '1'만 쓸 수 있어요",
    ]);
  });

  test("worldgen specs are checked by worldgen's own rules", () => {
    const spec = { ...DEFAULT_WORLDGEN, site: "giheung", seed: 1 };
    expect(parseWith(WorldgenSpecSchema, spec).ok).toBe(true);
    expect(parseWith(GenerateWorldBody, { spec }).ok).toBe(true);
    const tooMany = messages(WorldgenSpecSchema, {
      ...spec,
      buildings: 4,
      floors: 8,
      rows: 12,
      racksPerRow: 20,
    });
    expect(tooMany).toEqual(["랙이 7680개예요. 한 세계는 2000개까지 만들 수 있어요"]);
    expect(messages(WorldgenSpecSchema, { ...spec, site: "seoul" })[0]).toMatch(
      /^site: 'giheung', .+ \('seoul'은 없어요\)$/,
    );
    expect(messages(WorldgenSpecSchema, { ...spec, fill: 3 }).length).toBe(1);
  });

  test("imports name a source and stay within limits; saves need the version they started from", () => {
    expect(
      parseWith(ImportWorldBody, {
        source: "cloud_topology",
        rooms: ["A동"],
        assume: { power: false },
      }).ok,
    ).toBe(true);
    expect(messages(ImportWorldBody, { source: "cloud_topology", maxEntities: 10 })).toEqual([
      "maxEntities: 100 이상이어야 해요",
    ]);
    expect(messages(UpdateWorldBody, { baseDigest: "abc" })).toEqual([
      "바꿀 이름이나 세계가 없어요",
    ]);
    expect(messages(UpdateWorldBody, { name: "x" })).toEqual(["baseDigest: 필요한 값이 없어요"]);
  });
});

describe("scenarios cross the wire intact [REQ-033] [REQ-034]", () => {
  test("every built-in template, built on the sample world, passes the schema", () => {
    const index = new BlueprintIndex(sampleBlueprint());
    for (const t of SCENARIO_TEMPLATES) {
      const doc = t.build(index, "sample");
      expect(parseWith(ScenarioDocSchema, JSON.parse(JSON.stringify(doc))), t.id).toEqual({
        ok: true,
        value: doc,
      });
    }
  });

  test("a new scenario starts empty, from a template, or from a document", () => {
    expect(parseWith(CreateScenarioBody, { worldId: "w1" }).ok).toBe(true);
    expect(parseWith(CreateScenarioBody, { worldId: "w1", templateId: "cooling-failure" }).ok).toBe(
      true,
    );
    const doc = SCENARIO_TEMPLATES[0]?.build(new BlueprintIndex(sampleBlueprint()), "sample");
    expect(parseWith(CreateScenarioBody, { worldId: "w1", doc }).ok).toBe(true);
    expect(parseWith(CreateScenarioBody, { worldId: "w1", doc: { ...doc, nodes: "x" } }).ok).toBe(
      false,
    );
  });
});

describe("experiments: create, fork, add runs [REQ-030] [REQ-040]", () => {
  test("a recipe takes seeds or a run count, not both; seeds are unique", () => {
    expect(
      parseWith(CreateExperimentBody, { name: " 첫 실험 ", recipe: { ...recipe, runs: 3 } }),
    ).toMatchObject({
      ok: true,
      value: { name: "첫 실험" },
    });
    expect(
      messages(CreateExperimentBody, { name: "x", recipe: { ...recipe, runs: 3, seeds: [1] } }),
    ).toEqual(["recipe.runs: 시드 목록과 실행 횟수 중 하나만 정해요"]);
    expect(
      messages(CreateExperimentBody, { name: "x", recipe: { ...recipe, seeds: [1, 1] } }),
    ).toEqual(["recipe.seeds: 같은 시드가 두 번 있어요"]);
    expect(messages(CreateExperimentBody, { name: "", recipe })).toEqual([
      "name: 비어 있으면 안 돼요",
    ]);
    expect(
      messages(CreateExperimentBody, { name: "x", recipe: { ...recipe, time: { kind: "warp" } } }),
    ).toEqual(["recipe.time.kind: 종류는 'lockstep', 'realtime' 중 하나여야 해요"]);
    expect(messages(CreateExperimentBody, { name: "x", recipe: { ...recipe, tools: [] } })).toEqual(
      ["recipe.tools: 1개 이상이어야 해요"],
    );
  });

  test("a fork changes only what it names; adding runs says how many or which seeds", () => {
    expect(parseWith(ForkBody, { change: { agentId: "deep" } }).ok).toBe(true);
    expect(messages(ForkBody, { change: { owner: "me" } })).toEqual([
      "change: 모르는 항목이 있어요: 'owner'",
    ]);
    expect(parseWith(AddRunsBody, { count: 2 }).ok).toBe(true);
    expect(messages(AddRunsBody, {})).toEqual(["더할 실행 횟수, 시드, 반복 중 하나를 정해요"]);
    expect(messages(AddRunsBody, { count: 2, seeds: [4] })).toEqual([
      "더할 실행 횟수, 시드, 반복 중 하나를 정해요",
    ]);
  });

  test("query strings: numbers are read from text and blanks mean 'not given'", () => {
    expect(parseWith(ExperimentQuery, { limit: "20", owner: "", status: "" })).toEqual({
      ok: true,
      value: { limit: 20 },
    });
    expect(messages(ExperimentQuery, { limit: "abc" })).toEqual([
      "limit: 숫자여야 해요 (지금은 NaN이에요)",
    ]);
    expect(messages(ExperimentQuery, { limit: "500" })).toEqual(["limit: 200 이하여야 해요"]);
    expect(messages(ExperimentQuery, { status: "done" })[0]).toMatch(/^status: 'queued', /);
    expect(parseWith(ReportQuery, {})).toEqual({ ok: true, value: { format: "html" } });
  });
});

describe("Korean messages for every kind of problem [REQ-041]", () => {
  const check = (schema: z.ZodTypeAny, data: unknown) => messages(schema, data)[0];

  test("types, sizes, choices, formats", () => {
    expect(check(z.string(), 3)).toBe("문자열이어야 해요 (지금은 숫자예요)");
    expect(check(z.number(), "3")).toBe("숫자여야 해요 (지금은 문자열이에요)");
    expect(check(z.object({ a: z.string() }), {})).toBe("a: 필요한 값이 없어요");
    expect(check(z.array(z.number()), {})).toBe("목록이어야 해요 (지금은 객체예요)");
    expect(check(z.number().int(), 1.5)).toBe("정수여야 해요 (지금은 소수예요)");
    expect(check(z.string().max(3), "abcd")).toBe("3자 이하여야 해요");
    expect(check(z.string().min(2), "a")).toBe("2자 이상이어야 해요");
    expect(check(z.array(z.number()).max(1), [1, 2])).toBe("1개 이하여야 해요");
    expect(check(z.number().positive(), 0)).toBe("0보다 커야 해요");
    expect(check(z.number().lt(5), 5)).toBe("5보다 작아야 해요");
    expect(check(z.enum(["a", "b"]), "c")).toBe("'a', 'b' 중 하나여야 해요 ('c'는 없어요)");
    expect(check(z.literal("x"), "y")).toBe("'x'만 쓸 수 있어요");
    expect(check(z.object({}).strict(), { k: 1 })).toBe("모르는 항목이 있어요: 'k'");
    expect(check(z.string().email(), "nope")).toBe("형식이 맞지 않아요");
    expect(check(z.number().finite(), Number.POSITIVE_INFINITY)).toBe("유한한 숫자여야 해요");
    expect(check(z.number().multipleOf(5), 7)).toBe("5의 배수여야 해요");
    expect(check(z.union([z.string(), z.number()]), true)).toBe("어느 형식에도 맞지 않아요");
    expect(
      check(
        z.string().refine(() => false, { message: "직접 쓴 메시지" }),
        "x",
      ),
    ).toBe("직접 쓴 메시지");
    expect(check(z.date(), new Date("x"))).toBe("Invalid date");
  });

  test("the error map can also be used directly", () => {
    const r = z.string().safeParse(1, { errorMap: koreanErrorMap });
    expect(r.success ? "" : r.error.issues[0]?.message).toBe("문자열이어야 해요 (지금은 숫자예요)");
  });
});

describe("error replies [REQ-030]", () => {
  test("core errors keep their status and message; anything else hides the internals", () => {
    expect(toErrorReply(new NotFoundError("실험 e9가 없어요"))).toEqual({
      status: 404,
      body: { error: { code: "not_found", message: "실험 e9가 없어요" } },
    });
    expect(toErrorReply(new InvalidValueError("x")).status).toBe(400);
    const hidden = toErrorReply(new Error("SQLITE_CORRUPT at /var/lib/terrarium.db"));
    expect(hidden.status).toBe(500);
    expect(JSON.stringify(hidden)).not.toContain("SQLITE");
    expect(errorReply(409, "conflict").body.error.message).toBe(
      "그사이 다른 변경이 있었어요. 새로고침한 뒤 다시 시도해 주세요",
    );
    expect(errorReply(418, "teapot").body.error.message).toBe("서버에서 문제가 생겼어요");
    const bad = invalidInput([{ path: "name", message: "비어 있으면 안 돼요" }]);
    expect(bad).toMatchObject({
      status: 400,
      body: { error: { code: "invalid_input", issues: [{ path: "name" }] } },
    });
    expect(isApiError(bad.body)).toBe(true);
    expect(isApiError({ error: "x" })).toBe(false);
    expect(isApiError(null)).toBe(false);
  });
});
