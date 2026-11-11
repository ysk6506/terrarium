/**
 * The overlay and cloud-native tools on days when something is wrong (REQ-097, REQ-099): a controller pair that is down or
 * half down, a trace that ends on a service or on different segments, a cut cable, a policy filter, an ingress to restart.
 */
import { Catalog } from "@terrarium/core/catalog";
import type { Facades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { TOOL_NAMES, Toolbox } from "@terrarium/core/tools";
import { type FaultType, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sdnLab } from "../../packages/core/src/world/test-support/sdn-lab";

type Bp = ReturnType<typeof sdnLab>;

/** The lab, optionally with its blueprint edited first (a link taken out, a property left off). */
function lab(options: Parameters<typeof sdnLab>[0] = { cloudNative: true }, edit?: (bp: Bp) => Bp) {
  const bp = sdnLab(options);
  const world = World.fromBlueprint(edit ? edit(bp) : bp, new Catalog());
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

describe("sdn_status on a controller pair in trouble [REQ-097]", () => {
  test("one controller can be asked for by id, and an id that is not a controller is refused", () => {
    const { data, raw } = lab();
    const one = data("sdn_status", { controller: "sdn-ctl-2" });
    expect(one.controllers.map((c: { id: string }) => c.id)).toEqual(["sdn-ctl-2"]);
    expect(one.vteps).toBeUndefined();
    expect(raw("sdn_status", { controller: "tor-a" }).error).toContain("SDN 컨트롤러가 아니에요");
  });

  test("with the active one down and a standby up, the status says how long until the standby takes over", () => {
    const { data, inject, physics } = lab();
    inject("sdn_controller_down", "sdn-ctl-1");
    physics.run(1);
    const s = data("sdn_status");
    expect(s.headless).toBe(true);
    expect(s.headlessNote).toContain("활성 컨트롤러가 없어요");
    expect(s.autoFailover.takesOverInSeconds).toBeGreaterThanOrEqual(0);
    expect(s.autoFailover.takesOverInSeconds).toBeLessThanOrEqual(120);
  });

  test("with every controller down there is no failover to wait for, and a failover has nothing to hand to", () => {
    const { data, inject, physics } = lab();
    inject("sdn_controller_down", "sdn-ctl-1");
    inject("sdn_controller_down", "sdn-ctl-2");
    physics.run(5);
    const s = data("sdn_status");
    expect(s.headless).toBe(true);
    expect(s.autoFailover).toBeUndefined();
  });
});

describe("overlay_trace between services and across segments [REQ-097]", () => {
  test("a service stands for the server it runs on", () => {
    const { data } = lab();
    const t = data("overlay_trace", { src: "svc-portal", dst: "svc-license" });
    expect(t).toMatchObject({ overlay: true, tunnel: { from: "vtep-tor-a", to: "vtep-tor-a" } });
  });

  test("a VTEP whose tunnel fault is on names the switch port and its uplink cable", () => {
    const { data, inject, physics } = lab();
    inject("vxlan_tunnel_down", "vtep-tor-b");
    physics.run(5);
    const tunnel = data("overlay_trace", { src: "srv-a1", dst: "srv-b1" });
    expect(tunnel.brokenAt).toMatchObject({ at: "tor-b", kind: "switch_port" });
    expect(tunnel.brokenAt.why).toContain("케이블");
  });
});

describe("evpn_sessions, policy_list and ingress tools with filters [REQ-097][REQ-099]", () => {
  test("evpn_sessions can be limited to one VTEP, named by its switch, and says why a session stays down", () => {
    const { data, inject, physics, world } = lab();
    const one = data("evpn_sessions", { vtep: "tor-a" });
    expect(one.sessions.map((s: { vtep: string }) => s.vtep)).toEqual(["vtep-tor-a"]);
    inject("evpn_session_flap", "vtep-tor-a");
    physics.run(15);
    expect(data("evpn_sessions", { vtep: "vtep-tor-a" }).sessions[0].flapping).toBe(true);
    for (const l of world.index.outgoing("tor-b", "network")) inject("link_down", l.id);
    physics.run(30);
    const down = data("evpn_sessions", { vtep: "vtep-tor-b" }).sessions[0];
    expect(down.state).toBe("down");
    expect(down.why).toContain("스파인으로 가는 길이 없거나");
  });

  test("policy_list lists every policy, or those of one namespace only", () => {
    const { data } = lab();
    expect(data("policy_list").policies).toHaveLength(1);
    expect(data("policy_list", { ns: "other" }).policies).toEqual([]);
    expect(data("policy_list", { ns: "license" }).policies[0]).toMatchObject({
      id: "np-license",
      from: "svc-portal",
      blocking: false,
    });
  });

  test("ingress_status can ask for one ingress and shows how long a restart takes; a restart with none down is refused", () => {
    const { data, raw, inject, physics } = lab();
    expect(raw("ingress_restart").error).toContain("닫혀 있는 인그레스가 없어요");
    inject("ingress_controller_down", "ingress-portal");
    physics.run(5);
    expect(data("ingress_status", { ingress: "ingress-portal" }).ingresses[0]).toMatchObject({
      status: "down",
      node: "vm-web",
    });
    expect(data("ingress_restart", { ingress: "ingress-portal" }).restarted).toEqual([
      "ingress-portal",
    ]);
    const after = data("ingress_status", { ingress: "ingress-portal" }).ingresses[0];
    expect(after.upInSeconds).toBeGreaterThan(0);
    expect(data("ingress_status", { ingress: "none" }).ingresses).toEqual([]);
  });
});

const without =
  (...ids: string[]) =>
  (bp: Bp): Bp => ({
    ...bp,
    links: bp.links.filter((l) => !ids.includes(l.id)),
  });
const propsOf =
  (id: string, props: Record<string, unknown>) =>
  (bp: Bp): Bp => ({
    ...bp,
    entities: bp.entities.map((e) =>
      e.id === id ? ({ ...e, props: { ...e.props, ...props } } as typeof e) : e,
    ),
  });

describe("the overlay tools when the blueprint is missing a piece [REQ-097][REQ-099]", () => {
  test("a controller that stands on nothing is listed without a host, and with both standing by there is no active one", () => {
    const edit = (bp: Bp): Bp =>
      propsOf("sdn-ctl-1", { role: "standby" })(without("sdn-ctl-1-on")(bp));
    const { data } = lab({ cloudNative: true }, edit);
    const s = data("sdn_status");
    expect(s.controllers.find((c: { id: string }) => c.id === "sdn-ctl-1").host).toBeUndefined();
    expect(s.controllers.find((c: { id: string }) => c.id === "sdn-ctl-2").host).toBe("srv-b1");
    const r = data("sdn_failover");
    expect(r.from).toBeNull();
  });

  test("a service that runs nowhere is refused as an end of a trace, in words", () => {
    const { raw } = lab({ cloudNative: true }, without("license-on"));
    expect(raw("overlay_trace", { src: "svc-license", dst: "srv-a1" }).error).toContain(
      "가 도는 서버를 찾지 못했어요",
    );
  });

  test("a server cut off from its leaf is traced on the underlay alone and named without a segment", () => {
    const { data } = lab({ cloudNative: true }, (bp) => ({
      ...bp,
      links: bp.links.filter((l) => !(l.kind === "network" && l.from === "srv-a1")),
    }));
    const t = data("overlay_trace", { src: "srv-a1", dst: "srv-b1" });
    expect(t).toMatchObject({ overlay: false, reachable: false, underlay: [] });
    expect(t.note).toContain("underlay 경로만");
    const same = data("overlay_trace", { src: "srv-a1", dst: "srv-a1" });
    expect(same).toMatchObject({ overlay: false, reachable: true });
  });

  test("two leaves that lost different spines have no underlay between them, and the trace names the dead cable", () => {
    const { data, world, inject, physics } = lab();
    const up = (leaf: string, spine: string) =>
      world.index.outgoing(leaf, "network").find((l) => l.to === spine)?.id as string;
    inject("link_down", up("tor-a", "sp1"));
    inject("link_down", up("tor-b", "sp2"));
    inject("link_down", up("sp1", "core1"));
    physics.run(30);
    const t = data("overlay_trace", { src: "srv-a1", dst: "srv-b1" });
    expect(t.reachable).toBe(false);
    expect(t.brokenAt.kind).toBe("cable");
    expect(t.brokenAt.why).toContain("underlay가 끊겼어요");
  });

  test("a policy with no namespace or caller is listed under 'default' without a caller, and an ingress without a host has no node", () => {
    const edit = (bp: Bp): Bp => {
      const noProps = {
        ...bp,
        entities: bp.entities.map((e) =>
          e.id === "np-license" ? { ...e, props: { rule: "allow" } } : e,
        ),
      };
      return without("ingress-on")(noProps);
    };
    const { data } = lab({ cloudNative: true }, edit);
    expect(data("policy_list").policies[0]).toMatchObject({ ns: "default", id: "np-license" });
    expect(data("policy_list").policies[0].from).toBeUndefined();
    expect(data("ingress_status").ingresses[0].node).toBeUndefined();
  });

  test("an ingress that is down tells why", () => {
    const { data, inject, physics } = lab();
    inject("ingress_controller_down", "ingress-portal");
    physics.run(5);
    expect(data("ingress_status").ingresses[0].why).toBeTypeOf("string");
  });
});

describe("overlay_trace on a fabric built with a gap [REQ-097]", () => {
  const isUplink = (l: { kind: string; from: string; to: string }, from: string, to: string) =>
    l.kind === "network" && l.from === from && l.to === to;

  test("leaves wired to different spines that are not joined have no underlay, and no cable is dead to blame", () => {
    const edit = (bp: Bp): Bp => ({
      ...bp,
      links: bp.links.filter(
        (l) =>
          !isUplink(l, "tor-a", "sp2") &&
          !isUplink(l, "tor-b", "sp1") &&
          !isUplink(l, "sp1", "core1"),
      ),
    });
    const { data } = lab({ cloudNative: true }, edit);
    const t = data("overlay_trace", { src: "srv-a1", dst: "srv-b1" });
    expect(t.reachable).toBe(false);
    expect(t.brokenAt).toMatchObject({ at: "tor-a", kind: "underlay" });
    expect(t.brokenAt.why).toContain("underlay 경로가 없어요");
  });

  test("two VTEPs that share no segment are told so, and the trace has no VNI", () => {
    const { data } = lab({ cloudNative: true }, without("pb-seg"));
    const t = data("overlay_trace", { src: "srv-a1", dst: "srv-b1" });
    expect(t.segment).toBeNull();
    expect(t.vni).toBeUndefined();
    expect(t.note).toContain("같은 세그먼트에 있지 않아요");
  });

  test("a tunnel fault on a leaf with no uplink cable still names the leaf", () => {
    const edit = (bp: Bp): Bp => ({
      ...bp,
      links: bp.links.filter((l) => !(l.kind === "network" && l.from === "tor-b")),
    });
    const { data, inject, physics } = lab({ cloudNative: true }, edit);
    inject("vxlan_tunnel_down", "vtep-tor-b");
    physics.run(5);
    const t = data("overlay_trace", { src: "srv-b1", dst: "srv-b1" });
    expect(t.brokenAt).toMatchObject({ at: "tor-b", kind: "switch_port" });
    expect(t.brokenAt.why).not.toContain("케이블");
  });
});
