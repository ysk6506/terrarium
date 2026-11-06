import { ForbiddenError, InvalidInputError, UnavailableError } from "@terrarium/core/contract";
import type { Experiment } from "@terrarium/core/experiments";
import { ConflictError, InvalidValueError, NotFoundError } from "@terrarium/core/kernel";
import { ORACLE_VERSION } from "@terrarium/core/oracle";
import { DEFAULT_TOOLSET } from "@terrarium/core/tools";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../../../packages/core/src/world/test-support/sample";
import {
  JIMIN,
  recipe,
  ScriptHarness,
  seed,
  settled,
  testPlatform,
  until,
  untilStopped,
  YEONSU,
} from "./test-support/platform";

describe("an experiment from creation to result [REQ-030] [REQ-037]", () => {
  test("the built-in triage agent solves the cooling failure three times out of three", async () => {
    const { platform: p } = testPlatform();
    const { world, scenario } = await seed(p);
    const seen: string[] = [];
    const created = await p.experiments.create(YEONSU, {
      name: "냉방 기준선",
      recipe: recipe(world.id, scenario.id, { runs: 3 }),
    });
    const off = p.events.subscribe(created.experiment.id, (e) => seen.push(e.type));
    expect(created.experiment).toMatchObject({
      owner: "yeonsu",
      recipe: { seeds: [1, 2, 3], time: { kind: "lockstep", secondsPerCall: 30 } },
      snapshot: {
        worldName: "샘플 홀",
        worldDigest: world.digest,
        scenarioDigest: scenario.digest,
        oracle: ORACLE_VERSION,
      },
    });
    const done = await settled(p, YEONSU, created.experiment.id);
    off();
    expect(done.status).toBe("completed");
    expect(done.analysis.passRate).toBe(1);
    expect(done.runs.map((r) => [r.seed, r.status, r.passed])).toEqual([
      [1, "completed", true],
      [2, "completed", true],
      [3, "completed", true],
    ]);
    expect(done.meanScore).toBe(90.9);
    expect(done.canCancel).toBe(false);
    expect(seen).toContain("call");
    expect(seen).toContain("run");
    expect(seen).toContain("experiment");
    const listed = await p.experiments.list({ owner: "yeonsu", status: "completed" });
    expect(listed.map((s) => s.experiment.id)).toEqual([created.experiment.id]);
    expect(await p.experiments.list({ status: "running" })).toEqual([]);
    expect(await p.experiments.list({ q: "기준선", limit: 1 })).toHaveLength(1);
  });

  test("a recipe is checked against what really exists before anything is queued", async () => {
    const down = new ScriptHarness("down", untilStopped);
    down.agents = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    const { platform: p, store } = testPlatform([down]);
    const { world, scenario } = await seed(p);
    const make = (extra: Record<string, unknown>) =>
      p.experiments.create(YEONSU, { name: "x", recipe: recipe(world.id, scenario.id, extra) });
    await expect(make({ agentId: "chef" })).rejects.toMatchObject({
      issues: [{ path: "recipe", message: "하네스에 'chef' 에이전트가 없어요" }],
    });
    await expect(make({ tools: ["teleport"] })).rejects.toBeInstanceOf(InvalidInputError);
    await expect(make({ profiles: { vcenter: "vcenter/5.5" } })).rejects.toBeInstanceOf(
      InvalidInputError,
    );
    await expect(make({ harnessId: "nope" })).rejects.toThrow("하네스 'nope'를 찾을 수 없어요");
    await expect(make({ harnessId: "down", agentId: "a" })).rejects.toBeInstanceOf(
      UnavailableError,
    );
    await expect(make({ worldId: "w-404" })).rejects.toBeInstanceOf(NotFoundError);
    const other = await p.worlds.create(YEONSU, { name: "다른 홀", blueprint: sampleBlueprint() });
    await expect(make({ worldId: other.world.id })).rejects.toThrow("다른 세계");
    const broken = await p.scenarios.create(YEONSU, { worldId: world.id, name: "빈 시나리오" });
    await expect(make({ scenarioId: broken.scenario.id })).rejects.toThrow(
      "고칠 곳이 있어 실행할 수 없어요",
    );
    expect(await store.listExperiments()).toEqual([]);
  });
});

