import type { ActivityEvent } from "@terrarium/core/contract";
import { TOOL_SPECS, toolsForDomains } from "@terrarium/core/tools";
import type { Domain } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { serviceLab } from "../../../../packages/core/src/world/test-support/service-lab";
import { HANEUL, recipe, ScriptHarness, settled, testPlatform } from "./test-support/platform";

const AGENTS = [{ id: "a", name: "운영 에이전트" }];
const MINE: Domain[] = ["service_os", "virtualization"];

async function play(extra: Record<string, unknown>) {
  const harness = new ScriptHarness(
    "h",
    async (req) => {
      await req.tools.call("escalate", { domain: "server" });
      await req.tools.call("migrate_vm", { vm: "vm-db", host: "srv-b1" });
      for (let i = 0; i < 80; i++) await req.tools.call("wait", { seconds: 3600 });
      await req.tools.call("submit_diagnosis", {
        rootCause: "srv-a2",
        faultType: "memory_failure",
        summary: "메모리 불량",
      });
      return { status: "finished" };
    },
    AGENTS,
  );
  const t = testPlatform([harness]);
  const { world } = await t.platform.worlds.create(HANEUL, {
    name: "서비스 홀",
    blueprint: serviceLab(),
  });
  const { scenario } = await t.platform.scenarios.create(HANEUL, {
    worldId: world.id,
    templateId: "domain-memory-vendor",
  });
  const seen: ActivityEvent[] = [];
  t.platform.events.subscribeWorld(world.id, (e) => seen.push(e));
  const created = await t.platform.experiments.create(HANEUL, {
    name: "메모리 불량",
    recipe: recipe(world.id, scenario.id, {
      harnessId: "h",
      agentId: "a",
      runs: 1,
      tools: toolsForDomains(MINE, TOOL_SPECS),
      domains: MINE,
      ...extra,
    }),
  });
  const view = await settled(t.platform, HANEUL, created.experiment.id);
  return { t, seen, view, created };
}

describe("another team's work reaches the world's live view, and the experiment keeps its domains [REQ-093]", () => {
  test("the live stream says when an engineer starts on a machine and when the work is done", async () => {
    const { seen } = await play({});
    const partner = seen.filter((e) => e.type === "partner");
    expect(partner.map((e) => (e.type === "partner" ? e.what : ""))).toEqual(["started", "done"]);
    expect(partner[0]).toMatchObject({
      device: "srv-a2",
      who: "vendor",
      replacing: true,
      onSite: true,
      team: "벤더",
    });
  });

  test("the recipe keeps the domains and the waits, the run keeps what it had, and they are part of the benchmark key", async () => {
    const plain = await play({});
    const slow = await play({ leadTimes: { spares: "no", vendorSla: "3d" } });
    const recipeOf = (p: typeof plain) => p.created.experiment.recipe;
    expect(recipeOf(plain).domains).toEqual(MINE);
    expect(recipeOf(slow).leadTimes).toEqual({ spares: "no", vendorSla: "3d" });
    expect(plain.created.experiment.benchmarkKey).not.toBe(slow.created.experiment.benchmarkKey);
    const run = await plain.t.platform.results.run(plain.view.runs[0]?.id as string);
    expect(run.run.result?.scope).toMatchObject({ domains: MINE, leadTimesLabel: "기본값" });
    expect(run.run.result?.score.handoff).toMatchObject({ count: 1, faults: 1 });
  });
});
