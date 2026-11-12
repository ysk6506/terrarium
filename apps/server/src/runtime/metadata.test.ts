import { MetadataBody } from "@terrarium/core/contract";
import { describe, expect, test } from "vitest";
import { FakeFetch, json } from "../adapters/test-support/fake-fetch";
import {
  ADMIN,
  HANEUL,
  recipe,
  ScriptHarness,
  seed,
  settled,
  testPlatform,
} from "./test-support/platform";

const AGENTS = [
  {
    id: "triage",
    name: "분류",
    model: "m-1",
    description: "알람 분류",
    facts: { graph: "triage" },
  },
  { id: "fixer", name: "수리" },
];

/** A platform with a connected harness that names its agents, so metadata has something to describe. */
async function setup() {
  const fake = new FakeFetch().on("GET", /^\/agents$/, () => json({ agents: AGENTS }));
  const built = testPlatform([], { adapters: { connect: { env: {}, fetch: fake.fetch } } });
  const connection = await built.platform.connections.create(HANEUL, {
    connector: "http",
    name: "회사 하네스",
    config: { url: "https://harness.test" },
    metadata: { team: "platform", 버전: "1.4" },
  });
  const { world, scenario } = await seed(built.platform);
  return { ...built, connection, world, scenario };
}

describe("metadata that tells results apart: kept, shown and searched [REQ-052]", () => {
  test("an experiment keeps what its maker attached and who ran it, as they were when it was made", async () => {
    const { platform, connection, world, scenario } = await setup();
    const made = await platform.experiments.create(HANEUL, {
      name: "메타데이터",
      recipe: recipe(world.id, scenario.id, { harnessId: connection.id, agentId: "triage" }),
      metadata: { prompt: "v2" },
    });
    expect(made.experiment.metadata).toEqual({ prompt: "v2" });
    expect(made.experiment.subject).toEqual({
      harness: {
        id: connection.id,
        name: "회사 하네스",
        kind: "http",
        toolTransport: "mcp",
        metadata: { team: "platform", 버전: "1.4" },
      },
      agent: {
        id: "triage",
        name: "분류",
        model: "m-1",
        description: "알람 분류",
        facts: { graph: "triage" },
      },
    });
    await platform.connections.remove(HANEUL, connection.id).catch(() => undefined);
  });

  test("an agent with nothing to say about itself is still named, and a harness of the config file has no metadata", async () => {
    const { platform, world, scenario } = await setup();
    const made = await platform.experiments.create(HANEUL, {
      name: "내장",
      recipe: recipe(world.id, scenario.id),
    });
    expect(made.experiment.metadata).toBeUndefined();
    expect(made.experiment.subject?.harness).toEqual({
      id: "builtin",
      name: "내장",
      kind: "scripted",
      toolTransport: "in-process",
    });
    expect(made.experiment.subject?.agent.id).toBe("triage");
  });

  test("a fork keeps its parent's metadata, or replaces it; who runs it is looked up again only when that changed", async () => {
    const { platform, connection, world, scenario } = await setup();
    const parent = await platform.experiments.create(HANEUL, {
      name: "원본",
      recipe: recipe(world.id, scenario.id, { harnessId: connection.id, agentId: "triage" }),
      metadata: { prompt: "v1", team: "x" },
    });
    const sameWho = await platform.experiments.fork(HANEUL, parent.experiment.id, {
      change: { seeds: [7, 8] },
    });
    expect(sameWho.experiment.metadata).toEqual({ prompt: "v1", team: "x" });
    expect(sameWho.experiment.subject).toEqual(parent.experiment.subject);
    const replaced = await platform.experiments.fork(HANEUL, parent.experiment.id, {
      change: { agentId: "fixer" },
      metadata: { prompt: "v2" },
    });
    expect(replaced.experiment.metadata).toEqual({ prompt: "v2" });
    expect(replaced.experiment.subject?.agent).toEqual({ id: "fixer", name: "수리" });
    expect(replaced.experiment.subject?.harness).toEqual(parent.experiment.subject?.harness);
  });

  test("experiments are found by their own metadata or by the connection's, with a value or without", async () => {
    const { platform, connection, world, scenario } = await setup();
    const plain = (name: string, extra: object = {}) =>
      platform.experiments.create(HANEUL, {
        name,
        recipe: recipe(world.id, scenario.id, { harnessId: connection.id, agentId: "triage" }),
        ...extra,
      });
    await plain("a", { metadata: { prompt: "v1" } });
    await plain("b", { metadata: { prompt: "v2" } });
    await plain("c");
    const found = (meta: string) =>
      platform.experiments
        .list(ADMIN, { meta })
        .then((l) => l.map((s) => s.experiment.name).sort());
    expect(await found("prompt=v1")).toEqual(["a"]);
    expect(await found("prompt")).toEqual(["a", "b"]);
    expect(await found("team=platform")).toEqual(["a", "b", "c"]);
    expect(await found("버전=1.4")).toEqual(["a", "b", "c"]);
    expect(await found("team=other")).toEqual([]);
    expect(await found("nothing")).toEqual([]);
    expect(await platform.experiments.list(ADMIN, {})).toHaveLength(3);
  });

  test("metadata is few, short and plain", () => {
    expect(MetadataBody.safeParse({ team: "platform", "프롬프트-버전": "v2" }).success).toBe(true);
    expect(MetadataBody.safeParse({ "has space": "x" }).success).toBe(false);
    expect(MetadataBody.safeParse({ k: "" }).success).toBe(false);
    expect(MetadataBody.safeParse({ k: "x".repeat(201) }).success).toBe(false);
    expect(MetadataBody.safeParse({ ["k".repeat(41)]: "x" }).success).toBe(false);
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, "v"]));
    expect(MetadataBody.safeParse(many).success).toBe(false);
  });

  test("the model that really answered, and the tokens, are kept with the run", async () => {
    const modeled = new ScriptHarness("modeled", async () => ({
      status: "finished",
      harness: { model: "claude-x", inputTokens: 5, outputTokens: 2 },
    }));
    const { platform, store } = testPlatform([modeled]);
    const { world, scenario } = await seed(platform);
    const made = await platform.experiments.create(HANEUL, {
      name: "모델 기록",
      recipe: recipe(world.id, scenario.id, { harnessId: "modeled", agentId: "a" }),
    });
    await settled(platform, HANEUL, made.experiment.id);
    const [run] = await store.listRuns(made.experiment.id);
    expect(run?.harness).toMatchObject({ model: "claude-x", inputTokens: 5, outputTokens: 2 });
  });
});
