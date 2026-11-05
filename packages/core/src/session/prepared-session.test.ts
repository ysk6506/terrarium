import { Catalog } from "@terrarium/core/catalog";
import { SCENARIO_TEMPLATES } from "@terrarium/core/scenario";
import { DEFAULT_TOOLSET } from "@terrarium/core/tools";
import { BlueprintIndex, prepareWorld } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../world/test-support/sample";
import { Session, type SessionConfig, WarmStartCache } from ".";

const blueprint = sampleBlueprint();
const scenario = (
  SCENARIO_TEMPLATES.find((t) => t.id === "cooling-failure") as never as {
    build(i: BlueprintIndex, w: string): never;
  }
).build(new BlueprintIndex(blueprint), "sample");

const base: SessionConfig = { blueprint, scenario, tools: DEFAULT_TOOLSET, seed: 7 };

function play(config: SessionConfig) {
  const s = Session.create(config);
  const task = s.start();
  const answers = [s.call("list_alarms", {}), s.call("wait", { seconds: 90 })];
  return { task, answers, result: s.finish("agent_finished"), index: s.world.index };
}

describe("sessions on a prepared world [REQ-032] [REQ-001]", () => {
  test("a session on a prepared world plays exactly like one that prepared its own", () => {
    const prepared = prepareWorld(blueprint, new Catalog());
    const own = play(base);
    const shared = play({ ...base, prepared });
    expect({ ...shared, index: 0 }).toEqual({ ...own, index: 0 });
  });

  test("sessions share the prepared index, and the warm start is found by its digest", () => {
    const prepared = prepareWorld(blueprint, new Catalog());
    const warm = new WarmStartCache();
    const first = play({ ...base, prepared, warm });
    const second = play({ ...base, prepared, warm, seed: 8 });
    expect(first.index).toBe(prepared.index);
    expect(second.index).toBe(prepared.index);
    expect([warm.misses, warm.hits]).toEqual([1, 1]);
    // The same world reached by the other road finds the same warm start.
    play({ ...base, warm });
    expect(warm.hits).toBe(2);
  });
});
