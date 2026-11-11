/**
 * The overlay tools of an agent (REQ-097): what a trace says when a switch runs an old config or loses its uplinks,
 * what it refuses to trace, and what the sync and failover tools do and refuse.
 */
import { Catalog } from "@terrarium/core/catalog";
import type { Facades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { TOOL_NAMES, Toolbox } from "@terrarium/core/tools";
import { type FaultType, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sdnLab } from "../../packages/core/src/world/test-support/sdn-lab";

function lab() {
  const world = World.fromBlueprint(sdnLab({}), new Catalog());
  const physics = new Physics(world);
  physics.settle();
  physics.run(300);
  const box = new Toolbox(TOOL_NAMES);
  const raw = (tool: string, args: Record<string, unknown> = {}) =>
    box.call(tool, args, { world, facades: {} as Facades });
  const data = (tool: string, args: Record<string, unknown> = {}) => {
    const r = raw(tool, args);
    expect(r.error, `${tool}: ${r.error}`).toBeUndefined();
    return r.data as any;
  };
  const inject = (type: FaultType, target: string) =>
    world.apply(
      { type: "fault.add", fault: { id: `f-${type}-${target}`, type, target, params: {} } },
      "scenario",
    );
  return { world, physics, raw, data, inject };
}

describe("overlay_trace names what stops a path between two ends [REQ-097]", () => {
  test("two ends on the same leaf are traced through that one switch", () => {
    const { data } = lab();
    const t = data("overlay_trace", { src: "srv-a1", dst: "srv-a1" });
    expect(t).toMatchObject({ overlay: true, tunnel: { sameLeaf: true }, reachable: true });
    expect(t.underlay.map((h: { switch: string }) => h.switch)).toEqual(["tor-a"]);
  });

  test("a switch on an old config is named with its revision against the controller's, and a sync puts it right", () => {
    const { data, inject, physics } = lab();
    inject("sdn_sync_failed", "vtep-tor-b");
    physics.run(30);
    const t = data("overlay_trace", { src: "vm-web", dst: "vm-web2" });
    expect(t.reachable).toBe(false);
    expect(t.brokenAt).toMatchObject({ at: "vtep-tor-b", kind: "config" });
    expect(t.brokenAt.why).toContain("옛 설정(리비전 41, 컨트롤러 42)");
    expect(t.brokenAt.why).toContain("sdn_sync");
    expect(data("sdn_sync", { switch: "tor-b" })).toMatchObject({
      vtep: "vtep-tor-b",
      revision: 42,
    });
    expect(data("overlay_trace", { src: "vm-web", dst: "vm-web2" }).reachable).toBe(true);
  });

  test("a leaf that lost both uplinks cannot hold its session, and the trace says so at that switch", () => {
    const { world, data, inject, physics } = lab();
    for (const l of world.index.outgoing("tor-b", "network")) inject("link_down", l.id);
    physics.run(30);
    const t = data("overlay_trace", { src: "srv-a1", dst: "srv-b1" });
    expect(t.reachable).toBe(false);
    expect(t.underlay).toEqual([]);
    expect(t.brokenAt).toMatchObject({ at: "vtep-tor-b", kind: "evpn" });
  });

  test("an id that is not in the world, and a thing that is not a server, VM or service, are refused in words", () => {
    const { raw } = lab();
    expect(raw("overlay_trace", { src: "nope", dst: "srv-a1" }).error).toContain(
      "no entity 'nope'",
    );
    expect(raw("overlay_trace", { src: "tor-a", dst: "srv-a1" }).error).toContain(
      "'tor-a'는 서버도 VM도 서비스도 아니에요",
    );
  });
});

describe("sdn_sync and sdn_failover act on the controller pair [REQ-097]", () => {
  test("a switch with no VTEP is refused, and an argument the tool does not have is refused by name", () => {
    const { raw } = lab();
    expect(raw("sdn_sync", { switch: "srv-a1" }).error).toContain("VTEP이 없어요");
    expect(raw("sdn_status", { vtep: "vtep-tor-a" }).error).toContain("unknown argument 'vtep'");
  });

  test("a sync says the session comes up in seconds when it is down, and just to check when it is up", () => {
    const { data, inject, physics } = lab();
    expect(data("sdn_sync", { switch: "tor-a" }).note).toContain("sdn_status로 확인하세요");
    inject("evpn_session_flap", "vtep-tor-a");
    physics.run(200);
    const down = data("sdn_sync", { switch: "tor-a" });
    expect(["established", "down"]).toContain(down.evpn);
  });

  test("the standby takes over from the active, and a named controller that is not a standby is refused", () => {
    const { data, raw, world } = lab();
    const r = data("sdn_failover");
    expect(r).toMatchObject({ from: "sdn-ctl-1", to: "sdn-ctl-2" });
    expect(world.stateAs("sdn-ctl-2", "sdn_controller").role).toBe("active");
    expect(raw("sdn_failover", { controller: "sdn-ctl-2" }).error).toContain(
      "스탠바이 컨트롤러가 없어요",
    );
  });

  test("with both controllers down there is none to hand over to", () => {
    const { raw, inject, physics } = lab();
    inject("sdn_controller_down", "sdn-ctl-2");
    physics.run(30);
    expect(raw("sdn_failover").error).toContain("넘겨받을 수 있는 스탠바이 컨트롤러가 없어요");
  });
});
