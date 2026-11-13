import { createHash } from "node:crypto";
import { benchmarkKey } from "@terrarium/core/experiments";
import { SCENARIO_TEMPLATES } from "@terrarium/core/scenario";
import { DEFAULT_OPERATION, Session } from "@terrarium/core/session";
import { TOOL_NAMES } from "@terrarium/core/tools";
import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../packages/core/src/world/test-support/sample";

/**
 * What an experiment with no level and no rules is must not move (REQ-123, REQ-125, ADR-0199): the values below were
 * taken from the code before the gate and the rules existed (same world, scenario, seed 7, the same calls, all tools),
 * and change only through the test-lock amend procedure with a decision that explains the new bytes.
 */
const PINNED = {
  result: "8362efe88dcecb3a",
  score: "fd073973c3d972ff",
  events: "3309d0c51667c632",
  toolCalls: "733a1ffe284e9370",
  digests: "9ee4de10e4e67444",
  timeline: "1e975f0b6f8ca6da",
  keys: {
    plain: "0b381fb92209cd1c",
    inside: "013cbaba50d32a0b",
    domains: "0de1371dab1ca619",
    operation: "1b9b08044503901c",
  },
};

const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);

function played(extra: Partial<Parameters<typeof Session.create>[0]> = {}) {
  const template = SCENARIO_TEMPLATES.find((t) => t.id === "cooling-failure");
  if (!template) throw new Error("cooling-failure template");
  const scenario = template.build(new BlueprintIndex(sampleBlueprint()), "sample");
  const s = Session.create({
    blueprint: sampleBlueprint(),
    scenario,
    tools: TOOL_NAMES,
    seed: 7,
    ...extra,
  });
  s.start();
  s.call("list_alarms", {});
  s.call("get_impact", { id: "crah-1" });
  s.call("restart_cooling_unit", { unitId: "crah-1" });
  s.call("run_command", { host: "srv-a1", cmd: "df -h" });
  s.call("wait", { seconds: 60 });
  s.call("submit_diagnosis", {
    rootCause: "crah-1",
    faultType: "cooling_unit_failure",
    summary: "x",
  });
  return s.finish();
}

const SNAPSHOT = {
  worldDigest: "w",
  worldName: "n",
  scenarioDigest: "s",
  scenarioName: "n",
  oracle: "3",
};
const BASE = { time: { kind: "lockstep", secondsPerCall: 30 } as const, profiles: {} };

describe("an experiment that chose no level and no rules is what it always was [REQ-123] [REQ-125]", () => {
  test("[REQ-123] [REQ-125] the run's result, score breakdown, record and digests are the same bytes as before", () => {
    const r = played();
    expect({
      result: hash(r),
      score: hash(r.score),
      events: hash(r.events),
      toolCalls: hash(r.toolCalls),
      digests: hash(r.digests),
      timeline: hash(r.timeline),
    }).toEqual({
      result: PINNED.result,
      score: PINNED.score,
      events: PINNED.events,
      toolCalls: PINNED.toolCalls,
      digests: PINNED.digests,
      timeline: PINNED.timeline,
    });
    expect(r.trust).toBeUndefined();
  });

  test("[REQ-123] saying 'act by itself' and picking no rules is the same as saying nothing", () => {
    const said = played({ permission: "act", rules: [] });
    expect(hash(said)).toBe(PINNED.result);
  });

  test("[REQ-123] the benchmark key of a recipe that chose no level is the key it had before", () => {
    expect({
      plain: benchmarkKey(SNAPSHOT, BASE),
      inside: benchmarkKey(SNAPSHOT, { ...BASE, faultScope: "inside" }),
      domains: benchmarkKey(SNAPSHOT, { ...BASE, domains: ["network", "server"] }),
      operation: benchmarkKey(SNAPSHOT, { ...BASE, operation: DEFAULT_OPERATION }),
    }).toEqual(PINNED.keys);
    expect(benchmarkKey(SNAPSHOT, { ...BASE, permission: "act" })).toBe(PINNED.keys.plain);
  });

  test("[REQ-123] a level other than the default is another task: it is in the key; the rules are not", () => {
    expect(benchmarkKey(SNAPSHOT, { ...BASE, permission: "view" })).not.toBe(PINNED.keys.plain);
    // the rules only count what the agent did, like the runbook and the tools: same task, same set
    const withRules = { ...BASE, rules: ["look_first", "no_harm"] };
    expect(benchmarkKey(SNAPSHOT, withRules)).toBe(PINNED.keys.plain);
  });
});
