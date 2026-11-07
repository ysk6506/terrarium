/**
 * The application layer (REQ-100, ADR-0121): calls between services, the balancer, the session store, the breakers, the mesh
 * and the regions: what each fault does to health, and what the system does about it by itself.
 */
import { Catalog } from "@terrarium/core/catalog";
import type { Facades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { TOOL_NAMES, Toolbox } from "@terrarium/core/tools";
import { type FaultType, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { type AppLabOptions, appLab } from "../../packages/core/src/world/test-support/app-lab";

function lab(options: AppLabOptions = {}) {
  const world = World.fromBlueprint(appLab(options), new Catalog());
  const physics = new Physics(world);
  physics.settle();
  physics.run(300);
  const box = new Toolbox(TOOL_NAMES);
  const ctx = { world, facades: {} as Facades };
  const raw = (tool: string, args: Record<string, unknown>) => box.call(tool, args, ctx);
  const inject = (type: FaultType, target: string, params: Record<string, number> = {}) =>
    world.apply(
      { type: "fault.add", fault: { id: `f-${type}-${target}`, type, target, params } },
      "scenario",
    );
  const status = (id: string) => world.stateAs(id, "service").status;
  return { world, physics, raw, inject, status };
}

describe("a healthy application layer [REQ-100]", () => {
  test("every level starts healthy", () => {
    for (const level of ["lb", "stateless", "microservices", "mesh", "multiregion"] as const) {
      const { status } = lab({ level });
      expect(status("svc-portal"), level).toBe("healthy");
      expect(status("svc-license"), level).toBe("healthy");
    }
  });
});

describe("a call down the graph [REQ-100]", () => {
  test("a stopped critical callee stops the caller; a breaker keeps it degraded and it recovers", () => {
    const plain = lab({ level: "stateless" });
    plain.inject("process_crashloop", "srv-a2");
    plain.physics.run(60);
    expect(plain.status("svc-portal")).toBe("down");

    const guarded = lab({ level: "microservices" });
    guarded.inject("process_crashloop", "srv-a2");
    guarded.physics.run(120);
    expect(guarded.status("svc-portal")).toBe("degraded");
    guarded.world.apply(
      { type: "fault.remove", faultId: "f-process_crashloop-srv-a2" } as never,
      "scenario",
    );
    guarded.physics.run(300);
    expect(guarded.status("svc-portal")).toBe("healthy");
  });
});
