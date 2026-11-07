/** A live world of a REQ-106 lab with the tools, for the physics tests of the site and DR layer and the two new databases. */
import { Catalog } from "@terrarium/core/catalog";
import type { Facades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { TOOL_NAMES, Toolbox } from "@terrarium/core/tools";
import { type FaultType, World } from "@terrarium/core/world";
import { type SiteWorld, siteBlueprint } from "./site-support";

export function siteLab(kind: SiteWorld) {
  const world = World.fromBlueprint(siteBlueprint(kind), new Catalog());
  const physics = new Physics(world);
  physics.settle();
  physics.run(300);
  const box = new Toolbox(TOOL_NAMES);
  const ctx = { world, facades: {} as Facades };
  const call = (tool: string, args: Record<string, unknown> = {}) => box.call(tool, args, ctx);
  const inject = (type: FaultType, target: string, params: Record<string, number> = {}) =>
    world.apply(
      { type: "fault.add", fault: { id: `f-${type}`, type, target, params } },
      "scenario",
    );
  const clear = (type: FaultType) =>
    world.apply({ type: "fault.remove", faultId: `f-${type}` }, "scenario");
  const status = (id: string) => world.stateAs(id, "service").status;
  const plan = () => world.stateAs("dr-plan", "dr_plan");
  /** Seconds until every service is healthy, looked at every ten seconds; undefined when it never is within `max`. */
  const healthyAfter = (max: number): number | undefined => {
    for (let t = 0; t <= max; t += 10) {
      if (["svc-iap", "svc-svc2"].every((s) => status(s) === "healthy")) return t;
      physics.run(10);
    }
    return undefined;
  };
  const causesOf = (type: string): string[] =>
    world
      .events()
      .filter((e) => e.type === type)
      .map((e) => (e as { cause?: string }).cause ?? "");
  return { world, physics, call, inject, clear, status, plan, healthyAfter, causesOf };
}
