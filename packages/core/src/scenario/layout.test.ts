import { BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../world/test-support/sample";
import { SCENARIO_TEMPLATES } from ".";

describe("built-in scenarios are drawn the way the editor draws [REQ-034]", () => {
  test("the main line runs top to bottom, one block under the other", () => {
    const index = new BlueprintIndex(sampleBlueprint());
    const t = SCENARIO_TEMPLATES.find((x) => !x.unavailable(index));
    expect(t).toBeDefined();
    const doc = t?.build(index, "w");
    const ys = (doc?.nodes ?? []).map((n) => n.position.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(new Set(ys).size).toBe(ys.length);
    expect((doc?.nodes ?? []).every((n) => n.position.x >= 0)).toBe(true);
  });
});
