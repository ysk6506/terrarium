/**
 * Every ExperimentStore behaves the same: the in-memory one used in tests and the SQLite one the
 * server runs on. One suite, both stores.
 */
import {
  applyRunEvent,
  type Experiment,
  type ExperimentStore,
  MemoryStore,
  newRun,
  type ScenarioRecord,
  type WorldRecord,
} from "@terrarium/core/experiments";
import { emptyScenario } from "@terrarium/core/scenario";
import { describe, expect, test } from "vitest";
import { SqliteStore } from "../../apps/server/src/adapters";
import { sampleBlueprint } from "../../packages/core/src/world/test-support/sample";

const world = (digest: string, name: string, updatedAt = "2026-10-29T00:00:00Z"): WorldRecord => ({
  id: "w1",
  name,
  owner: "yeonsu",
  origin: "sample",
  blueprint: { ...sampleBlueprint(), name },
  digest,
  createdAt: "2026-10-28T00:00:00Z",
  updatedAt,
});

const scenario = (
  id: string,
  worldId: string,
  digest: string,
  updatedAt: string,
): ScenarioRecord => ({
  id,
  worldId,
  name: `시나리오 ${id}`,
  owner: "yeonsu",
  doc: emptyScenario(id, worldId),
  digest,
  createdAt: updatedAt,
  updatedAt,
});

const experiment = (id: string, extra: Partial<Experiment> = {}): Experiment => ({
  id,
  name: `실험 ${id}`,
  owner: "yeonsu",
  createdAt: `2026-10-29T00:00:0${id.slice(-1)}Z`,
  recipe: {
    worldId: "w1",
    scenarioId: "s1",
    harnessId: "h1",
    agentId: "triage",
    tools: ["list_alarms"],
    seeds: [1],
    time: { kind: "lockstep", secondsPerCall: 30 },
    profiles: {},
  },
  snapshot: {
    worldDigest: "d1",
    worldName: "w",
    scenarioDigest: "s",
    scenarioName: "s",
    oracle: "1",
  },
  benchmarkKey: "bk1",
  ...extra,
});

const stores: Array<[string, () => ExperimentStore]> = [
  ["memory", () => new MemoryStore()],
  ["sqlite", () => new SqliteStore(":memory:")],
];

