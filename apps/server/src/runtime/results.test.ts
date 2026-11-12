import type { Telemetry, TelemetryPort } from "@terrarium/core/analysis";
import { fromJsonl } from "@terrarium/core/analysis";
import { ForbiddenError, UnavailableError } from "@terrarium/core/contract";
import { NotFoundError } from "@terrarium/core/kernel";
import { describe, expect, test } from "vitest";
import { buildAdapters, parseConfig } from "../adapters";
import { sightOf } from "./permissions";
import {
  ADMIN,
  HANEUL,
  JIMIN,
  person,
  recipe,
  ScriptHarness,
  seed,
  settled,
  testPlatform,
} from "./test-support/platform";

const trace = (traceId: string): Telemetry => ({
  spans: [
    {
      traceId,
      spanId: "s1",
      name: "chat",
      start: 0,
      end: 2000,
      status: "ok",
      attributes: {
        "gen_ai.request.model": "model-a",
        "gen_ai.usage.input_tokens": 700,
        "gen_ai.usage.output_tokens": 50,
      },
    },
  ],
  logs: [],
  metrics: [],
});

function withTelemetry(port: TelemetryPort) {
  const traced = new ScriptHarness("traced", async (req) => {
    await req.tools.call("list_alarms", {});
    await req.tools.call("submit_diagnosis", {
      rootCause: "crah-1",
      faultType: "cooling_unit_failure",
      summary: "<b>정지</b>",
    });
    return { status: "finished" };
  });
  const base = testPlatform([traced]);
  const adapters = buildAdapters(parseConfig({}), { store: base.store, env: {} });
  return testPlatform(
    [traced],
    { adapters: { ...adapters, harnesses: [traced], telemetry: { port, name: "ClickStack" } } },
    base.store,
  );
}

describe("one run in depth, with the harness's telemetry [REQ-037]", () => {
  test("the run view folds in tokens from ClickStack; the raw trace is there too", async () => {
    const { platform: p } = withTelemetry({ trace: async (id) => trace(id) });
    const { world, scenario } = await seed(p);
    const e = await p.experiments.create(HANEUL, {
      name: "추적",
      recipe: recipe(world.id, scenario.id, { harnessId: "traced", agentId: "a", runs: 1 }),
    });
    const done = await settled(p, HANEUL, e.experiment.id);
    const view = await p.results.run(done.runs[0]?.id as string);
    expect(view.hasTelemetry).toBe(true);
    expect(view.analysis.efficiency).toMatchObject({
      inputTokens: 700,
      outputTokens: 50,
      llmCalls: 1,
    });
    expect(view.timeline.length).toBeGreaterThan(0);
    expect(view.experiment.experiment.id).toBe(e.experiment.id);
    const raw = await p.results.telemetry(done.runs[0]?.id as string);
    expect(raw.spans).toHaveLength(1);
    const md = await p.results.report(e.experiment.id, "md", sightOf(ADMIN));
    expect(md).toContain("# 추적");
    await expect(p.results.run("r-404")).rejects.toBeInstanceOf(NotFoundError);
  });

  test("a ClickStack that is down does not break the result page, only the raw trace", async () => {
    const { platform: p } = withTelemetry({
      trace: async () => {
        throw new Error("connection refused");
      },
    });
    const { world, scenario } = await seed(p);
    const e = await p.experiments.create(HANEUL, {
      name: "끊김",
      recipe: recipe(world.id, scenario.id, { harnessId: "traced", agentId: "a", runs: 1 }),
    });
    const done = await settled(p, HANEUL, e.experiment.id);
    const runId = done.runs[0]?.id as string;
    expect((await p.results.run(runId)).analysis.efficiency.inputTokens).toBeUndefined();
    await expect(p.results.telemetry(runId)).rejects.toBeInstanceOf(UnavailableError);
  });

  test("without telemetry configured there is simply nothing extra", async () => {
    const { platform: p } = testPlatform();
    const { world, scenario } = await seed(p);
    const e = await p.experiments.create(HANEUL, {
      name: "기본",
      recipe: recipe(world.id, scenario.id, { runs: 1 }),
    });
    const done = await settled(p, HANEUL, e.experiment.id);
    expect((await p.results.run(done.runs[0]?.id as string)).hasTelemetry).toBe(false);
    expect(await p.results.telemetry(done.runs[0]?.id as string)).toEqual({
      spans: [],
      logs: [],
      metrics: [],
    });
  });
});

