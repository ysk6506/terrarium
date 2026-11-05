import { DEFAULT_TOOLSET } from "@terrarium/core/tools";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../world/test-support/sample";
import {
  applyRunEvent,
  benchmarkKey,
  type Experiment,
  experimentStatus,
  FairScheduler,
  forkExperiment,
  forksOf,
  lineage,
  MemoryStore,
  newRun,
  normalizeTools,
  progressOf,
  type QueuedRun,
  type Recipe,
  type RecipeContext,
  type RunRecord,
  recipeDiff,
  recipeProblems,
  type Snapshot,
  seedsUpTo,
} from ".";

const ctx: RecipeContext = {
  profiles: { vcenter: ["vcenter/7.0", "vcenter/8.0"], vrops: ["aria-ops/8.18"] },
  agents: ["triage", "deep"],
};
const recipe = (extra: Partial<Recipe> = {}): Recipe => ({
  worldId: "w1",
  scenarioId: "s1",
  harnessId: "h1",
  agentId: "triage",
  tools: DEFAULT_TOOLSET,
  seeds: [1, 2, 3],
  time: { kind: "lockstep", secondsPerCall: 30 },
  profiles: {},
  ...extra,
});
const snapshot: Snapshot = {
  worldDigest: "wd1",
  worldName: "홀",
  scenarioDigest: "sd1",
  scenarioName: "냉방기 정지",
  oracle: "1",
};
const experiment = (id: string, extra: Partial<Experiment> = {}): Experiment => ({
  id,
  name: `실험 ${id}`,
  owner: "yeonsu",
  createdAt: `2026-10-29T00:00:0${id.length % 10}Z`,
  recipe: recipe(),
  snapshot,
  benchmarkKey: benchmarkKey(snapshot, recipe()),
  ...extra,
});
const fakeResult = (passed: boolean) =>
  ({ score: { passed } }) as unknown as NonNullable<RunRecord["result"]>;

describe("recipes [REQ-030] [REQ-031]", () => {
  test("a sound recipe has no problems; every problem is named in Korean", () => {
    expect(recipeProblems(recipe(), ctx)).toEqual([]);
    expect(
      recipeProblems(
        recipe({
          tools: ["submit_diagnosis", "teleport", "submit_diagnosis"],
          seeds: [1, 1, -2, 0.5],
          time: { kind: "lockstep", secondsPerCall: 0 },
          profiles: { vcenter: "vcenter/9.9", vrops: "vrops/1" },
          harnessId: "",
          agentId: "ghost",
        }),
        ctx,
      ),
    ).toEqual([
      "알 수 없는 툴: teleport",
      "같은 툴이 두 번 들어 있어요",
      "시드는 0 이상의 정수여야 해요",
      "같은 시드가 두 번 들어 있어요",
      "툴 호출당 시간은 1~600초여야 해요",
      "알 수 없는 vCenter 버전 'vcenter/9.9'",
      "알 수 없는 vROps 버전 'vrops/1'",
      "하네스를 골라야 해요",
      "하네스에 'ghost' 에이전트가 없어요",
    ]);
    expect(recipeProblems(recipe({ tools: ["submit_diagnosis"], seeds: [] }), ctx)).toEqual([
      "조사에 쓸 툴을 하나 이상 골라야 해요 (진단 제출은 늘 포함돼요)",
      "시드를 하나 이상 정해야 해요",
    ]);
    expect(recipeProblems(recipe({ seeds: seedsUpTo(21), agentId: "" }), ctx)).toEqual([
      "실행은 한 실험에 20번까지예요 (지금 21번)",
      "에이전트를 골라야 해요",
    ]);
    expect(recipeProblems(recipe({ time: { kind: "realtime", speed: 0 } }), ctx)).toEqual([
      "시간 배속은 0보다 크고 100 이하여야 해요",
    ]);
    expect(
      recipeProblems(recipe({ time: { kind: "warp" } as never }), { profiles: ctx.profiles }),
    ).toEqual(["알 수 없는 시간 정책 'warp'"]);
  });

  test("tools are kept in catalog order without duplicates", () => {
    expect(normalizeTools(["wait", "list_alarms", "wait"])).toEqual(["list_alarms", "wait"]);
    expect(seedsUpTo(3)).toEqual([1, 2, 3]);
  });

  test("the benchmark key ignores what is compared and follows what changes the task", () => {
    const key = benchmarkKey(snapshot, recipe());
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(
      benchmarkKey(snapshot, recipe({ harnessId: "h2", agentId: "deep", tools: ["list_alarms"] })),
    ).toBe(key);
    expect(benchmarkKey({ ...snapshot, worldName: "다른 이름" }, recipe())).toBe(key);
    expect(benchmarkKey({ ...snapshot, worldDigest: "wd2" }, recipe())).not.toBe(key);
    expect(benchmarkKey({ ...snapshot, scenarioDigest: "sd2" }, recipe())).not.toBe(key);
    expect(benchmarkKey({ ...snapshot, oracle: "2" }, recipe())).not.toBe(key);
    expect(
      benchmarkKey(snapshot, recipe({ time: { kind: "lockstep", secondsPerCall: 60 } })),
    ).not.toBe(key);
    expect(benchmarkKey(snapshot, recipe({ profiles: { vcenter: "vcenter/7.0" } }))).not.toBe(key);
  });
});

