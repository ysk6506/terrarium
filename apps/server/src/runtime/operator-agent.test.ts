import { TOOL_SPECS, toolsForDomains } from "@terrarium/core/tools";
import type { Domain } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { serviceLab } from "../../../../packages/core/src/world/test-support/service-lab";
import { HANEUL, recipe, settled, testPlatform } from "./test-support/platform";

const MINE: Domain[] = ["service_os", "virtualization"];

async function play(templateId: string) {
  const t = testPlatform();
  const { world } = await t.platform.worlds.create(HANEUL, {
    name: "서비스 홀",
    blueprint: serviceLab(),
  });
  const { scenario } = await t.platform.scenarios.create(HANEUL, { worldId: world.id, templateId });
  const created = await t.platform.experiments.create(HANEUL, {
    name: "운영 기준 에이전트",
    recipe: recipe(world.id, scenario.id, {
      agentId: "operator",
      runs: 1,
      tools: toolsForDomains(MINE, TOOL_SPECS),
      domains: MINE,
    }),
  });
  const view = await settled(t.platform, HANEUL, created.experiment.id);
  const run = await t.platform.results.run(view.runs[0]?.id as string);
  return run.run.result;
}

describe("the built-in operator keeps services alive, hands the cause to its team and puts back what it moved [REQ-093]", () => {
  test("bad memory in a server: the VM is moved at once, the server team is handed the cause, the move is undone", async () => {
    const result = await play("domain-memory-vendor");
    expect(result?.score.handoff).toMatchObject({ count: 1, faults: 1, needless: 0 });
    const row = result?.score.handoff?.rows[0];
    expect(row?.bridge.savedAfterSeconds).toBeLessThan(15 * 60);
    expect(row?.cleanup.needed).toBeGreaterThan(0);
    expect(row?.cleanup.done).toBe(row?.cleanup.needed);
    expect(result?.score.recovery?.agentSeconds).toBeLessThan(15 * 60);
    expect(result?.score.items.find((i) => i.kind === "diagnosis")?.verdict).toBe("pass");
  });

  test("a port that does not answer: the service is failed over and the network team is handed the cause", async () => {
    const result = await play("domain-port-network");
    expect(result?.score.handoff).toMatchObject({ count: 1, faults: 1 });
    expect(result?.score.handoff?.rows[0]?.team).toBe("네트워크 팀");
    expect(result?.score.recovery?.recovered).toBe(true);
  });
});