describe("cancelling and the queue [REQ-030] [REQ-032]", () => {
  test("queued runs wait their turn; cancelling stops the running one and drops the rest", async () => {
    const slow = new ScriptHarness("slow", untilStopped);
    const { platform: p } = testPlatform([slow], { limits: { maxRunning: 1 } });
    const { world, scenario } = await seed(p);
    const e = await p.experiments.create(YEONSU, {
      name: "느린 에이전트",
      recipe: recipe(world.id, scenario.id, { harnessId: "slow", agentId: "a", runs: 3 }),
    });
    await until(() => slow.requests.length === 1);
    const live = await p.experiments.view(YEONSU, e.experiment.id);
    expect(live.status).toBe("running");
    expect(live.canCancel).toBe(true);
    expect(live.runs.map((r) => r.queuePosition)).toEqual([undefined, 1, 2]);
    expect((await p.meta(YEONSU)).queue).toEqual({ running: 1, queued: 2 });
    await expect(p.experiments.cancel(JIMIN, e.experiment.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const after = await p.experiments.cancel(YEONSU, e.experiment.id);
    expect(after.runs.map((r) => r.status)).toEqual(["cancelled", "cancelled", "cancelled"]);
    expect(after.status).toBe("cancelled");
    expect(slow.requests).toHaveLength(1);
    expect(await p.dispatcher.cancel("r-unknown")).toBe(false);
  });

  test("a restarted server fails what was mid-flight and runs what was waiting", async () => {
    const slow = new ScriptHarness("slow", untilStopped);
    const first = testPlatform([slow], { limits: { maxRunning: 1 } });
    const { world, scenario } = await seed(first.platform);
    const e = await first.platform.experiments.create(YEONSU, {
      name: "재시작",
      recipe: recipe(world.id, scenario.id, { harnessId: "slow", agentId: "a", runs: 2 }),
    });
    await until(() => slow.requests.length === 1);
    // The process "dies": nothing is cleaned up; a new platform opens the same store.
    const second = testPlatform([], {}, first.store);
    const store = first.store;
    const id = e.experiment.id;
    const [, queued] = await store.listRuns(id);
    const experiment = (await store.getExperiment(id)) as Experiment;
    // After the restart the slow harness is gone; the waiting run is handed to the built-in one.
    await store.putExperiment({
      ...experiment,
      recipe: { ...experiment.recipe, harnessId: "builtin", agentId: "triage" },
    });
    expect(await second.platform.start()).toEqual({ resumed: 1, interrupted: 1 });
    await until(async () => (await store.getRun(queued?.id as string))?.status === "completed");
    const runs = await store.listRuns(id);
    expect(runs[0]).toMatchObject({
      status: "failed",
      error: "서버가 다시 시작되어 실행이 중단됐어요",
    });
    await first.platform.stop();
  });

  test("stopping the server ends running runs as failed, with the reason", async () => {
    const slow = new ScriptHarness("slow", untilStopped);
    const { platform: p, store } = testPlatform([slow]);
    const { world, scenario } = await seed(p);
    const e = await p.experiments.create(YEONSU, {
      name: "정지",
      recipe: recipe(world.id, scenario.id, { harnessId: "slow", agentId: "a", runs: 1 }),
    });
    await until(() => slow.requests.length === 1);
    await p.stop();
    const [run] = await store.listRuns(e.experiment.id);
    expect(run).toMatchObject({ status: "failed", error: "서버가 멈춰 실행이 중단됐어요" });
  });
});

describe("forks, more runs and lineage [REQ-040]", () => {
  test("a fork changes one condition, keeps the parent's versions and shows the difference", async () => {
    const { platform: p } = testPlatform();
    const { world, scenario } = await seed(p);
    const parent = await p.experiments.create(YEONSU, {
      name: "원본",
      recipe: recipe(world.id, scenario.id, { agentId: "guess", runs: 3 }),
    });
    await settled(p, YEONSU, parent.experiment.id);
    // The world changes after the parent ran; the fork still runs the parent's version.
    const current = await p.worlds.get(world.id);
    await p.worlds.update(YEONSU, world.id, { baseDigest: current.digest, name: "고친 홀" });
    const fork = await p.experiments.fork(JIMIN, parent.experiment.id, {
      change: { agentId: "triage" },
    });
    expect(fork.experiment).toMatchObject({
      owner: "jimin",
      parentId: parent.experiment.id,
      name: "원본 (포크)",
      snapshot: parent.experiment.snapshot,
      benchmarkKey: parent.experiment.benchmarkKey,
    });
    const done = await settled(p, JIMIN, fork.experiment.id);
    expect(done.analysis.parent?.changes).toEqual([
      { field: "agentId", label: "에이전트", before: "guess", after: "triage" },
    ]);
    expect(done.ancestors.map((a) => a.experiment.id)).toEqual([parent.experiment.id]);
    const parentView = await p.experiments.view(YEONSU, parent.experiment.id);
    expect(parentView.forks.map((f) => f.experiment.id)).toEqual([fork.experiment.id]);
    await expect(
      p.experiments.fork(JIMIN, parent.experiment.id, { change: {} }),
    ).rejects.toBeInstanceOf(InvalidValueError);
    const moved = await p.experiments.fork(JIMIN, parent.experiment.id, {
      change: {
        scenarioId: (
          await p.scenarios.create(YEONSU, { worldId: world.id, templateId: "sensor-drift" })
        ).scenario.id,
      },
      name: "드리프트로",
      note: "다른 시나리오",
    });
    expect(moved.experiment.snapshot.worldName).toBe("고친 홀");
    expect(moved.experiment.benchmarkKey).not.toBe(parent.experiment.benchmarkKey);
  });

  test("more runs continue the seeds; repeating a seed or someone else's experiment is refused", async () => {
    const { platform: p } = testPlatform();
    const { world, scenario } = await seed(p);
    const e = await p.experiments.create(YEONSU, {
      name: "추가",
      recipe: recipe(world.id, scenario.id, { seeds: [1, 2] }),
    });
    await settled(p, YEONSU, e.experiment.id);
    const more = await p.experiments.addRuns(YEONSU, e.experiment.id, { count: 2 });
    expect(more.runs.map((r) => [r.index, r.seed])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
    ]);
    expect(more.experiment.recipe.seeds).toEqual([1, 2, 3, 4]);
    await expect(
      p.experiments.addRuns(YEONSU, e.experiment.id, { seeds: [2, 9] }),
    ).rejects.toMatchObject({
      issues: [{ path: "seeds", message: "시드 2는 이미 있어요" }],
    });
    await expect(
      p.experiments.addRuns(JIMIN, e.experiment.id, { count: 1 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await settled(p, YEONSU, e.experiment.id)).progress.completed).toBe(4);
  });
});

describe("worlds and scenarios are saved safely [REQ-009] [REQ-033] [REQ-034]", () => {
  test("saves check the blueprint, refuse stale versions and let only the owner change things", async () => {
    const { platform: p } = testPlatform();
    const saved = await p.worlds.create(YEONSU, { name: "홀", blueprint: sampleBlueprint() });
    expect(saved.world).toMatchObject({
      id: "w-1",
      owner: "yeonsu",
      origin: "builder",
      blueprint: { id: "w-1", name: "홀" },
    });
    const bad = sampleBlueprint();
    const broken = {
      ...bad,
      entities: bad.entities.map((e) => (e.id === "srv-a1" ? { ...e, parentId: "nowhere" } : e)),
    };
    await expect(
      p.worlds.create(YEONSU, { name: "깨짐", blueprint: broken }),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: "srv-a1" })],
    });
    await expect(
      p.worlds.update(YEONSU, "w-1", { baseDigest: "old", name: "x" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      p.worlds.update(JIMIN, "w-1", { baseDigest: saved.world.digest, name: "x" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const renamed = await p.worlds.update(YEONSU, "w-1", {
      baseDigest: saved.world.digest,
      name: "새 이름",
    });
    expect(renamed.world.blueprint.name).toBe("새 이름");
    expect((await p.worlds.list()).map((w) => w.name)).toEqual(["새 이름"]);
    await expect(p.worlds.delete(JIMIN, "w-1")).rejects.toBeInstanceOf(ForbiddenError);
    expect(await p.worlds.delete(YEONSU, "w-1")).toEqual({ deleted: true });
    await expect(p.worlds.get("w-1")).rejects.toThrow("세계 w-1을 찾을 수 없어요");
  });

  test("worlds come from presets and from reality, with what was assumed", async () => {
    const { platform: p } = testPlatform();
    const generated = await p.worlds.generate(YEONSU, {
      spec: {
        site: "onyang",
        seed: 1,
        buildings: 1,
        floors: 1,
        roomsPerFloor: 1,
        rows: 2,
        racksPerRow: 4,
        fill: 0.5,
        gpuShare: 0,
        containment: "cold",
        coolingRedundancy: "N+1",
        powerRedundancy: "2N",
        vmsPerHost: 2,
      },
    });
    expect(generated.world).toMatchObject({ name: "온양사업장 생성 세계", origin: "worldgen" });
    expect(generated.stats.rack).toBe(8);
    const imported = await p.worlds.import(YEONSU, { source: "sample" });
    expect(imported.world).toMatchObject({
      name: "샘플 그래프 (가상)에서 가져온 세계",
      origin: "import",
    });
    expect(imported.report.assumptions.length).toBeGreaterThan(0);
    await expect(p.worlds.import(YEONSU, { source: "prod-kg" })).rejects.toThrow(
      "현실 소스 'prod-kg'를 찾을 수 없어요",
    );
    await expect(p.worlds.import(YEONSU, { source: "sample", maxEntities: 100 })).rejects.toThrow(
      "너무 많아요",
    );
  });

  test("scenarios: drafts may have problems, templates must fit the world, saves are versioned", async () => {
    const { platform: p } = testPlatform();
    const { world, scenario } = await seed(p);
    expect(scenario).toMatchObject({
      owner: "yeonsu",
      worldId: world.id,
      doc: { id: scenario.id, worldId: world.id },
    });
    const draft = await p.scenarios.create(YEONSU, { worldId: world.id });
    expect(draft.issues.some((i) => i.severity === "error")).toBe(true);
    const fromDoc = await p.scenarios.create(YEONSU, {
      worldId: world.id,
      doc: scenario.doc,
      name: "복사본",
    });
    expect(fromDoc.scenario.name).toBe("복사본");
    expect(fromDoc.scenario.digest).toBe(scenario.digest);
    const empty = await p.worlds.create(YEONSU, {
      name: "빈 땅",
      blueprint: { ...sampleBlueprint(), entities: [], links: [] },
    });
    await expect(
      p.scenarios.create(YEONSU, { worldId: empty.world.id, templateId: "cooling-failure" }),
    ).rejects.toThrow("이 세계에서는");
    await expect(
      p.scenarios.create(YEONSU, { worldId: world.id, templateId: "nope" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      p.scenarios.update(YEONSU, scenario.id, { baseDigest: "x", name: "y" }),
    ).rejects.toBeInstanceOf(ConflictError);
    const renamed = await p.scenarios.update(YEONSU, scenario.id, {
      baseDigest: scenario.digest,
      name: "이름만",
    });
    expect(renamed.scenario.doc.name).toBe("이름만");
    await expect(p.scenarios.delete(JIMIN, scenario.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await p.scenarios.delete(YEONSU, scenario.id)).toEqual({ deleted: true });
    expect((await p.scenarios.list(world.id)).map((s) => s.id)).not.toContain(scenario.id);
  });

  test("a dry run shows what the scenario does to the world, with no agent", async () => {
    const { platform: p } = testPlatform();
    const { scenario, world } = await seed(p);
    const dry = await p.scenarios.dryRun(scenario.id, 1);
    expect(dry.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(dry.agentTaskAt).toBeGreaterThan(0);
    expect(dry.timeline.some((t) => t.source === "scenario")).toBe(true);
    expect(dry.timeline.some((t) => t.source === "alarm")).toBe(true);
    expect(dry.series.length).toBeGreaterThan(0);
    const draft = await p.scenarios.create(YEONSU, { worldId: world.id });
    const nothing = await p.scenarios.dryRun(draft.scenario.id, 1);
    expect(nothing.timeline).toEqual([]);
    expect(nothing.issues.length).toBeGreaterThan(0);
  });
});

describe("what the server says about itself [REQ-031] [REQ-033]", () => {
  test("who is asking, the harnesses with their agents, sources and limits", async () => {
    const down = new ScriptHarness("down", untilStopped);
    let asked = 0;
    down.agents = async () => {
      asked++;
      throw new Error("timeout");
    };
    const { platform: p } = testPlatform([down], { version: "1.2.3" });
    const meta = await p.meta(JIMIN);
    expect(meta).toMatchObject({
      version: "1.2.3",
      user: { name: "jimin", source: "self" },
      sources: [{ id: "sample", readOnly: true }],
      telemetry: { configured: false },
      limits: { maxRunning: 32, maxSeeds: 20 },
      queue: { running: 0, queued: 0 },
    });
    expect(meta.harnesses.map((h) => [h.id, h.status, h.agents.length])).toEqual([
      ["builtin", "ok", 4],
      ["down", "unreachable", 0],
    ]);
    await p.meta(JIMIN);
    expect(asked).toBe(1);
    expect(DEFAULT_TOOLSET.length).toBeGreaterThan(5);
  });
});