describe("sharing results [REQ-038]", () => {
  test("reports in three formats, and links that open without the app until taken back or expired", async () => {
    const { platform: p } = testPlatform();
    const { world, scenario } = await seed(p);
    const e = await p.experiments.create(HANEUL, {
      name: "공유할 실험",
      recipe: recipe(world.id, scenario.id, { runs: 2 }),
    });
    await settled(p, HANEUL, e.experiment.id);
    const id = e.experiment.id;
    const html = await p.results.report(id, "html", sightOf(ADMIN), "https://t/e/1");
    expect(html).toContain("<title>공유할 실험 — 테라리움</title>");
    expect(html).toContain("내장");
    expect(html).toContain('<svg class="spark"');
    expect(await p.results.report(id, "text", sightOf(ADMIN))).toContain("[테라리움] 공유할 실험");
    // only the experiment's maker (or an admin) opens a door to its report
    await expect(
      p.results.createShare(JIMIN, id, {}, "https://terrarium.internal/"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const share = await p.results.createShare(HANEUL, id, {}, "https://terrarium.internal/");
    // no number given: thirty days, not for ever
    expect(Date.parse(share.expiresAt as string) - Date.parse(share.createdAt)).toBe(
      30 * 86_400_000,
    );
    expect(share.url).toBe(`https://terrarium.internal/r/${share.token}`);
    expect(share.token).toMatch(/^[0-9a-f]{36}$/);
    expect(await p.results.shared(share.token, "text", share.url)).toContain(share.url);
    await expect(p.results.deleteShare(person("other"), share.token)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await p.results.deleteShare(HANEUL, share.token)).toEqual({ deleted: true });
    await expect(p.results.shared(share.token, "html", "x")).rejects.toThrow(
      "공유 링크가 없거나 만료됐어요",
    );
    const expiring = await p.results.createShare(HANEUL, id, { expiresInDays: 1 }, "https://t");
    expect(Date.parse(expiring.expiresAt as string) - Date.parse(expiring.createdAt)).toBe(
      86_400_000,
    );
    expect(await p.results.deleteShare(HANEUL, expiring.token)).toEqual({ deleted: true });
    await expect(p.results.createShare(HANEUL, "e-404", {}, "x")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("benchmarks and the digital twin [REQ-039] [REQ-015]", () => {
  test("leaderboards rank configurations within one benchmark set", async () => {
    const { platform: p } = testPlatform();
    const { world, scenario } = await seed(p);
    for (const agentId of ["triage", "guess", "idle"]) {
      const e = await p.experiments.create(HANEUL, {
        name: agentId,
        recipe: recipe(world.id, scenario.id, { agentId, runs: 3 }),
      });
      await settled(p, HANEUL, e.experiment.id);
    }
    const [board] = await p.results.leaderboards({});
    expect(board?.rows.map((r) => [r.agentId, r.rank])).toEqual([
      ["triage", 1],
      [board?.rows[1]?.agentId, 2],
      [board?.rows[2]?.agentId, 3],
    ]);
    expect(board?.rows[0]?.passRate).toBe(1);
    expect(await p.results.leaderboards({ worldId: "w-elsewhere" })).toEqual([]);
  });

  test("diagnosis records export as JSON Lines; the brief names what imported worlds lack", async () => {
    const { platform: p } = testPlatform();
    const imported = await p.worlds.import(ADMIN, { source: "sample", name: "가져온 홀" });
    const room = imported.world.blueprint.entities.find((x) => x.kind === "cooling_unit");
    expect(room).toBeDefined();
    const { scenario } = await p.scenarios.create(HANEUL, {
      worldId: imported.world.id,
      templateId: "cooling-failure",
    });
    const e = await p.experiments.create(HANEUL, {
      name: "가져온 세계 실험",
      recipe: recipe(imported.world.id, scenario.id, { agentId: "guess", runs: 2 }),
    });
    await settled(p, HANEUL, e.experiment.id);
    const records = fromJsonl(await p.results.diagnoses(e.experiment.id));
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      experimentId: e.experiment.id,
      agentId: "guess",
      world: { name: "가져온 홀" },
    });
    expect(await p.results.twinRecords(ADMIN, { agentId: "triage" })).toEqual([]);
    expect(
      await p.results.twinRecords(ADMIN, { harnessId: "builtin", owner: "haneul" }),
    ).toHaveLength(2);
    const brief = await p.results.twinBrief(ADMIN, {});
    expect(brief).toContain("# 시뮬레이터 모델링 브리프");
    expect(brief).toContain("### 가져온 홀");
    expect(brief).toContain("- 가정:");
  });
});
