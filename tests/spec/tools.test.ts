/**
 * Tools on a physically simulated world. The key promise: get_impact never under-reports. Whatever
 * the physics actually breaks after a fault is among the dependents get_impact named beforehand.
 */
import { Catalog } from "@terrarium/core/catalog";
import { createFacades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { dependents, TOOL_NAMES, Toolbox, type ToolContext } from "@terrarium/core/tools";
import { type FaultType, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../packages/core/src/world/test-support/sample";

function boot() {
  const world = World.fromBlueprint(sampleBlueprint(), new Catalog());
  const physics = new Physics(world);
  physics.settle();
  physics.run(600);
  const ctx: ToolContext = { world, facades: createFacades(world), wait: (s) => physics.run(s) };
  return { world, physics, ctx, tools: new Toolbox(TOOL_NAMES) };
}

function inject(world: World, type: FaultType, target: string) {
  world.apply(
    { type: "fault.add", fault: { id: `${type}:${target}`, type, target, params: {} } },
    "scenario",
  );
}

/** Entities that got worse: lost power, or a worse health than before. */
function broken(world: World, before: ReadonlyMap<string, { health: string; powered?: boolean }>) {
  const rank: Record<string, number> = { ok: 0, warning: 1, critical: 2 };
  return world.index
    .all()
    .map((e) => e.id)
    .filter((id) => {
      const was = before.get(id);
      const now = world.stateOf(id) as { health: string; powered?: boolean };
      if (!was) return false;
      return (
        (rank[now.health] ?? 0) > (rank[was.health] ?? 0) ||
        (was.powered === true && now.powered === false)
      );
    });
}

function healthOf(world: World) {
  return new Map(
    world.index
      .all()
      .map((e) => [e.id, { ...(world.stateOf(e.id) as { health: string; powered?: boolean }) }]),
  );
}

describe("tools on a running world [REQ-007] [REQ-005]", () => {
  test("a PDU trip shows up on a server fed by the other PDU, through the shared switch", () => {
    const { world, physics, ctx, tools } = boot();
    inject(world, "breaker_trip", "pdu-a");
    physics.run(20);
    const result = tools.call("list_alarms", { entityId: "srv-b1" }, ctx);
    expect(result.ok).toBe(true);
    expect((result.data as Array<{ code: string }>).map((a) => a.code)).toEqual([
      "link_down.l-network-srv-b1-tor-a-12",
    ]);
    expect(world.stateAs("srv-b1", "server").powered).toBe(true);
  });

  test("resetting a tripped breaker restores power once time passes", () => {
    const { world, ctx, tools } = boot();
    inject(world, "breaker_trip", "pdu-b");
    tools.call("wait", { seconds: 10 }, ctx);
    expect(world.stateAs("srv-b1", "server").powered).toBe(false);
    expect(tools.call("reset_breaker", { id: "pdu-b" }, ctx).ok).toBe(true);
    tools.call("wait", { seconds: 10 }, ctx);
    expect(world.stateAs("srv-b1", "server").powered).toBe(true);
    expect(tools.call("list_alarms", { entityId: "pdu-b" }, ctx).data).toEqual([]);
  });

  test("the Redfish view through the tool reflects a server the physics powered off", () => {
    const { world, ctx, tools } = boot();
    inject(world, "breaker_trip", "pdu-a");
    tools.call("wait", { seconds: 10 }, ctx);
    const response = tools.call(
      "redfish_request",
      { server: "srv-a1", method: "GET", path: "/redfish/v1/Systems" },
      ctx,
    );
    expect(response.data).toMatchObject({ status: 503 });
  });

  const cases: Array<[FaultType, string]> = [
    ["breaker_trip", "pdu-a"],
    ["breaker_trip", "pdu-b"],
    ["breaker_trip", "panel-1"],
    ["cooling_unit_failure", "crah-1"],
    ["cooling_unit_failure", "crah-2"],
    ["switch_failure", "tor-a"],
    ["psu_failure", "srv-a1"],
    ["disk_failure", "stor-b"],
  ];
  test.each(cases)("get_impact never under-reports what %s on %s breaks", (type, target) => {
    const { world, physics, ctx } = boot();
    const predicted = new Set([target, ...dependents(ctx, target)]);
    const before = healthOf(world);
    inject(world, type, target);
    physics.run(1800);
    const surprises = broken(world, before).filter((id) => !predicted.has(id));
    expect(surprises).toEqual([]);
  });

  test("the property is not vacuous: a PDU trip breaks things beyond its own rack", () => {
    const { world, physics } = boot();
    const before = healthOf(world);
    inject(world, "breaker_trip", "pdu-a");
    physics.run(60);
    expect(broken(world, before)).toEqual(
      expect.arrayContaining(["pdu-a", "srv-a1", "tor-a", "srv-b1"]),
    );
  });
});
