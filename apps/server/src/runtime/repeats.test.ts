import type { RunRecord } from "@terrarium/core/experiments";
import { MAX_RUNS } from "@terrarium/core/experiments";
import { describe, expect, test } from "vitest";
import {
  recipe,
  ScriptHarness,
  seed,
  settled,
  testPlatform,
  until,
  untilStopped,
  YEONSU,
} from "./test-support/platform";

/**
 * Everything a run recorded, as bytes: the score breakdown, every tool call with its answer, the timeline, the
 * events and the series. Only the wall-clock stamp of each event (`real`, the second of the two clocks, REQ-083)
 * is left out: it says when the run was played, not what happened in it.
 */
const bytesOf = (run: RunRecord) =>
  JSON.stringify(run.result, (key, value) => (key === "real" ? undefined : value));

describe("repeats of a seed [REQ-118]", () => {
  test("a built-in agent repeated on a seed does the same thing to the byte; the seed decides the world", async () => {
    const { platform: p, store } = testPlatform();
    const { world, scenario } = await seed(p);
    for (const agentId of ["triage", "guess"]) {
      const made = await p.experiments.create(YEONSU, {
        name: `반복 ${agentId}`,
        recipe: recipe(world.id, scenario.id, { agentId, seeds: [1, 2], repeats: 3 }),
      });
      const done = await settled(p, YEONSU, made.experiment.id);
      expect(done.progress).toMatchObject({ total: 6, completed: 6 });
      const runs = await store.listRuns(made.experiment.id);
      for (const s of [1, 2]) {
        const ofSeed = runs.filter((r) => r.seed === s);
        expect(ofSeed.map((r) => r.repeat)).toEqual([1, 2, 3]);
        const [first, ...rest] = ofSeed.map(bytesOf);
        expect(first?.length).toBeGreaterThan(200);
        for (const again of rest) expect(again).toBe(first);
      }
    }
  });

  test("an experiment makes its runs a round at a time, and says how it was made", async () => {
    const { platform: p } = testPlatform();
    const { world, scenario } = await seed(p);
    const made = await p.experiments.create(YEONSU, {
      name: "세 번씩",
      recipe: recipe(world.id, scenario.id, { seeds: [4, 7], repeats: 3 }),
    });
    expect(made.experiment.recipe.repeats).toBe(3);
    expect(made.runs.map((r) => [r.index, r.seed, r.repeat])).toEqual([
      [0, 4, 1],
      [1, 7, 1],
      [2, 4, 2],
      [3, 7, 2],
      [4, 4, 3],
      [5, 7, 3],
    ]);
    // once is the default and leaves the recipe as it always was
    const once = await p.experiments.create(YEONSU, {
      name: "한 번씩",
      recipe: recipe(world.id, scenario.id, { runs: 2 }),
    });
    expect(once.experiment.recipe).not.toHaveProperty("repeats");
    expect(once.runs.map((r) => r.repeat)).toEqual([1, 1]);
  });

  test("the harness is told which run of the seed it is, and the seed stays the same", async () => {
    const slow = new ScriptHarness("slow", untilStopped);
    const { platform: p } = testPlatform([slow], { limits: { maxRunning: 6 } });
    const { world, scenario } = await seed(p);
    const made = await p.experiments.create(YEONSU, {
      name: "알려 주기",
      recipe: recipe(world.id, scenario.id, {
        harnessId: "slow",
        agentId: "a",
        seeds: [5],
        repeats: 3,
      }),
    });
    await until(() => slow.requests.length === 3);
    expect(slow.requests.map((r) => [r.seed, r.repeat]).sort()).toEqual([
      [5, 1],
      [5, 2],
      [5, 3],
    ]);
    await p.experiments.cancel(YEONSU, made.experiment.id);
  });

  test("adding a repeat gives every seed one more run; adding seeds gives them the repeats it has now", async () => {
    const { platform: p } = testPlatform();
    const { world, scenario } = await seed(p);
    const made = await p.experiments.create(YEONSU, {
      name: "더하기",
      recipe: recipe(world.id, scenario.id, { seeds: [1, 2], repeats: 2 }),
    });
    await settled(p, YEONSU, made.experiment.id);
    const again = await p.experiments.addRuns(YEONSU, made.experiment.id, { repeats: 1 });
    expect(again.experiment.recipe).toMatchObject({ seeds: [1, 2], repeats: 3 });
    expect(again.runs.slice(4).map((r) => [r.index, r.seed, r.repeat])).toEqual([
      [4, 1, 3],
      [5, 2, 3],
    ]);
    const wider = await p.experiments.addRuns(YEONSU, made.experiment.id, { seeds: [9] });
    expect(wider.experiment.recipe).toMatchObject({ seeds: [1, 2, 9], repeats: 3 });
    expect(wider.runs.slice(6).map((r) => [r.index, r.seed, r.repeat])).toEqual([
      [6, 9, 1],
      [7, 9, 2],
      [8, 9, 3],
    ]);
    // a seed that is already there is still refused, repeats or not
    await expect(
      p.experiments.addRuns(YEONSU, made.experiment.id, { seeds: [1] }),
    ).rejects.toMatchObject({ issues: [{ path: "seeds", message: "상황 1번은 이미 있어요" }] });
    expect((await settled(p, YEONSU, made.experiment.id)).progress.completed).toBe(9);
  });

  test("the runs of an experiment, seeds times repeats, have a limit that is said before anything is queued", async () => {
    const { platform: p, store } = testPlatform();
    const { world, scenario } = await seed(p);
    expect(MAX_RUNS).toBe(60);
    const make = (extra: Record<string, unknown>) =>
      p.experiments.create(YEONSU, { name: "많이", recipe: recipe(world.id, scenario.id, extra) });
    await expect(make({ runs: 20, repeats: 4 })).rejects.toMatchObject({
      issues: [{ message: "실행은 한 실험에 60번까지예요 (상황 20개 × 4번씩 = 80번)" }],
    });
    expect(await store.listExperiments()).toEqual([]);
    const ok = await make({ seeds: [1], repeats: 2 });
    await settled(p, YEONSU, ok.experiment.id);
    await expect(
      p.experiments.addRuns(YEONSU, ok.experiment.id, { repeats: 10 }),
    ).rejects.toMatchObject({
      issues: [{ message: "같은 상황은 1~10번씩 돌릴 수 있어요" }],
    });
  });
});
