import { benchmarkKey, physicsOf } from "@terrarium/core/experiments";
import { describe, expect, test } from "vitest";
import { analyzeExperiment, buildLeaderboards } from ".";
import { experimentOf, SCRIPTS, snapshotFor } from "./test-support/runs";

const base = snapshotFor();
const hot = { ...base, physics: "v1+0123456789ab" };
const THREE = [SCRIPTS.good, SCRIPTS.good, SCRIPTS.good];

const analysed = (id: string, snapshot = base, extra: { parentId?: string } = {}) =>
  analyzeExperiment(experimentOf({ id, runs: THREE, ...extra }, snapshot));

describe("only runs on the same physics are ranked together [REQ-113]", () => {
  test("another physics is another benchmark set, even for the same world, scenario and agent", () => {
    const recipe = experimentOf({ id: "k", runs: [] }).experiment.recipe;
    expect(benchmarkKey(hot, recipe)).not.toBe(benchmarkKey(base, recipe));
  });

  test("a snapshot that says v1 or says nothing gives the same key as before the fingerprint existed", () => {
    const recipe = experimentOf({ id: "k", runs: [] }).experiment.recipe;
    expect(benchmarkKey({ ...base, physics: "v1" }, recipe)).toBe(benchmarkKey(base, recipe));
    expect(physicsOf({ snapshot: base })).toBe("v1");
  });

  test("two experiments on different physics make two boards and do not pool their runs", () => {
    const boards = buildLeaderboards([analysed("a"), analysed("b", hot)], 1);
    expect(boards).toHaveLength(2);
    expect(boards.map((b) => b.physics).sort()).toEqual(["v1", "v1+0123456789ab"]);
    for (const b of boards) expect(b.rows.map((r) => r.runs)).toEqual([3]);
  });

  test("even when two sets carry the same benchmark key, a different fingerprint keeps them apart", () => {
    const a = analysed("a");
    const sameKey = {
      ...a,
      experiment: {
        ...a.experiment,
        id: "c",
        snapshot: { ...a.experiment.snapshot, physics: "v1+aaaaaaaaaaaa" },
      },
    };
    const boards = buildLeaderboards([a, sameKey], 1);
    expect(boards).toHaveLength(2);
    expect(new Set(boards.map((b) => b.benchmarkKey)).size).toBe(1);
    expect(new Set(boards.map((b) => b.physics)).size).toBe(2);
  });

  test("a fork on other physics than its original is not compared by score; on the same physics it is", () => {
    const parent = analysed("p");
    const other = analyzeExperiment(
      experimentOf({ id: "f", parentId: "p", agentId: "deep", runs: THREE }, hot),
      parent,
    );
    expect(other.parent).toMatchObject({ otherPhysics: "v1", passRateDelta: 0, clear: false });
    expect(other.parent?.scoreDelta).toBeUndefined();
    expect(other.findings.at(-1)).toContain("물리가 달라요(v1)");
    const same = analyzeExperiment(
      experimentOf({ id: "g", parentId: "p", agentId: "deep", runs: THREE }),
      parent,
    );
    expect(same.parent?.otherPhysics).toBeUndefined();
    expect(same.parent?.scoreDelta).toBeDefined();
  });
});
