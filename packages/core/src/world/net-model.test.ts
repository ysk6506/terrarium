/** The network design and what a configuration change does to it [REQ-064]. */
import { describe, expect, test } from "vitest";
import { Catalog } from "../catalog";
import { ipToInt } from "./net-addr";
import type { SviCfg } from "./net-config";
import { netModelOf } from "./net-model";
import { planOf } from "./net-plan";
import { cutOffHosts } from "./net-reach";
import { ping } from "./net-trace";
import { networkLab } from "./test-support/net-lab";
import { World } from "./world";

const catalog = new Catalog();
const lab = () => World.fromBlueprint(networkLab(), catalog);
const pingFromCore = (world: World, hostId: string) => {
  const model = netModelOf(world);
  const host = model.plan.hosts.get(hostId);
  return ping(model, { kind: "router", sw: "core1" }, ipToInt(host?.ip ?? "") ?? -1, () => true);
};
const portOf = (world: World, sw: string, peer: string): number =>
  planOf(world.index, catalog)
    .switches.get(sw)
    ?.wires.find((w) => w.peerId === peer)?.n ?? 0;

describe("the design of a network [REQ-064]", () => {
  test("racks get a VLAN and a /24 each, servers get addresses, spines share the gateway", () => {
    const plan = planOf(lab().index, catalog);
    expect([...plan.switches].map(([id, s]) => `${id}:${s.tier}`).sort()).toEqual([
      "core1:router",
      "sp1:gateway",
      "sp2:gateway",
      "tor-a:leaf",
      "tor-b:leaf",
    ]);
    expect(plan.domains).toHaveLength(1);
    expect(plan.hosts.get("srv-a1")).toMatchObject({
      ip: "10.0.0.10",
      gateway: "10.0.0.1",
      vlan: 100,
    });
    expect(plan.hosts.get("srv-a2")?.ip).toBe("10.0.0.11");
    expect(plan.hosts.get("srv-b1")).toMatchObject({ ip: "10.0.1.10", vlan: 101 });
    const sp1 = plan.switches.get("sp1")?.design;
    expect(sp1?.svis.get(100)).toEqual({
      ip: "10.0.0.2",
      len: 24,
      shut: false,
      virtual: "10.0.0.1",
    });
    expect(plan.switches.get("sp2")?.design.svis.get(100)?.ip).toBe("10.0.0.3");
    expect(plan.switches.get("tor-a")?.design.ports.get(1)).toEqual({ mode: "access", vlan: 100 });
  });

  test("routed cables get /31s, the spines default to the core and the core routes to the domain", () => {
    const plan = planOf(lab().index, catalog);
    const sp1 = plan.switches.get("sp1")?.design;
    const core = plan.switches.get("core1")?.design;
    expect(sp1?.routes).toEqual([{ net: "0.0.0.0", len: 0, via: "172.16.0.1" }]);
    expect(core?.routes.map((r) => `${r.net}/${r.len}>${r.via}`).sort()).toEqual([
      "10.0.0.0/23>172.16.0.0",
      "10.0.0.0/23>172.16.0.2",
    ]);
  });

  test("an unchanged network reaches every server both ways, and no change means no cut-off", () => {
    const world = lab();
    for (const id of ["srv-a1", "srv-a2", "srv-b1", "stor-b"])
      expect(pingFromCore(world, id).ok).toBe(true);
    expect(cutOffHosts(world)).toEqual([]);
  });

  test("servers in different racks reach each other through the gateway", () => {
    const world = lab();
    const model = netModelOf(world);
    const a1 = model.plan.hosts.get("srv-a1");
    const r = ping(
      model,
      { kind: "host", host: a1 as never },
      ipToInt("10.0.1.10") ?? 0,
      () => true,
    );
    expect(r.ok).toBe(true);
    expect(r.forward.hops.map((h) => h.sw)).toEqual(["sp1"]);
  });
});

describe("a configuration change cuts servers off [REQ-064] [REQ-002]", () => {
  test("a port moved to another VLAN: that server cannot be reached, the others can", () => {
    const world = lab();
    const port = portOf(world, "tor-a", "srv-a1");
    world.apply(
      {
        type: "net.set",
        target: "tor-a",
        change: { op: "port", port, cfg: { mode: "access", vlan: 101 } },
      },
      "test",
    );
    expect(pingFromCore(world, "srv-a1")).toMatchObject({
      ok: false,
      forward: { failure: "host-unreachable" },
    });
    expect(pingFromCore(world, "srv-a2").ok).toBe(true);
    expect(cutOffHosts(world).map((c) => c.host.id)).toEqual(["srv-a1"]);
  });

  test("a trunk that stops carrying a VLAN on both uplinks cuts the whole rack off; on one uplink nothing happens", () => {
    const world = lab();
    const up = (peer: string) => portOf(world, "tor-b", peer);
    const trunk = (port: number) =>
      ({ op: "port", port, cfg: { mode: "trunk", allowed: [1, 100], native: 1 } }) as const;
    world.apply({ type: "net.set", target: "tor-b", change: trunk(up("sp1")) }, "test");
    expect(cutOffHosts(world)).toEqual([]);
    world.apply({ type: "net.set", target: "tor-b", change: trunk(up("sp2")) }, "test");
    expect(
      cutOffHosts(world)
        .map((c) => c.host.id)
        .sort(),
    ).toEqual(["srv-b1", "stor-b"]);
  });

  test("a VLAN interface shut on both gateways, then one of them back up", () => {
    const world = lab();
    const shut = (sw: string, down: boolean) => {
      const design = planOf(world.index, catalog).switches.get(sw)?.design.svis.get(100) as SviCfg;
      world.apply(
        {
          type: "net.set",
          target: sw,
          change: { op: "svi", vlan: 100, cfg: { ...design, shut: down } },
        },
        "test",
      );
    };
    shut("sp1", true);
    expect(cutOffHosts(world)).toEqual([]);
    shut("sp2", true);
    expect(
      cutOffHosts(world)
        .map((c) => c.host.id)
        .sort(),
    ).toEqual(["srv-a1", "srv-a2"]);
    shut("sp1", false);
    expect(cutOffHosts(world)).toEqual([]);
  });

  test("a deleted route is a one-way break: the core cannot reach in, or the spines cannot reply", () => {
    const world = lab();
    const removeRoute = (sw: string, net: string, len: number, via: string) =>
      world.apply(
        {
          type: "net.set",
          target: sw,
          change: { op: "route", route: { net, len, via }, remove: true },
        },
        "test",
      );
    removeRoute("core1", "10.0.0.0", 23, "172.16.0.0");
    expect(cutOffHosts(world)).toEqual([]);
    removeRoute("core1", "10.0.0.0", 23, "172.16.0.2");
    expect(pingFromCore(world, "srv-a1").forward.failure).toBe("no-route");
    expect(cutOffHosts(world).map((c) => c.host.id)).toHaveLength(4);
  });

  test("losing a gateway switch's power is not a configuration cut-off: the other spine answers", () => {
    const world = lab();
    world.apply(
      { type: "net.set", target: "tor-a", change: { op: "vlan", id: 150, name: "x" } },
      "test",
    );
    world.patch("sp1", "switch", { powered: false });
    expect(pingFromCore(world, "srv-a1").ok).toBe(true);
    world.patch("sp2", "switch", { powered: false });
    expect(cutOffHosts(world)).toEqual([]);
  });
});