describe("run lifecycle [REQ-030]", () => {
  test("runs go queued → running → finished, and finished runs never change", () => {
    const queued = newRun("r1", "e1", 0, 1, "t0");
    expect(queued).toEqual({
      id: "r1",
      experimentId: "e1",
      index: 0,
      seed: 1,
      status: "queued",
      queuedAt: "t0",
    });
    const running = applyRunEvent(queued, { type: "start", at: "t1" });
    const done = applyRunEvent(running, {
      type: "complete",
      at: "t2",
      result: fakeResult(true),
      harness: { traceId: "abc", inputTokens: 10 },
    });
    expect(done).toMatchObject({
      status: "completed",
      startedAt: "t1",
      finishedAt: "t2",
      harness: { traceId: "abc" },
    });
    expect(() => applyRunEvent(done, { type: "cancel", at: "t3" })).toThrow(
      /is completed; it cannot cancel/,
    );
    expect(() =>
      applyRunEvent(queued, { type: "complete", at: "t1", result: fakeResult(true) }),
    ).toThrow(/is queued; it cannot complete/);
    expect(applyRunEvent(queued, { type: "cancel", at: "t1" })).toMatchObject({
      status: "cancelled",
      finishedAt: "t1",
    });
    expect(
      applyRunEvent(running, {
        type: "fail",
        at: "t9",
        error: "harness down",
        harness: { message: "502" },
      }),
    ).toMatchObject({
      status: "failed",
      error: "harness down",
      harness: { message: "502" },
    });
    expect(
      applyRunEvent(running, { type: "complete", at: "t2", result: fakeResult(false) }),
    ).not.toHaveProperty("harness");
  });

  test("an experiment's status and progress follow its runs", () => {
    const run = (status: RunRecord["status"], passed = false): RunRecord => ({
      ...newRun(`r-${status}`, "e", 0, 1, "t"),
      status,
      ...(status === "completed" ? { result: fakeResult(passed) } : {}),
    });
    expect(experimentStatus([])).toBe("queued");
    expect(experimentStatus([run("queued"), run("queued")])).toBe("queued");
    expect(experimentStatus([run("running"), run("queued")])).toBe("running");
    expect(experimentStatus([run("completed"), run("queued")])).toBe("running");
    expect(experimentStatus([run("completed"), run("failed")])).toBe("completed");
    expect(experimentStatus([run("failed"), run("cancelled")])).toBe("failed");
    expect(experimentStatus([run("cancelled"), run("cancelled")])).toBe("cancelled");
    expect(
      progressOf([
        run("completed", true),
        run("completed"),
        run("failed"),
        run("running"),
        run("cancelled"),
      ]),
    ).toEqual({
      total: 5,
      finished: 4,
      completed: 2,
      passed: 1,
      failed: 1,
      cancelled: 1,
      running: 1,
    });
  });
});

