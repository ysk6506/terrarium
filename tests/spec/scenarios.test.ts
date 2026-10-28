/**
 * Built-in scenarios must be solvable with the default toolset: by the time the agent is handed the
 * task, something it can see points at the root cause. A scenario nobody could solve measures nothing.
 */
import { Catalog } from "@terrarium/core/catalog";
import { createFacades, stableUuid } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { NO_AGENT, SCENARIO_TEMPLATES, ScenarioRunner } from "@terrarium/core/scenario";
import { DEFAULT_TOOLSET, Toolbox, type ToolContext } from "@terrarium/core/tools";
import { World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../packages/core/src/world/test-support/sample";

function untilAgent(templateId: string) {
  const template = SCENARIO_TEMPLATES.find((t) => t.id === templateId);
  if (!template) throw new Error(templateId);
  const world = World.fromBlueprint(sampleBlueprint(), new Catalog());
  const physics = new Physics(world);
  physics.settle();
  physics.run(600);
  const doc = template.build(world.index, "sample");
  const runner = new ScenarioRunner(doc, world, 1, NO_AGENT);
  runner.start();
  runner.tick();
  for (let i = 0; i < 400 && !runner.agentTask; i++) {
    physics.step(10);
    runner.tick();
  }
  const ctx: ToolContext = { world, facades: createFacades(world) };
  return { doc, ctx, tools: new Toolbox(DEFAULT_TOOLSET), started: runner.agentTask !== undefined };
}

describe("built-in scenarios are solvable [REQ-033] [REQ-007]", () => {
  test.each(SCENARIO_TEMPLATES.map((t) => [t.id]))(
    "%s: the root cause raises an alarm the agent can list",
    (id) => {
      const { doc, ctx, tools, started } = untilAgent(id);
      expect(started).toBe(true);
      const roots = doc.expectations.flatMap((e) => (e.kind === "diagnosis" ? e.rootCause : []));
      const alarms = tools.call("list_alarms", {}, ctx).data as Array<{ entityId: string }>;
      expect(alarms.some((a) => roots.includes(a.entityId))).toBe(true);
    },
  );

  test("a drifting sensor can be told apart from real heat with the default tools", () => {
    const { doc, ctx, tools } = untilAgent("sensor-drift");
    const server = String(doc.nodes.find((n) => n.type === "inject_fault")?.params.target);
    const entity = tools.call("get_entity", { id: server }, ctx).data as {
      state: { inletC: number };
      location: string;
    };
    const rack = entity.location.split(" > ").at(-2) as string;
    const rackInlet = (
      tools.call("get_entity", { id: rack }, ctx).data as { state: { inletC: number } }
    ).state.inletC;
    // The server claims to be hot, while the rack it breathes from is not.
    expect(entity.state.inletC - rackInlet).toBeGreaterThan(8);
  });

  test("a VM CPU spike is visible on the VM itself, not only on its host", () => {
    const { doc, ctx, tools } = untilAgent("vm-cpu-spike-escalation");
    const vm = String(doc.nodes.find((n) => n.id === "spike")?.params.target);
    const alarms = tools.call("list_alarms", { entityId: vm }, ctx).data as Array<{ code: string }>;
    expect(alarms.map((a) => a.code)).toEqual(["vm_cpu_high"]);
    const path = `/suite-api/api/resources/${stableUuid(vm)}/stats/latest`;
    const response = ctx.facades.vrops.handle({ method: "GET", path, query: {}, headers: {} });
    const stats = (response.body as any).values[0]["stat-list"].stat as Array<{
      statKey: { key: string };
      data: number[];
    }>;
    expect(stats.find((s) => s.statKey.key === "cpu|usage_average")?.data[0]).toBe(100);
  });
});
