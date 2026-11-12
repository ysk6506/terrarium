import { NotFoundError } from "@terrarium/core/kernel";
import { describe, expect, test } from "vitest";
import { HANEUL, recipe, seed, settled, testPlatform } from "./test-support/platform";

describe("a run shows the world as it was when the experiment was made [REQ-037]", () => {
  test("the world view carries the version the experiment recorded, with the name and digest, and a run that is not there is not found", async () => {
    const { platform: p } = testPlatform();
    const { world, scenario } = await seed(p);
    const e = await p.experiments.create(HANEUL, {
      name: "세계",
      recipe: recipe(world.id, scenario.id, { runs: 1 }),
    });
    const done = await settled(p, HANEUL, e.experiment.id);
    const runId = done.runs[0]?.id as string;
    const view = await p.results.runWorld(runId);
    expect(view.worldId).toBe(world.id);
    expect(view.name).toBe(world.name);
    expect(view.digest).toBe(e.experiment.snapshot.worldDigest);
    expect(view.blueprint.entities.length).toBeGreaterThan(0);
    await expect(p.results.runWorld("r-404")).rejects.toBeInstanceOf(NotFoundError);
  });
});