describe.each(stores)("the %s store [REQ-030] [REQ-033] [REQ-040]", (_name, make) => {
  test("worlds: the head changes, every version stays, deleting hides the head only", async () => {
    const store = make();
    await store.putWorld(world("d1", "첫 판"));
    await store.putWorld(world("d2", "둘째 판", "2026-10-29T01:00:00Z"));
    expect((await store.getWorld("w1"))?.name).toBe("둘째 판");
    expect((await store.getWorld("w1"))?.blueprint.name).toBe("둘째 판");
    expect((await store.worldVersion("w1", "d1"))?.name).toBe("첫 판");
    const [summary] = await store.listWorlds();
    expect(summary).toMatchObject({ id: "w1", digest: "d2", counts: { server: 3, rack: 2 } });
    expect(summary).not.toHaveProperty("blueprint");
    expect(await store.deleteWorld("w1")).toBe(true);
    expect(await store.deleteWorld("w1")).toBe(false);
    expect(await store.getWorld("w1")).toBeUndefined();
    expect(await store.listWorlds()).toEqual([]);
    expect(await store.worldVersion("w1", "d2")).toBeDefined();
    await store.putWorld(world("d3", "되살림"));
    expect((await store.getWorld("w1"))?.name).toBe("되살림");
    expect(await store.getWorld("nope")).toBeUndefined();
  });

  test("scenarios: listed per world, newest first, versions kept", async () => {
    const store = make();
    await store.putScenario(scenario("s1", "w1", "x1", "2026-10-29T00:00:01Z"));
    await store.putScenario(scenario("s2", "w1", "x2", "2026-10-29T00:00:02Z"));
    await store.putScenario(scenario("s3", "w2", "x3", "2026-10-29T00:00:03Z"));
    expect((await store.listScenarios("w1")).map((s) => s.id)).toEqual(["s2", "s1"]);
    expect((await store.listScenarios()).map((s) => s.id)).toEqual(["s3", "s2", "s1"]);
    await store.putScenario({
      ...scenario("s1", "w1", "x9", "2026-10-29T00:00:09Z"),
      name: "고침",
    });
    expect((await store.getScenario("s1"))?.name).toBe("고침");
    expect(await store.scenarioVersion("s1", "x1")).toMatchObject({ id: "s1" });
    expect(await store.scenarioVersion("s1", "zz")).toBeUndefined();
    expect(await store.deleteScenario("s1")).toBe(true);
    expect(await store.getScenario("s1")).toBeUndefined();
    expect(await store.deleteScenario("s1")).toBe(false);
  });

  test("experiments: newest first, filtered by owner, set, parent, world, scenario and words", async () => {
    const store = make();
    await store.putExperiment(experiment("e1", { note: "냉방 회귀 확인" }));
    await store.putExperiment(
      experiment("e2", { owner: "jimin", parentId: "e1", benchmarkKey: "bk2" }),
    );
    await store.putExperiment(
      experiment("e3", { recipe: { ...experiment("e3").recipe, scenarioId: "s9" } }),
    );
    const ids = async (f?: Parameters<ExperimentStore["listExperiments"]>[0]) =>
      (await store.listExperiments(f)).map((e) => e.id);
    expect(await ids()).toEqual(["e3", "e2", "e1"]);
    expect(await ids({ owner: "jimin" })).toEqual(["e2"]);
    expect(await ids({ benchmarkKey: "bk1" })).toEqual(["e3", "e1"]);
    expect(await ids({ parentId: "e1" })).toEqual(["e2"]);
    expect(await ids({ scenarioId: "s9" })).toEqual(["e3"]);
    expect(await ids({ worldId: "w1", limit: 2 })).toEqual(["e3", "e2"]);
    expect(await ids({ text: "냉방 확인" })).toEqual(["e1"]);
    expect(await ids({ text: "실험 E2" })).toEqual(["e2"]);
    expect(await ids({ text: "없는말" })).toEqual([]);
    await store.putExperiment({ ...experiment("e1"), name: "이름 바꿈" });
    expect((await store.getExperiment("e1"))?.name).toBe("이름 바꿈");
    expect(await store.getExperiment("e9")).toBeUndefined();
  });

  test("runs: in order per experiment; the active ones are what a restart picks up", async () => {
    const store = make();
    const at = (n: number) => `2026-10-29T00:00:0${n}Z`;
    const r0 = newRun("e1-r0", "e1", 0, 1, at(1));
    const r1 = newRun("e1-r1", "e1", 1, 2, at(1));
    const other = newRun("e2-r0", "e2", 0, 1, at(0));
    for (const r of [r1, r0, other]) await store.putRun(r);
    await store.putRun(applyRunEvent(r0, { type: "start", at: at(2) }));
    await store.putRun(applyRunEvent(r1, { type: "cancel", at: at(3) }));
    expect((await store.listRuns("e1")).map((r) => [r.id, r.status])).toEqual([
      ["e1-r0", "running"],
      ["e1-r1", "cancelled"],
    ]);
    expect((await store.listActiveRuns()).map((r) => r.id)).toEqual(["e2-r0", "e1-r0"]);
    expect((await store.getRun("e1-r0"))?.startedAt).toBe(at(2));
    expect(await store.getRun("x")).toBeUndefined();
  });

  test("share links can be made, read and taken back", async () => {
    const store = make();
    await store.putShare({
      token: "t1",
      experimentId: "e1",
      createdBy: "y",
      createdAt: "c",
      expiresAt: "z",
    });
    expect(await store.getShare("t1")).toEqual({
      token: "t1",
      experimentId: "e1",
      createdBy: "y",
      createdAt: "c",
      expiresAt: "z",
    });
    expect(await store.deleteShare("t1")).toBe(true);
    expect(await store.deleteShare("t1")).toBe(false);
    expect(await store.getShare("t1")).toBeUndefined();
  });
});
