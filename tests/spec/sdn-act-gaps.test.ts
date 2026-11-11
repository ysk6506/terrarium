/**
 * What the world refuses to do to the overlay and the cloud-native layer, and why (REQ-097, REQ-099): a command that makes
 * no sense is turned back before it is recorded, with the reason in words, whoever sends it. The tools check some of this
 * first; these go to the world itself.
 */
import { Catalog } from "@terrarium/core/catalog";
import { Physics } from "@terrarium/core/physics";
import { type FaultType, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sdnLab } from "../../packages/core/src/world/test-support/sdn-lab";

function boot() {
  const world = World.fromBlueprint(sdnLab({ cloudNative: true }), new Catalog());
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

describe("a controller hand-over is refused when it makes no sense [REQ-097]", () => {
  test("[REQ-097] only a controller can take over, not the one that leads, and not one that is down", () => {
    const { world, inject, physics } = boot();
    expect(() => world.apply({ type: "sdn.failover", target: "tor-a" }, "operator")).toThrow(
      "'tor-a'는 SDN 컨트롤러가 아니에요",
    );
    expect(() => world.apply({ type: "sdn.failover", target: "sdn-ctl-1" }, "operator")).toThrow(
      "'sdn-ctl-1'는 이미 액티브예요",
    );
    inject("sdn_controller_down", "sdn-ctl-2");
    physics.run(30);
    expect(() => world.apply({ type: "sdn.failover", target: "sdn-ctl-2" }, "operator")).toThrow(
      "'sdn-ctl-2'가 멈춰 있어서 넘겨받을 수 없어요",
    );
  });
});

describe("a network policy and an ingress refuse what changes nothing [REQ-099]", () => {
  test("[REQ-099] only a policy can be set, to a rule it does not have, and reverted when it has an earlier one", () => {
    const { world } = boot();
    expect(() =>
      world.apply({ type: "policy.set", target: "svc-portal", rule: "deny" }, "operator"),
    ).toThrow("'svc-portal'는 네트워크 정책이 아니에요");
    expect(() =>
      world.apply({ type: "policy.set", target: "np-license", rule: "allow" }, "operator"),
    ).toThrow("'np-license'는 이미 allow예요");
    expect(() => world.apply({ type: "policy.revert", target: "np-license" }, "operator")).toThrow(
      "'np-license'는 되돌릴 이전 설정이 없어요(처음부터 지금 설정이에요)",
    );
    world.apply({ type: "policy.set", target: "np-license", rule: "deny" }, "operator");
    expect(world.stateAs("np-license", "network_policy").rule).toBe("deny");
    world.apply({ type: "policy.revert", target: "np-license" }, "operator");
    expect(world.stateAs("np-license", "network_policy").rule).toBe("allow");
  });

  test("[REQ-099] only an ingress can be restarted, and not again while it is coming up", () => {
    const { world, inject } = boot();
    expect(() => world.apply({ type: "ingress.restart", target: "vm-web" }, "operator")).toThrow(
      "'vm-web'는 인그레스가 아니에요",
    );
    inject("ingress_controller_down", "ingress-portal");
    world.apply({ type: "ingress.restart", target: "ingress-portal" }, "operator");
    expect(() =>
      world.apply({ type: "ingress.restart", target: "ingress-portal" }, "operator"),
    ).toThrow("'ingress-portal'는 이미 다시 뜨는 중이에요");
  });

  test("[REQ-099] restarting the ingress process on the node brings the ingress back, as restarting the CNI plug-in does for the node", () => {
    const { world, inject, physics } = boot();
    inject("ingress_controller_down", "ingress-portal");
    inject("cni_plugin_failure", "cni-1");
    physics.run(30);
    expect(world.faults().map((f) => f.type)).toEqual(
      expect.arrayContaining(["ingress_controller_down", "cni_plugin_failure"]),
    );
    world.apply(
      { type: "host.act", target: "vm-web", action: "restart", arg: "nginx-ingress" },
      "operator",
    );
    world.apply(
      { type: "host.act", target: "vm-web", action: "restart", arg: "calico-node" },
      "operator",
    );
    expect(world.faults().map((f) => f.type)).not.toContain("ingress_controller_down");
    expect(world.faults().map((f) => f.type)).not.toContain("cni_plugin_failure");
  });
});
