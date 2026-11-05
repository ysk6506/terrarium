import { ForbiddenError } from "@terrarium/core/contract";
import { NotFoundError } from "@terrarium/core/kernel";
import { describe, expect, test } from "vitest";
import { FakeFetch, json } from "../adapters/test-support/fake-fetch";
import type { Stamps } from "./ids";
import { JIMIN, recipe, seed, testPlatform, YEONSU } from "./test-support/platform";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 1);

/** The agent the harness reports, which a test can change between experiments. */
async function setup() {
  let t = T0;
  let n = 0;
  const stamps: Stamps = { id: (p) => `${p}-${++n}`, now: () => new Date(t).toISOString() };
  const agents: Array<Record<string, unknown>> = [
    { id: "triage", name: "분류", model: "m-1", facts: { graph: "v1" } },
    { id: "fixer", name: "수리" },
  ];
  const fake = new FakeFetch().on("GET", /^\/agents$/, () => json({ agents }));
  const built = testPlatform([], { stamps, adapters: { connect: { env: {}, fetch: fake.fetch } } });
  const connection = await built.platform.connections.create(YEONSU, {
    connector: "http",
    name: "회사 하네스",
    config: { url: "https://harness.test" },
  });
  const { world, scenario } = await seed(built.platform);
  const experiment = (who = YEONSU, agentId = "triage", name = "실험") =>
    built.platform.experiments.create(who, {
      name,
      recipe: recipe(world.id, scenario.id, { harnessId: connection.id, agentId }),
    });
  return {
    ...built,
    agents,
    connection,
    experiment,
    world,
    scenario,
    day: (d: number) => {
      t = T0 + d * DAY;
    },
  };
}

