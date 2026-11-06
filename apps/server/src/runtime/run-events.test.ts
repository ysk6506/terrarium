import { NotFoundError } from "@terrarium/core/kernel";
import { describe, expect, test } from "vitest";
import {
  recipe,
  ScriptHarness,
  seed,
  settled,
  testPlatform,
  YEONSU,
} from "./test-support/platform";

/** An agent that looks twice, then answers, with a pause between so the live record can be read mid-run. */
function agent(onMid?: () => Promise<void>) {
  return new ScriptHarness("looker", async (req) => {
    await req.tools.call("list_alarms", {});
    await req.tools.call("get_impact", { id: "crah-1" });
    await onMid?.();
    await req.tools.call("submit_diagnosis", {
      rootCause: "crah-1",
      faultType: "cooling_unit_failure",
      summary: "정지",
    });
    return { status: "finished" };
  });
}

describe("a run's record is served as events with two clocks [REQ-083]", () => {
  test("a finished run gives its events, the wall clock on every one, and a window cuts them", async () => {
    const { platform: p } = testPlatform([agent()]);
    const { world, scenario } = await seed(p);
    const e = await p.experiments.create(YEONSU, {
      name: "기록",
      recipe: recipe(world.id, scenario.id, { harnessId: "looker", agentId: "a", runs: 1 }),
    });
    const done = await settled(p, YEONSU, e.experiment.id);
    const id = done.runs[0]?.id as string;
    const all = await p.results.runEvents(id, {});
    expect(all.live).toBe(false);
    expect(all.total).toBe(all.events.length);
    expect(all.events.every((x) => typeof x.real === "string")).toBe(true);
    const tools = all.events.filter((x) => x.kind === "tool");
    expect(tools.map((x) => x.tool)).toEqual(["list_alarms", "get_impact", "submit_diagnosis"]);
    expect(all.origin).toBeLessThan(tools[0]?.t ?? 0);
    expect(all.end).toBeGreaterThanOrEqual(tools[2]?.t ?? 0);
    expect(all.who.harness).toBeTruthy();
    const cut = await p.results.runEvents(id, { from: tools[1]?.t, to: tools[1]?.t });
    expect(cut.events.every((x) => x.t === tools[1]?.t)).toBe(true);
    expect(cut.total).toBe(all.total);
    // The run's stored result carries the same record: the API invents nothing.
    expect((await p.results.run(id)).run.result?.events).toEqual(all.events);
    await expect(p.results.runEvents("r-404", {})).rejects.toBeInstanceOf(NotFoundError);
  });

  test("while the run goes, the live record has what happened so far; afterwards it is forgotten", async () => {
    let live: Awaited<ReturnType<typeof p.results.runEvents>> | undefined;
    const harness = agent(async () => {
      const [run] = await store.listRuns(experimentId);
      live = await p.results.runEvents(run?.id as string, {});
    });
    const { platform: p, store } = testPlatform([harness]);
    const { world, scenario } = await seed(p);
    const e = await p.experiments.create(YEONSU, {
      name: "실시간",
      recipe: recipe(world.id, scenario.id, { harnessId: "looker", agentId: "a", runs: 1 }),
    });
    const experimentId = e.experiment.id;
    await settled(p, YEONSU, experimentId);
    expect(live?.live).toBe(true);
    expect(live?.events.filter((x) => x.kind === "tool").map((x) => x.tool)).toEqual([
      "list_alarms",
      "get_impact",
    ]);
    expect(live?.events.some((x) => x.kind === "world" && x.command.type === "fault.add")).toBe(
      true,
    );
    expect(live?.events.some((x) => x.kind === "score" && x.what === "closed")).toBe(false);
    const [run] = await store.listRuns(experimentId);
    expect(p.logs.get(run?.id as string)).toBeUndefined();
  });
});
