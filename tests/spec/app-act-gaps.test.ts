/**
 * What the world refuses to do to the application layer, and why (REQ-100): a command that makes no sense is turned back
 * before it is recorded, with the reason in words, whoever sends it. The tools check some of this first; these go to the
 * world itself.
 */
import { Catalog } from "@terrarium/core/catalog";
import { Physics } from "@terrarium/core/physics";
import { type FaultType, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { type AppLabOptions, appLab } from "../../packages/core/src/world/test-support/app-lab";

function boot(options: AppLabOptions) {
  const world = World.fromBlueprint(appLab(options), new Catalog());
  const physics = new Physics(world);
  physics.settle();
  physics.run(300);
  const inject = (type: FaultType, target: string) =>
    world.apply(
      { type: "fault.add", fault: { id: `f-${type}-${target}`, type, target, params: {} } },
      "scenario",
    );
  return { world, physics, inject };
}

describe("a backend is drained and put back only when that changes something [REQ-100]", () => {
  test("[REQ-100] only an application instance can be drained, not twice, and only a drained one is put back", () => {
    const { world } = boot({ level: "lb" });
    expect(() => world.apply({ type: "lb.drain", target: "vm-web" }, "operator")).toThrow(
      "'vm-web'는 애플리케이션 인스턴스이 아니에요",
    );
    expect(() => world.apply({ type: "lb.enable", target: "app-portal-1" }, "operator")).toThrow(
      "'app-portal-1'는 빠져 있지 않아요(drain한 적이 없어요)",
    );
    world.apply({ type: "lb.drain", target: "app-portal-1" }, "operator");
    expect(() => world.apply({ type: "lb.drain", target: "app-portal-1" }, "operator")).toThrow(
      "'app-portal-1'는 이미 로테이션에서 빠져 있어요",
    );
    world.apply({ type: "lb.enable", target: "app-portal-1" }, "operator");
    expect(world.stateAs("app-portal-1", "app_instance").drained).toBe(false);
  });
});

describe("a breaker, the mesh and a region refuse what changes nothing [REQ-100]", () => {
  test("[REQ-100] a breaker that is closed and not held is not reset, and what is not a breaker is turned away", () => {
    const { world } = boot({ level: "microservices" });
    expect(() => world.apply({ type: "circuit.reset", target: "vm-web" }, "operator")).toThrow(
      "'vm-web'는 서킷 브레이커이 아니에요",
    );
    expect(() =>
      world.apply({ type: "circuit.reset", target: "cb-portal-license" }, "operator"),
    ).toThrow("'cb-portal-license'는 이미 닫혀 있어요");
  });

  test("[REQ-100] a mesh that is on its first configuration has nothing to go back to", () => {
    const { world } = boot({ level: "mesh" });
    expect(() => world.apply({ type: "mesh.rollback", target: "vm-web" }, "operator")).toThrow(
      "'vm-web'는 메시 컨트롤 플레인이 아니에요",
    );
    expect(() =>
      world.apply({ type: "mesh.rollback", target: "mesh-control" }, "operator"),
    ).toThrow("'mesh-control'는 되돌릴 새 설정이 없어요(지금 설정이 처음 그대로예요)");
  });

  test("[REQ-100] traffic is sent to a region that is up, and not again once it all goes there", () => {
    const { world, inject, physics } = boot({ level: "multiregion" });
    expect(() => world.apply({ type: "region.failover", target: "vm-web" }, "operator")).toThrow(
      "'vm-web'는 리전이 아니에요",
    );
    inject("region_down", "region-b");
    physics.run(60);
    expect(() => world.apply({ type: "region.failover", target: "region-b" }, "operator")).toThrow(
      "'region-b'는 멈춰 있어서 트래픽을 받을 수 없어요",
    );
    world.apply({ type: "region.failover", target: "region-a" }, "operator");
    expect(() => world.apply({ type: "region.failover", target: "region-a" }, "operator")).toThrow(
      "트래픽이 이미 'region-a'로만 가고 있어요",
    );
  });

  test("[REQ-100] a region with no global balancer in front of it cannot be pinned", () => {
    const bp = appLab({ level: "multiregion" });
    const alone = World.fromBlueprint(
      { ...bp, links: bp.links.filter((l) => !(l.id === "reg-a-lb")) },
      new Catalog(),
    );
    expect(() => alone.apply({ type: "region.failover", target: "region-a" }, "operator")).toThrow(
      "'region-a' 앞에 글로벌 로드 밸런서가 없어요",
    );
  });
});
