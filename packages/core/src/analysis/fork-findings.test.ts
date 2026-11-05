import { forkExperiment } from "@terrarium/core/experiments";
import { describe, expect, test } from "vitest";
import { analyzeExperiment } from ".";
import { experimentOf, SCRIPTS } from "./test-support/runs";

describe("a fork that does worse than its parent [REQ-040]", () => {
  test("both differences carry their sign, so a loss never reads as a gain", () => {
    const parentInput = experimentOf({
      id: "p",
      runs: [SCRIPTS.good, SCRIPTS.good, SCRIPTS.good],
      tools: ["list_alarms", "get_entity"],
    });
    const child = forkExperiment(
      parentInput.experiment,
      { agentId: "guess" },
      { id: "c", owner: "jimin", createdAt: "2026-10-30T00:00:00.000Z" },
      parentInput.experiment.snapshot,
    );
    const childInput = experimentOf({
      id: "c",
      runs: [SCRIPTS.wrong, SCRIPTS.wrong, SCRIPTS.wrong],
      agentId: "guess",
      tools: child.recipe.tools,
      parentId: "p",
    });
    const a = analyzeExperiment(childInput, analyzeExperiment(parentInput));
    expect(a.parent?.scoreDelta).toBeLessThan(0);
    expect(a.parent?.passRateDelta).toBe(-1);
    const finding = a.findings.at(-1) as string;
    expect(finding).toMatch(/평균 -\d+(\.\d+)?점, 합격률 -100%p/);
    expect(finding).not.toContain("+");
    expect(finding).toContain("분명한 차이예요");
  });
});