describe("an agent that changed gets a new version when an experiment is made [REQ-053]", () => {
  test("the same agent keeps its version; a changed one gets the next, with the date and what differs", async () => {
    const s = await setup();
    const first = await s.experiment();
    expect(first.experiment.agentVersion).toBe(1);
    s.day(2);
    expect((await s.experiment()).experiment.agentVersion).toBe(1);

    s.day(5);
    s.agents[0] = {
      id: "triage",
      name: "분류",
      model: "m-2",
      facts: { graph: "v1", mode: "fast" },
    };
    const changed = await s.experiment(JIMIN);
    expect(changed.experiment.agentVersion).toBe(2);

    const history = await s.platform.agentVersions.history(s.connection.id, "triage");
    expect(history.pending).toBeUndefined();
    expect(history.versions.map((v) => v.n)).toEqual([2, 1]);
    expect(history.versions[0]).toMatchObject({
      n: 2,
      at: new Date(T0 + 5 * DAY).toISOString(),
      source: "auto",
      by: "jimin",
      experiments: 1,
      changes: [
        { field: "model", label: "모델", before: "m-1", after: "m-2" },
        { field: "fact.mode", label: "하네스가 알려 준 사실 mode", after: "fast" },
      ],
    });
    expect(history.versions[1]).toMatchObject({ n: 1, changes: [], experiments: 2, by: "yeonsu" });
    // The other agent of the harness has its own history.
    expect((await s.experiment(YEONSU, "fixer")).experiment.agentVersion).toBe(1);
    expect(
      (await s.platform.agentVersions.history(s.connection.id, "fixer")).versions,
    ).toHaveLength(1);
  });

  test("the history says what the next experiment would add, without adding it", async () => {
    const s = await setup();
    const before = await s.platform.agentVersions.history(s.connection.id, "triage");
    expect(before).toMatchObject({ versions: [], pending: { first: true, changes: [] } });
    await s.experiment();
    expect(
      (await s.platform.agentVersions.history(s.connection.id, "triage")).pending,
    ).toBeUndefined();
    s.agents[0] = { id: "triage", name: "새 분류", model: "m-1", facts: { graph: "v1" } };
    const preview = await s.platform.agentVersions.history(s.connection.id, "triage");
    expect(preview.pending).toEqual({
      first: false,
      changes: [{ field: "name", label: "이름", before: "분류", after: "새 분류" }],
    });
    expect(preview.versions).toHaveLength(1);
  });

  test("a harness that cannot be reached says so, and the versions are still there", async () => {
    const s = await setup();
    await s.experiment();
    s.agents.length = 0;
    const view = await s.platform.agentVersions.history(s.connection.id, "triage");
    expect(view.versions).toHaveLength(1);
    expect(view.pending).toBeUndefined();
    expect(view.pendingError).toContain("triage");
    await expect(s.platform.agentVersions.history("nope", "triage")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("a fork looks at the agent again; a fork that is refused changes nothing", async () => {
    const s = await setup();
    const parent = await s.experiment();
    s.agents[0] = { id: "triage", name: "분류", model: "m-2", facts: { graph: "v1" } };
    await expect(
      s.platform.experiments.fork(YEONSU, parent.experiment.id, { change: {} }),
    ).rejects.toThrow();
    expect(
      (await s.platform.agentVersions.history(s.connection.id, "triage")).versions,
    ).toHaveLength(1);

    const fork = await s.platform.experiments.fork(YEONSU, parent.experiment.id, {
      change: { seeds: [7] },
    });
    expect(fork.experiment.agentVersion).toBe(2);
    expect(fork.experiment.subject?.agent.model).toBe("m-2");
    expect(parent.experiment.subject?.agent.model).toBe("m-1");
    // Forking to another agent carries that agent's version.
    const other = await s.platform.experiments.fork(YEONSU, parent.experiment.id, {
      change: { agentId: "fixer" },
    });
    expect(other.experiment.agentVersion).toBe(1);
  });

  test("experiments made at the same moment write one version, not two", async () => {
    const s = await setup();
    await s.experiment();
    s.agents[0] = { id: "triage", name: "분류", model: "m-5" };
    const made = await Promise.all([s.experiment(), s.experiment(), s.experiment()]);
    expect(made.map((m) => m.experiment.agentVersion)).toEqual([2, 2, 2]);
    expect(
      (await s.platform.agentVersions.history(s.connection.id, "triage")).versions,
    ).toHaveLength(2);
  });
});

describe("people add, change and delete versions [REQ-053]", () => {
  test("adding one, naming it, and the next look compares with what people said", async () => {
    const s = await setup();
    await s.experiment();
    s.day(3);
    const added = await s.platform.agentVersions.add(YEONSU, s.connection.id, "triage", {
      label: "프롬프트 v2",
      note: "규칙 추가",
      attributes: { prompt: "v2" },
    });
    expect(added.versions[0]).toMatchObject({
      n: 2,
      source: "manual",
      by: "yeonsu",
      label: "프롬프트 v2",
      note: "규칙 추가",
      attributes: { prompt: "v2" },
      changes: [{ field: "attr.prompt", label: "속성 prompt", after: "v2" }],
    });
    // Nothing differs in what the agent says, so the next experiment runs as the version people added.
    expect((await s.experiment()).experiment.agentVersion).toBe(2);

    const edited = await s.platform.agentVersions.edit(YEONSU, s.connection.id, "triage", 2, {
      label: null,
      attributes: { prompt: "v2b" },
    });
    expect(edited.versions[0]).toMatchObject({
      n: 2,
      attributes: { prompt: "v2b" },
      note: "규칙 추가",
    });
    expect(edited.versions[0]?.label).toBeUndefined();
    expect(edited.versions[0]?.experiments).toBe(1);
  });

  test("the first version may be a person's, then it is the agent as it is now", async () => {
    const s = await setup();
    const added = await s.platform.agentVersions.add(YEONSU, s.connection.id, "triage", {
      label: "시작",
    });
    expect(added.versions).toHaveLength(1);
    expect(added.versions[0]?.snapshot.model).toBe("m-1");
    s.agents.length = 0;
    await expect(
      s.platform.agentVersions.add(YEONSU, s.connection.id, "fixer", {}),
    ).rejects.toThrow("버전을 더할 수 없어요");
  });

  test("a deleted version is gone and its number is not used again", async () => {
    const s = await setup();
    await s.experiment();
    s.agents[0] = { id: "triage", name: "분류", model: "m-2" };
    await s.experiment();
    const cut = await s.platform.agentVersions.remove(YEONSU, s.connection.id, "triage", 2);
    expect(cut.versions.map((v) => v.n)).toEqual([1]);
    // The agent still says m-2, so the next experiment finds it differs from version 1: version 3.
    expect((await s.experiment()).experiment.agentVersion).toBe(3);
    await expect(
      s.platform.agentVersions.remove(YEONSU, s.connection.id, "triage", 2),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      s.platform.agentVersions.edit(YEONSU, s.connection.id, "fixer", 1, { label: "x" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("only whoever connected it may change its versions; the config file's connection is open to everyone", async () => {
    const s = await setup();
    await s.experiment();
    await expect(
      s.platform.agentVersions.add(JIMIN, s.connection.id, "triage", { label: "가로채기" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      s.platform.agentVersions.remove(JIMIN, s.connection.id, "triage", 1),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const open = await s.platform.agentVersions.add(JIMIN, "builtin", "triage", {
      label: "누구나",
    });
    expect(open.versions[0]).toMatchObject({ n: 1, by: "jimin", label: "누구나" });
    const looked = await s.platform.agentVersions.history(s.connection.id, "triage");
    expect(looked.versions).toHaveLength(1);
  });

  test("the versions go away with the connection; a different agent's stay", async () => {
    const s = await setup();
    await s.experiment();
    await s.platform.agentVersions.add(JIMIN, "builtin", "triage", {});
    const made = await s.experiment();
    await s.platform.experiments.cancel(YEONSU, made.experiment.id);
    for (const e of await s.platform.experiments.list({}))
      await s.platform.experiments.cancel(YEONSU, e.experiment.id).catch(() => undefined);
    await s.platform.connections.remove(YEONSU, s.connection.id);
    expect(await s.store.listAgentHistories(s.connection.id)).toEqual([]);
    expect(await s.store.listAgentHistories("builtin")).toHaveLength(1);
  });
});
