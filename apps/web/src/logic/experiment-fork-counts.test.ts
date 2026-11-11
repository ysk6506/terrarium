import { type Experiment, normalizeTools } from "@terrarium/core/experiments";
import { describe, expect, test } from "vitest";
import { experiment as ex } from ".";

const base: Experiment = {
  id: "e-1",
  name: "기준선",
  owner: "yeonsu",
  createdAt: "2026-10-29T00:00:00Z",
  recipe: {
    worldId: "w-1",
    scenarioId: "s-1",
    harnessId: "ops",
    agentId: "triage",
    tools: normalizeTools(["get_impact", "list_alarms"]),
    seeds: Array.from({ length: 20 }, (_, i) => i + 1),
    time: { kind: "lockstep", secondsPerCall: 30 },
    profiles: {},
  },
  snapshot: {
    worldDigest: "d",
    worldName: "홀",
    scenarioDigest: "s",
    scenarioName: "냉방",
    oracle: "1",
  },
  benchmarkKey: "k",
};

describe("a fork keeps how many situations and how many repeats the original ran [REQ-118]", () => {
  test("the form starts at the original's counts, and one repeat when the original had none", () => {
    expect(ex.draftFrom(base)).toMatchObject({ runs: 20, repeats: 1 });
    const repeated = { ...base, recipe: { ...base.recipe, repeats: 3 } };
    expect(ex.draftFrom(repeated)).toMatchObject({ runs: 20, repeats: 3 });
    expect(ex.runCount(ex.draftFrom(base))).toBe(20);
  });

  test("changing only the agent leaves both counts out of the request, so the fork keeps them", () => {
    const draft = { ...ex.draftFrom(base), agentId: "guess" };
    expect(ex.toForkRequest(base, draft).change).toEqual({ agentId: "guess" });
  });
});