describe("forks and lineage [REQ-040]", () => {
  const meta = { id: "e2", owner: "minji", createdAt: "2026-10-29T01:00:00Z" };

  test("a fork changes conditions, keeps its parent, and stays in the same benchmark set", () => {
    const parent = experiment("e1");
    const fork = forkExperiment(
      parent,
      { agentId: "deep", tools: ["wait", "list_alarms", "get_entity"] },
      meta,
      snapshot,
    );
    expect(fork).toMatchObject({
      id: "e2",
      owner: "minji",
      parentId: "e1",
      name: "실험 e1 (포크)",
      benchmarkKey: parent.benchmarkKey,
    });
    expect(fork.recipe.tools).toEqual(["list_alarms", "get_entity", "wait"]);
    expect(
      forkExperiment(
        parent,
        { harnessId: "h2" },
        { ...meta, name: "h2로", note: "비교" },
        snapshot,
      ),
    ).toMatchObject({ name: "h2로", note: "비교" });
  });

  test("a fork that changes nothing is refused; a new scenario version counts as a change", () => {
    const parent = experiment("e1");
    expect(() => forkExperiment(parent, {}, meta, snapshot)).toThrow(
      /조건을 하나 이상 바꿔야 해요/,
    );
    const rerun = forkExperiment(parent, {}, meta, { ...snapshot, scenarioDigest: "sd2" });
    expect(rerun.benchmarkKey).not.toBe(parent.benchmarkKey);
  });

  test("the difference reads as words, with tools added and removed", () => {
    const a = recipe();
    const b = recipe({
      agentId: "deep",
      tools: ["list_alarms", "redfish_request"],
      time: { kind: "realtime", speed: 2 },
      profiles: { vcenter: "vcenter/7.0" },
      seeds: [1, 2],
    });
    expect(recipeDiff(a, b)).toEqual([
      { field: "agentId", label: "에이전트", before: "triage", after: "deep" },
      {
        field: "tools",
        label: "툴",
        before: DEFAULT_TOOLSET.join(", "),
        after: `list_alarms, redfish_request (+redfish_request −${DEFAULT_TOOLSET.filter((t) => t !== "list_alarms").join(", −")})`,
      },
      { field: "seeds", label: "시드", before: "1, 2, 3", after: "1, 2" },
      { field: "time", label: "시간 정책", before: "호출당 30초", after: "실시간 ×2" },
      {
        field: "profiles",
        label: "제품 버전",
        before: "vCenter 기본 · vROps 기본",
        after: "vCenter vcenter/7.0 · vROps 기본",
      },
    ]);
    expect(recipeDiff(a, a)).toEqual([]);
  });

  test("the family tree can be walked up and down, and survives a broken or looping chain", () => {
    const all = [
      experiment("a"),
      experiment("b", { parentId: "a", createdAt: "2026-10-29T00:00:05Z" }),
      experiment("c", { parentId: "b" }),
      experiment("d", { parentId: "a", createdAt: "2026-10-29T00:00:03Z" }),
    ];
    expect(lineage(all, "c").map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(forksOf(all, "a").map((e) => e.id)).toEqual(["d", "b"]);
    expect(lineage([experiment("x", { parentId: "missing" })], "x").map((e) => e.id)).toEqual([
      "x",
    ]);
    const loop = [experiment("p", { parentId: "q" }), experiment("q", { parentId: "p" })];
    expect(lineage(loop, "p").map((e) => e.id)).toEqual(["q", "p"]);
    expect(lineage(all, "nope")).toEqual([]);
  });
});

describe("fair scheduler [REQ-032]", () => {
  const q = (runId: string, user: string, harnessId = "h1"): QueuedRun => ({
    runId,
    user,
    harnessId,
  });

  test("one person's many runs do not starve another's one", () => {
    const s = new FairScheduler({ maxRunning: 2, perUser: 8, perHarness: 8 });
    for (let i = 0; i < 10; i++) s.enqueue(q(`a${i}`, "alice"));
    s.enqueue(q("b0", "bob"));
    expect(s.take([]).map((r) => r.runId)).toEqual(["a0", "b0"]);
    expect(s.size).toBe(9);
  });

  test("the user with fewest runs going goes first, then whoever was served longest ago", () => {
    const s = new FairScheduler({ maxRunning: 10, perUser: 10, perHarness: 10 });
    for (const id of ["a1", "a2", "a3"]) s.enqueue(q(id, "alice"));
    for (const id of ["b1", "b2"]) s.enqueue(q(id, "bob"));
    s.enqueue(q("c1", "carol"));
    expect(s.take([q("x", "alice")]).map((r) => r.runId)).toEqual([
      "b1",
      "c1",
      "a1",
      "b2",
      "a2",
      "a3",
    ]);
  });

  test("limits per user, per harness (with overrides) and for the host", () => {
    const s = new FairScheduler({
      maxRunning: 10,
      perUser: 1,
      perHarness: 5,
      harness: { slow: 1 },
    });
    s.enqueue(q("a1", "alice"));
    s.enqueue(q("a2", "alice"));
    s.enqueue(q("b1", "bob", "slow"));
    s.enqueue(q("c1", "carol", "slow"));
    expect(s.take([]).map((r) => r.runId)).toEqual(["a1", "b1"]);
    expect(s.take([q("a1", "alice"), q("b1", "bob", "slow")])).toEqual([]);
    expect(s.take([q("b1", "bob", "slow")]).map((r) => r.runId)).toEqual(["a2"]);
    const full = new FairScheduler({ maxRunning: 1, perUser: 5, perHarness: 5 });
    full.enqueue(q("z", "zoe"));
    expect(full.take([q("other", "x")])).toEqual([]);
  });

  test("queue positions, removal and duplicate enqueues", () => {
    const s = new FairScheduler();
    s.enqueue(q("a1", "alice"));
    s.enqueue(q("a2", "alice"));
    s.enqueue(q("b1", "bob"));
    s.enqueue(q("b1", "bob"));
    expect(s.size).toBe(3);
    expect([
      s.positionOf("a1"),
      s.positionOf("b1"),
      s.positionOf("a2"),
      s.positionOf("zz"),
    ]).toEqual([1, 2, 3, undefined]);
    expect(s.remove("a1")).toBe(true);
    expect(s.remove("a1")).toBe(false);
    expect(s.positionOf("b1", [q("x", "alice")])).toBe(1);
  });

  test("the same queue and history always give the same order", () => {
    const order = () => {
      const s = new FairScheduler({ maxRunning: 3, perUser: 2, perHarness: 3 });
      for (const [id, user] of [
        ["a1", "a"],
        ["b1", "b"],
        ["a2", "a"],
        ["c1", "c"],
        ["b2", "b"],
      ] as const)
        s.enqueue(q(id, user));
      return [s.take([]), s.take([])].map((batch) => batch.map((r) => r.runId));
    };
    expect(order()).toEqual(order());
    expect(order()).toEqual([
      ["a1", "b1", "c1"],
      ["a2", "b2"],
    ]);
  });
});

describe("memory store [REQ-030] [REQ-033]", () => {
  const world = (digest: string, name = "홀") => ({
    id: "w1",
    name,
    owner: "yeonsu",
    origin: "sample" as const,
    blueprint: { ...sampleBlueprint(), name },
    digest,
    createdAt: "2026-10-29T00:00:00Z",
    updatedAt: `2026-10-29T00:00:0${digest.length}Z`,
  });

  test("editing a world keeps earlier versions for the experiments that used them", async () => {
    const store = new MemoryStore();
    await store.putWorld(world("d1", "첫 판"));
    await store.putWorld(world("d22", "둘째 판"));
    expect((await store.getWorld("w1"))?.name).toBe("둘째 판");
    expect((await store.worldVersion("w1", "d1"))?.name).toBe("첫 판");
    const [summary] = await store.listWorlds();
    expect(summary).toMatchObject({ id: "w1", digest: "d22", counts: { server: 3, rack: 2 } });
    expect(summary).not.toHaveProperty("blueprint");
    expect(await store.deleteWorld("w1")).toBe(true);
    expect(await store.getWorld("w1")).toBeUndefined();
    expect(await store.worldVersion("w1", "d22")).toBeDefined();
    expect(await store.deleteWorld("w1")).toBe(false);
  });

  test("scenarios are versioned and listed per world", async () => {
    const store = new MemoryStore();
    const doc = {
      schemaVersion: 1,
      id: "s1",
      name: "s",
      description: "",
      worldId: "w1",
      nodes: [],
      edges: [],
      expectations: [],
    };
    const rec = {
      id: "s1",
      worldId: "w1",
      name: "s",
      owner: "y",
      doc,
      digest: "x1",
      createdAt: "t",
      updatedAt: "t1",
    };
    await store.putScenario(rec);
    await store.putScenario({ ...rec, id: "s2", worldId: "w2", updatedAt: "t2" });
    expect((await store.listScenarios("w1")).map((s) => s.id)).toEqual(["s1"]);
    expect((await store.listScenarios()).map((s) => s.id)).toEqual(["s2", "s1"]);
    expect(await store.scenarioVersion("s1", "x1")).toEqual(doc);
    expect(await store.scenarioVersion("s1", "nope")).toBeUndefined();
    expect(await store.deleteScenario("s1")).toBe(true);
    expect(await store.getScenario("s1")).toBeUndefined();
  });

  test("experiments filter and sort newest first; runs come back in order; values are copies", async () => {
    const store = new MemoryStore();
    await store.putExperiment(experiment("e1", { createdAt: "2026-10-29T00:00:01Z" }));
    await store.putExperiment(
      experiment("e2", { createdAt: "2026-10-29T00:00:02Z", parentId: "e1", owner: "minji" }),
    );
    await store.putExperiment(
      experiment("e3", { createdAt: "2026-10-29T00:00:03Z", benchmarkKey: "other" }),
    );
    expect((await store.listExperiments()).map((e) => e.id)).toEqual(["e3", "e2", "e1"]);
    expect((await store.listExperiments({ owner: "minji" })).map((e) => e.id)).toEqual(["e2"]);
    expect((await store.listExperiments({ parentId: "e1" })).map((e) => e.id)).toEqual(["e2"]);
    expect((await store.listExperiments({ benchmarkKey: "other" })).map((e) => e.id)).toEqual([
      "e3",
    ]);
    expect(
      (await store.listExperiments({ worldId: "w1", scenarioId: "s1", limit: 1 })).map((e) => e.id),
    ).toEqual(["e3"]);
    await store.putRun({ ...newRun("r2", "e1", 1, 2, "t"), status: "running" });
    await store.putRun(newRun("r1", "e1", 0, 1, "t"));
    expect((await store.listRuns("e1")).map((r) => r.id)).toEqual(["r1", "r2"]);
    const got = (await store.getExperiment("e1")) as Experiment;
    (got.recipe.tools as string[]).push("x");
    expect((await store.getExperiment("e1"))?.recipe.tools).toEqual(DEFAULT_TOOLSET);
    expect(await store.getRun("r2")).toMatchObject({ status: "running" });
    expect(await store.getExperiment("nope")).toBeUndefined();
  });

  test("share links are kept, found and revoked", async () => {
    const store = new MemoryStore();
    await store.putShare({ token: "tok", experimentId: "e1", createdBy: "y", createdAt: "t" });
    expect(await store.getShare("tok")).toMatchObject({ experimentId: "e1" });
    expect(await store.deleteShare("tok")).toBe(true);
    expect(await store.getShare("tok")).toBeUndefined();
  });
});
