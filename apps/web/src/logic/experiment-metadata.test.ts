import { type Experiment, normalizeTools } from "@terrarium/core/experiments";
import { describe, expect, test } from "vitest";
import { experiment as ex } from ".";

const parent: Experiment = {
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
    seeds: [1, 2, 3],
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
  metadata: { team: "검색", prompt: "v2" },
};

const ready = (over: Partial<ex.Draft> = {}): ex.Draft => ({
  ...ex.emptyDraft(),
  worldId: "w-1",
  scenarioId: "s-1",
  harnessId: "ops",
  agentId: "triage",
  ...over,
});

describe("what is attached to an experiment to tell results apart [REQ-052]", () => {
  test("a new experiment sends its metadata only when there is some, rows without a name dropped", () => {
    expect(ex.toRequest(ready(), "x")).not.toHaveProperty("metadata");
    const rows = [
      { key: " team ", value: " 검색 " },
      { key: "", value: "버려진다" },
    ];
    expect(ex.toRequest(ready({ metadata: rows }), "x").metadata).toEqual({ team: "검색" });
  });

  test("a fork starts with the parent's metadata and sends it only when it was changed", () => {
    const draft = ex.draftFrom(parent);
    expect(draft.metadata).toEqual([
      { key: "team", value: "검색" },
      { key: "prompt", value: "v2" },
    ]);
    const changed = { ...draft, agentId: "guess" };
    expect(ex.toForkRequest(parent, changed)).not.toHaveProperty("metadata");

    const edited = {
      ...changed,
      metadata: [
        { key: "team", value: "검색" },
        { key: "prompt", value: "v3" },
      ],
    };
    expect(ex.toForkRequest(parent, edited).metadata).toEqual({ team: "검색", prompt: "v3" });
    expect(ex.toForkRequest(parent, { ...changed, metadata: [] }).metadata).toEqual({});
  });

  test("a parent with no metadata gives an empty list, and a fork that adds some sends it", () => {
    const { metadata: _drop, ...bare } = parent;
    const draft = ex.draftFrom(bare);
    expect(draft.metadata).toEqual([]);
    const request = ex.toForkRequest(bare, {
      ...draft,
      agentId: "guess",
      metadata: [{ key: "team", value: "인프라" }],
    });
    expect(request.metadata).toEqual({ team: "인프라" });
  });
});
