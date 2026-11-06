/**
 * The SDN overlay and cloud-native network layers (REQ-097, ADR-0107 item 6): what each fault does to the VTEPs, the
 * segments and the services that lean on them, what the tools and the system itself do about it, and the CLI views.
 */
import { Catalog } from "@terrarium/core/catalog";
import type { Facades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { emptyScenario } from "@terrarium/core/scenario";
import { Session } from "@terrarium/core/session";
import { TOOL_NAMES, Toolbox } from "@terrarium/core/tools";
import { type FaultType, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { type SdnLabOptions, sdnLab } from "../../packages/core/src/world/test-support/sdn-lab";

const MINUTE = 60;

function lab(options: SdnLabOptions = {}) {
  const world = World.fromBlueprint(sdnLab(options), new Catalog());
  const physics = new Physics(world);
  physics.settle();
  physics.run(5 * MINUTE);
  const box = new Toolbox(TOOL_NAMES);
  const ctx = { world, facades: {} as Facades };
  const raw = (tool: string, args: Record<string, unknown>) => box.call(tool, args, ctx);
  const call = (tool: string, args: Record<string, unknown> = {}) => {
    const r = raw(tool, args);
    expect(r.error, `${tool}: ${r.error}`).toBeUndefined();
    return r.data as any;
  };
  const inject = (type: FaultType, target: string, params: Record<string, number> = {}) =>
    world.apply(
      { type: "fault.add", fault: { id: `f-${type}-${target}`, type, target, params } },
      "scenario",
    );
  const status = (id: string) => world.stateAs(id, "service").status;
  const sh = (host: string, cmd: string) =>
    call("run_command", { host, cmd }) as { output: string; exitCode: number };
  return { world, physics, call, raw, inject, status, sh };
}

describe("a healthy overlay [REQ-097]", () => {
  test("services are healthy, the controller pair has one active, every session is up", () => {
    const { world, call, status } = lab({ cloudNative: true });
    expect(status("svc-portal")).toBe("healthy");
    expect(status("svc-license")).toBe("healthy");
    const s = call("sdn_status");
    expect(s.controllers.map((c: any) => [c.role, c.status])).toEqual([
      ["active", "ok"],
      ["standby", "ok"],
    ]);
    expect(s.controllers[0].managedSwitches).toBe(2);
    expect(s.controllers[1].managedSwitches).toBe(0);
    expect(s.vteps.every((v: any) => v.evpn === "established" && !v.stale && !v.cutOff)).toBe(true);
    expect(
      world.alarms().filter((a) => /sdn|evpn|vtep|overlay|ingress|cni|nfv|policy/.test(a.code)),
    ).toEqual([]);
  });
});

describe("the controller goes down [REQ-097]", () => {
  test("flows keep running (headless) and the standby takes over by itself after 30 seconds", () => {
    const { world, physics, call, inject, status } = lab();
    inject("sdn_controller_down", "sdn-ctl-1");
    physics.run(10);
    expect(status("svc-portal")).toBe("healthy");
    expect(status("svc-license")).toBe("healthy");
    expect(call("sdn_status").autoFailover.takesOverInSeconds).toBeGreaterThan(0);
    physics.run(40);
    expect(world.stateAs("sdn-ctl-2", "sdn_controller").role).toBe("active");
    const takeover = world.events().find((e) => e.type === "sdn.failover");
    expect(takeover?.cause).toBe("cluster");
    expect(world.alarms().some((a) => a.code === "sdn_controller_down")).toBe(true);
  });

  test("with a single controller nobody takes over and a sync is refused", () => {
    const { world, physics, raw, inject, status } = lab({ controllers: 1 });
    inject("sdn_controller_down", "sdn-ctl-1");
    physics.run(5 * MINUTE);
    expect(world.stateAs("sdn-ctl-1", "sdn_controller").role).toBe("active");
    expect(status("svc-portal")).toBe("healthy");
    const r = raw("sdn_sync", { switch: "tor-a" });
    expect(r.error).toContain("컨트롤러가 멈춰");
    expect(raw("sdn_failover", {}).error).toContain("스탠바이");
  });

  test("a person can move to the standby at once, and the old active one becomes the standby", () => {
    const { world, physics, call, inject } = lab();
    inject("sdn_controller_down", "sdn-ctl-1");
    physics.run(5);
    const r = call("sdn_failover");
    expect(r).toMatchObject({ from: "sdn-ctl-1", to: "sdn-ctl-2" });
    physics.run(2);
    expect(world.stateAs("sdn-ctl-1", "sdn_controller").role).toBe("standby");
  });
});

describe("a switch keeps an old configuration [REQ-097]", () => {
  test("the VTEP is a revision behind: the nodes behind it leave the segment; a sync brings them back", () => {
    const { physics, call, inject, status } = lab();
    inject("sdn_sync_failed", "vtep-tor-a");
    physics.run(10);
    expect(status("svc-license")).toBe("down");
    expect(status("svc-portal")).toBe("degraded");
    const s = call("sdn_status");
    expect(s.vteps.find((v: any) => v.id === "vtep-tor-a").stale).toBe(true);
    call("sdn_sync", { switch: "tor-a" });
    physics.run(10);
    expect(status("svc-license")).toBe("healthy");
    expect(status("svc-portal")).toBe("healthy");
  });

  test("when the standby takes over it pushes everything, which ends the failed sync by itself", () => {
    const { physics, inject, status } = lab();
    inject("sdn_controller_down", "sdn-ctl-1");
    inject("sdn_sync_failed", "vtep-tor-a");
    physics.run(10);
    expect(status("svc-license")).toBe("down");
    physics.run(40);
    expect(status("svc-license")).toBe("healthy");
  });
});

describe("a tunnel is cut [REQ-097]", () => {
  test("the VTEP's tunnels are down; the trace names the switch port; only the network team ends it", () => {
    const { physics, call, inject, status } = lab();
    inject("vxlan_tunnel_down", "vtep-tor-b");
    physics.run(10);
    expect(status("svc-portal")).toBe("degraded");
    expect(status("svc-license")).toBe("healthy");
    const t = call("overlay_trace", { src: "svc-portal", dst: "srv-b1" });
    expect(t.reachable).toBe(false);
    expect(t.brokenAt).toMatchObject({ kind: "switch_port", at: "tor-b" });
    expect(call("sdn_status").segments.find((g: any) => g.id === "seg-portal").status).toBe(
      "degraded",
    );
  });

  test("both uplinks of a leaf cut: the underlay path is gone, and the trace says which cable", () => {
    const { world, physics, call, status } = lab();
    const cables = world.index.outgoing("tor-b", "network").map((l) => l.id);
    for (const id of cables)
      world.apply(
        { type: "fault.add", fault: { id: `f-${id}`, type: "link_down", target: id, params: {} } },
        "scenario",
      );
    physics.run(10);
    expect(status("svc-portal")).toBe("degraded");
    const t = call("overlay_trace", { src: "vm-web", dst: "vm-web2" });
    expect(t.reachable).toBe(false);
    expect(["evpn", "cable", "underlay"]).toContain(t.brokenAt.kind);
  });

  test("a healthy path is traced hop by hop", () => {
    const { call } = lab();
    const t = call("overlay_trace", { src: "vm-web", dst: "vm-web2" });
    expect(t.reachable).toBe(true);
    expect(t.segment).toBe("seg-portal");
    expect(t.underlay.map((h: any) => h.switch)[0]).toBe("tor-a");
    expect(t.underlay.at(-1).switch).toBe("tor-b");
  });
});

describe("an EVPN session flaps and comes back [REQ-097]", () => {
  test("the nodes behind it are cut while it is down; a sync stops the flapping; the session returns in seconds", () => {
    const { world, physics, call, inject, status } = lab();
    inject("evpn_session_flap", "vtep-tor-a", { periodS: 120 });
    physics.run(70);
    expect(world.stateAs("vtep-tor-a", "vtep").evpn).toBe("down");
    expect(status("svc-license")).toBe("down");
    physics.run(60);
    expect(world.stateAs("vtep-tor-a", "vtep").evpn).toBe("established");
    expect(world.stateAs("vtep-tor-a", "vtep").flaps).toBeGreaterThan(0);
    physics.run(60);
    call("sdn_sync", { switch: "tor-a" });
    physics.run(15);
    expect(world.stateAs("vtep-tor-a", "vtep").evpn).toBe("established");
    physics.run(300);
    expect(world.stateAs("vtep-tor-a", "vtep").evpn).toBe("established");
    expect(status("svc-license")).toBe("healthy");
  });

  test("after what cut the uplinks is gone the BGP timers bring the session back in 90 seconds, by themselves", () => {
    const { world, physics, call, status } = lab();
    const ids = world.index.outgoing("tor-a", "network").map((l) => l.id);
    for (const id of ids)
      world.apply(
        { type: "fault.add", fault: { id: `f-${id}`, type: "link_down", target: id, params: {} } },
        "scenario",
      );
    physics.run(10);
    expect(world.stateAs("vtep-tor-a", "vtep").evpn).toBe("down");
    expect(status("svc-license")).toBe("down");
    for (const id of ids) world.apply({ type: "fault.remove", faultId: `f-${id}` }, "scenario");
    physics.run(60);
    expect(world.stateAs("vtep-tor-a", "vtep").evpn).toBe("down");
    expect(
      call("evpn_sessions", { vtep: "tor-a" }).sessions[0].reestablishInSeconds,
    ).toBeGreaterThan(0);
    physics.run(40);
    expect(world.stateAs("vtep-tor-a", "vtep").evpn).toBe("established");
    expect(status("svc-license")).toBe("healthy");
    const back = world
      .events()
      .find((e) => e.type === "note" && /EVPN 세션이 다시/.test(String((e as any).text)));
    expect(back?.cause).toBe("cluster");
  });

  test("one of two spine links down: the leaf recalculates its ECMP paths and nothing stops", () => {
    const { world, physics, status } = lab();
    const first = world.index.outgoing("tor-a", "network")[0]?.id as string;
    world.apply(
      { type: "fault.add", fault: { id: "f-ecmp", type: "link_down", target: first, params: {} } },
      "scenario",
    );
    physics.run(10);
    expect(status("svc-license")).toBe("healthy");
    const note = world
      .events()
      .find((e) => e.type === "note" && /ECMP/.test(String((e as any).text)));
    expect(note?.cause).toBe("cluster");
  });
});

describe("the cloud-native layer [REQ-097]", () => {
  test("an ingress that is down refuses requests from outside only; a restart brings it back after 20 seconds", () => {
    const { physics, call, inject, status } = lab({ cloudNative: true });
    inject("ingress_controller_down", "ingress-portal");
    physics.run(10);
    expect(status("svc-portal")).toBe("down");
    expect(status("svc-license")).toBe("healthy");
    expect(call("ingress_status").ingresses[0].status).toBe("down");
    call("ingress_restart");
    physics.run(5);
    expect(status("svc-portal")).toBe("degraded");
    physics.run(30);
    expect(status("svc-portal")).toBe("healthy");
  });

  test("a CNI plug-in that died cuts the pods of one node; restarting it on the node brings them back", () => {
    const { physics, inject, status, sh } = lab({ cloudNative: true });
    inject("cni_plugin_failure", "cni-2");
    physics.run(10);
    expect(status("svc-portal")).toBe("degraded");
    expect(sh("vm-web2", "systemctl status calico-node").output).toContain("calico-node");
    sh("vm-web2", "systemctl restart calico-node");
    physics.run(60);
    expect(status("svc-portal")).toBe("healthy");
  });

  test("a policy deployed with a deny cuts just that pair of services, and policy_revert undoes it", () => {
    const { world, physics, call, status } = lab({ cloudNative: true });
    world.apply({ type: "policy.set", target: "np-license", rule: "deny" }, "scenario");
    physics.run(10);
    expect(status("svc-license")).toBe("degraded");
    expect(status("svc-portal")).toBe("degraded");
    const list = call("policy_list", { ns: "license" });
    expect(list.policies[0]).toMatchObject({ rule: "deny", previousRule: "allow", blocking: true });
    call("policy_revert", { policy: "np-license" });
    physics.run(10);
    expect(status("svc-license")).toBe("healthy");
    expect(status("svc-portal")).toBe("healthy");
  });

  test("an overloaded virtual firewall slows the service in its way and nothing else", () => {
    const { physics, call, inject, status } = lab();
    inject("nfv_firewall_overload", "nfv-fw", { loadPct: 220 });
    physics.run(10);
    expect(status("svc-portal")).toBe("degraded");
    expect(status("svc-license")).toBe("healthy");
    expect(call("sdn_status").functions[0].latencyMs).toBeGreaterThan(50);
  });
});

describe("the switch CLI shows the overlay [REQ-097] [REQ-062]", () => {
  function cli(options: SdnLabOptions = {}) {
    const blueprint = sdnLab(options);
    const session = Session.create({
      blueprint,
      scenario: {
        ...emptyScenario("cli", "w"),
        nodes: [
          { id: "start", type: "start", params: {}, position: { x: 0, y: 0 } },
          {
            id: "agent",
            type: "agent_task",
            params: { prompt: "조치하라" },
            position: { x: 0, y: 120 },
          },
        ],
        edges: [{ id: "e", from: "start", port: "next", to: "agent" }],
        expectations: [{ id: "budget", kind: "tool_budget", maxCalls: 50, weight: 1 }],
        worldId: blueprint.id ?? "w",
      },
      tools: TOOL_NAMES,
      seed: 1,
    });
    session.start();
    const show = (device: string, command: string) => {
      const r = session.call("network_cli", { device, commands: [command] });
      expect(r.ok, `${command}: ${r.error}`).toBe(true);
      return JSON.stringify(r.data);
    };
    return { session, show };
  }

  test("show nve peers lists the remote VTEPs with a tunnel up and drops the ones that are cut", () => {
    const { session, show } = cli();
    expect(show("tor-a", "show nve peers")).toContain("nve1");
    expect(show("tor-a", "show nve peers")).toMatch(/10\.255\.\d+\.\d+/);
    session.world.apply(
      {
        type: "fault.add",
        fault: { id: "f1", type: "vxlan_tunnel_down", target: "vtep-tor-b", params: {} },
      },
      "scenario",
    );
    session.call("wait", { seconds: 5 });
    expect(show("tor-a", "show nve peers")).not.toMatch(/10\.255\.\d+\.\d+/);
  });

  test("show vxlan vni and the EVPN summary follow the state of the VTEP", () => {
    const { session, show } = cli();
    expect(show("tor-a", "show nve vni")).toContain("Up");
    session.world.apply(
      {
        type: "fault.add",
        fault: { id: "f2", type: "sdn_sync_failed", target: "vtep-tor-a", params: {} },
      },
      "scenario",
    );
    session.call("wait", { seconds: 5 });
    expect(show("tor-a", "show nve vni")).toContain("Down");
  });
});
