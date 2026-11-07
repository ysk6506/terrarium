/**
 * Whether a scenario can tell a good agent from a bad one (REQ-070, ADR-0067). Three agents that need no model
 * run on every built-in scenario: one that does nothing, one that guesses, one that knows the answer and takes no
 * action. Knowing nothing must score close to nothing, knowing the answer must score clearly more, and a quick
 * wrong answer must not earn points for being quick. The scenarios whose full marks need no action are named, so
 * "this one measures diagnosis, not operation" is a fact written down and not a surprise.
 */
import { ALL_SCENARIO_TEMPLATES, emptyScenario, type ScenarioDoc } from "@terrarium/core/scenario";
import { calibrate, FLOOR_LIMIT, Session } from "@terrarium/core/session";
import { TOOL_NAMES } from "@terrarium/core/tools";
import { type Blueprint, BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { appLab } from "../../packages/core/src/world/test-support/app-lab";
import { gpuLab } from "../../packages/core/src/world/test-support/gpu-lab";
import { networkLab } from "../../packages/core/src/world/test-support/net-lab";
import { campusBlueprint } from "../../packages/core/src/world/test-support/sample-campus";
import { sdnLab } from "../../packages/core/src/world/test-support/sdn-lab";
import { siteBlueprint } from "./site-support";

const WORLDS: ReadonlyArray<{ name: string; blueprint: () => Blueprint }> = [
  { name: "campus", blueprint: campusBlueprint },
  { name: "network", blueprint: networkLab },
  { name: "gpu", blueprint: gpuLab },
  { name: "sdn", blueprint: () => sdnLab({ cloudNative: true }) },
  { name: "app mesh", blueprint: () => appLab({ level: "mesh" }) },
  { name: "app multiregion", blueprint: () => appLab({ level: "multiregion" }) },
  { name: "site warm", blueprint: () => siteBlueprint("warm") },
  { name: "site split", blueprint: () => siteBlueprint("split") },
  { name: "consensus db", blueprint: () => siteBlueprint("raft") },
  { name: "managed db", blueprint: () => siteBlueprint("managed") },
  { name: "geo storage", blueprint: () => siteBlueprint("geo") },
];

const KNOWN_FLOOR: Readonly<Record<string, number>> = { "cooling-failure": 20 };

/** Each built-in scenario in the first test world it can be built for. */
function built() {
  return ALL_SCENARIO_TEMPLATES.map((template) => {
    for (const world of WORLDS) {
      const blueprint = world.blueprint();
      const index = new BlueprintIndex(blueprint);
      if (template.unavailable(index)) continue;
      return { id: template.id, blueprint, scenario: template.build(index, "lab") };
    }
    throw new Error(`no test world fits ${template.id}`);
  });
}

describe("every built-in scenario tells an agent that knows from one that does not [REQ-070] [REQ-007]", () => {
  const cases = built();

  test.each(cases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const calibration = calibrate({ blueprint: c.blueprint, scenario: c.scenario });
    const total = (id: string) => calibration.runs.find((r) => r.id === id)?.total ?? -1;
    // cooling-failure keeps 20 points for "the servers are still alive", which doing nothing also satisfies in the
    // sample campus (a second cooling unit carries the room). The check warns about it; the scenario is not hidden.
    const allowed = KNOWN_FLOOR[c.id] ?? FLOOR_LIMIT;
    expect(total("guess"), "a blind guess").toBeLessThanOrEqual(allowed);
    expect(total("idle"), "doing nothing").toBeLessThanOrEqual(allowed);
    expect(calibration.runs.some((r) => r.id !== "knows" && r.passed)).toBe(false);
    expect(calibration.diagnosisOnly - calibration.floor).toBeGreaterThanOrEqual(30);
  });

  test("the scenarios that give full marks for the answer alone are exactly these (they measure diagnosis, not operation)", () => {
    const diagnosisOnly = cases
      .filter(
        (c) => calibrate({ blueprint: c.blueprint, scenario: c.scenario }).diagnosisOnly >= 100,
      )
      .map((c) => c.id)
      .sort();
    expect(diagnosisOnly).toEqual(["fan-failure-throttle", "plant-loop-down", "sensor-drift"]);
  }, 180_000);
});

describe("a quick wrong answer earns nothing for being quick [REQ-070]", () => {
  test("time and tool budget count as much as the diagnosis was right", () => {
    const c = built().find((s) => s.id === "sensor-drift") as ReturnType<typeof built>[number];
    const run = (rootCause: string, faultType: string) => {
      const session = Session.create({
        blueprint: c.blueprint,
        scenario: c.scenario,
        tools: TOOL_NAMES,
        seed: 1,
      });
      session.start();
      session.call("submit_diagnosis", { rootCause, faultType, summary: "x" });
      return session.finish().score;
    };
    const diagnosis = c.scenario.expectations.find((e) => e.kind === "diagnosis") as Extract<
      ScenarioDoc["expectations"][number],
      { kind: "diagnosis" }
    >;
    const wrong = run("nothing", "disk_failure");
    expect(wrong.total).toBe(0);
    const efficiency = wrong.items.filter(
      (i) => i.kind === "time_limit" || i.kind === "tool_budget",
    );
    expect(efficiency.map((i) => i.points)).toEqual([0, 0]);
    expect(efficiency[0]?.detail).toMatch(/과제를 푼 만큼\(0%\)/);
    // right type, wrong cause: the share of the diagnosis earned (40%) is the share of the efficiency kept
    const half = run("nothing", diagnosis.faultType[0] as string);
    const kept = half.items.filter((i) => i.kind === "time_limit" || i.kind === "tool_budget");
    expect(kept.every((i) => i.points > 0 && i.points < i.max)).toBe(true);
    expect(run(diagnosis.rootCause[0] as string, diagnosis.faultType[0] as string).total).toBe(100);
  });

  test("a sheet with nothing to do is not scaled", () => {
    expect(emptyScenario("e", "w").expectations).toEqual([]);
  });
});
