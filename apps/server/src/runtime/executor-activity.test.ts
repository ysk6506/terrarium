import type { ActivityEvent } from "@terrarium/core/contract";
import { describe, expect, test } from "vitest";
import {
  recipe,
  ScriptHarness,
  seed,
  settled,
  testPlatform,
  until,
  YEONSU,
} from "./test-support/platform";

const AGENTS = [{ id: "a", name: "관제 에이전트", model: "gpt-사내" }];

async function play(
  harness: ScriptHarness,
  during?: (world: string, seen: ActivityEvent[]) => Promise<void> | void,
) {
  const t = testPlatform([harness]);
  const { world, scenario } = await seed(t.platform);
  const seen: ActivityEvent[] = [];
  t.platform.events.subscribeWorld(world.id, (e) => seen.push(e));
  const created = await t.platform.experiments.create(YEONSU, {
    name: "냉방 점검",
    recipe: recipe(world.id, scenario.id, { harnessId: harness.info.id, agentId: "a", runs: 1 }),
  });
  await during?.(world.id, seen);
  await settled(t.platform, YEONSU, created.experiment.id);
  return { ...t, world, seen, experimentId: created.experiment.id };
}

describe("who works where in a world [REQ-050]", () => {
  test("a run announces itself, then each call with the equipment it names and what it does, then its end", async () => {
    const h = new ScriptHarness(
      "h",
      async (req) => {
        await req.tools.call("get_entity", { id: "crah-1" });
        await req.tools.call("set_cooling_setpoint", { unitId: "crah-1", celsius: 20 });
        await req.tools.call("wait", { seconds: 10 });
        await req.tools.call("submit_diagnosis", {
          rootCause: "crah-1",
          faultType: "cooling_unit_failure",
          summary: "정지",
        });
        return { status: "finished" };
      },
      AGENTS,
    );
    const { seen } = await play(h);
    const [start, ...rest] = seen;
    expect(start).toMatchObject({
      type: "start",
      who: {
        experiment: "냉방 점검",
        owner: "yeonsu",
        harness: "하네스 h",
        agent: "관제 에이전트",
        model: "gpt-사내",
      },
    });
    const calls = rest.filter((e) => e.type === "call");
    expect(calls.map((e) => (e.type === "call" ? [e.tool, e.effect, e.targets] : []))).toEqual([
      ["get_entity", "observe", ["crah-1"]],
      ["set_cooling_setpoint", "act", ["crah-1"]],
      ["wait", "wait", []],
      ["submit_diagnosis", "answer", ["crah-1"]],
    ]);
    expect(rest.at(-1)).toEqual({ type: "end", runId: (start as { runId: string }).runId });
  });

  test("the experiment's own stream carries the same equipment and effect", async () => {
    let go: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      go = resolve;
    });
    const h = new ScriptHarness(
      "h",
      async (req) => {
        await ready;
        await req.tools.call("power_server", { id: "srv-1", action: "off" });
        return { status: "finished" };
      },
      AGENTS,
    );
    const t = testPlatform([h]);
    const { world, scenario } = await seed(t.platform);
    const created = await t.platform.experiments.create(YEONSU, {
      name: "전원",
      recipe: recipe(world.id, scenario.id, { harnessId: "h", agentId: "a", runs: 1 }),
    });
    const calls: unknown[] = [];
    t.platform.events.subscribe(created.experiment.id, (e) => {
      if (e.type === "call") calls.push([e.tool, e.effect, e.targets]);
    });
    go();
    await settled(t.platform, YEONSU, created.experiment.id);
    expect(calls).toEqual([["power_server", "act", ["srv-1"]]]);
  });

  test("someone who arrives while a run is working is told who is working, and nobody once it is over", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = new ScriptHarness(
      "h",
      async (req) => {
        await req.tools.call("list_alarms", {});
        await gate;
        return { status: "finished" };
      },
      AGENTS,
    );
    const { world, platform } = await (async () => {
      const t = testPlatform([h]);
      const { world, scenario } = await seed(t.platform);
      await t.platform.experiments.create(YEONSU, {
        name: "느린 실행",
        recipe: recipe(world.id, scenario.id, { harnessId: "h", agentId: "a", runs: 1 }),
      });
      return { world, platform: t.platform };
    })();
    await until(() => platform.events.workingIn(world.id).length === 1);
    expect(platform.events.workingIn(world.id)[0]).toMatchObject({
      type: "start",
      who: { experiment: "느린 실행", agent: "관제 에이전트" },
    });
    release();
    await until(() => platform.events.workingIn(world.id).length === 0);
  });

  test("a harness that is slow to name its agents does not hold the run: the agent shows under its id", async () => {
    const h = new ScriptHarness(
      "h",
      async (req) => {
        await req.tools.call("list_alarms", {});
        return { status: "finished" };
      },
      AGENTS,
    );
    let asked = 0;
    // The platform asks once when the experiment is made; the run's own question never comes back.
    h.agents = () => (++asked === 1 ? Promise.resolve(AGENTS) : new Promise(() => {}));
    const { seen } = await play(h);
    expect(seen[0]).toMatchObject({ type: "start", who: { agent: "a" } });
    expect(seen[0]).not.toHaveProperty("who.model");
  });
});
