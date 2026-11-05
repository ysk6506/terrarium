/**
 * The back-end network of a GPU cluster (REQ-067, ADR-0064): every server has a NIC per rail, the NICs of one
 * rail all plug into the same leaf, and the leaves reach each other through the spines over BGP. Losing a rail
 * (a cable, a leaf, a BGP neighbor somebody shut) slows the servers down instead of cutting them off, and the
 * alarm says which rail.
 */
import { Catalog } from "@terrarium/core/catalog";
import { createFacades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { TOOL_NAMES, Toolbox, type ToolContext } from "@terrarium/core/tools";
import { netModelOf, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import {
  GPU_SERVERS,
  gpuLab,
  RAILS,
  railLeaf,
} from "../../packages/core/src/world/test-support/gpu-lab";

const catalog = new Catalog();

/** The fabric of the domain a switch belongs to. */
const fabricOfLeaf = (plan: ReturnType<typeof netModelOf>["plan"], sw: string) =>
  plan.domains[plan.switches.get(sw)?.domain ?? -1]?.fabric;

function boot(tagged = true) {
  const world = World.fromBlueprint(gpuLab(tagged), catalog);
  const physics = new Physics(world);
  physics.settle();
  physics.run(60);
  const tools = new Toolbox(TOOL_NAMES);
  const ctx: ToolContext = { world, facades: createFacades(world) };
  const cli = (device: string, commands: string[], configure = false) => {
    const r = tools.call("network_cli", { device, commands, configure }, ctx);
    return r.error ? { error: r.error } : (r.data as any);
  };
  const show = (device: string, command: string): string =>
    cli(device, ["enable", command]).steps.at(-1).output;
  const alarms = (code: string) =>
    world.alarms().filter((a) => a.code === code || a.code.startsWith(`${code}.`));
  const settle = () => physics.run(5);
  /** The cable between a server and the leaf of a rail. */
  const nicCable = (server: string, rail: number) => {
    const plan = netModelOf(world).plan.hosts.get(rail === 1 ? server : `${server}#r${rail}`);
    const wire = netModelOf(world).plan.switches.get(railLeaf(rail))?.wires[
      (plan?.ports[0]?.port ?? 0) - 1
    ];
    return wire?.linkId ?? "";
  };
  const pull = (server: string, rail: number) => {
    world.apply(
      { type: "link.admin", target: nicCable(server, rail), end: "from", down: true },
      "test",
    );
    settle();
  };
  return { world, physics, show, cli, alarms, settle, nicCable, pull };
}

describe("a GPU fabric is designed from the cabling [REQ-067]", () => {
  test("a server cabled to eight leaves has eight NICs, one on each rail, each with an address on its own leaf's subnet", () => {
    const { world } = boot();
    const hosts = [...netModelOf(world).plan.hosts.values()];
    const rails = hosts.filter((h) => h.id === "srv-a1");
    expect(rails.map((h) => h.rail)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(rails.map((h) => h.leaf)).toEqual(
      Array.from({ length: RAILS }, (_, i) => railLeaf(i + 1)),
    );
    expect(new Set(rails.map((h) => h.key)).size).toBe(RAILS);
    expect(rails[0]?.key).toBe("srv-a1");
    expect(rails[2]?.key).toBe("srv-a1#r3");
    // Rail 3's leaf is the third of its domain: 10.0.2.0/24; the three servers take .10, .11, .12.
    const third = hosts.filter((h) => h.rail === 3);
    expect(third.map((h) => h.ip).sort()).toEqual(["10.0.2.10", "10.0.2.11", "10.0.2.12"]);
    expect(new Set(third.map((h) => h.gateway))).toEqual(new Set(["10.0.2.1"]));
    expect(new Set(hosts.map((h) => h.ip)).size).toBe(hosts.length);
  });

  test("a storage array on one cable to a rail leaf is an ordinary host, not a rail server", () => {
    const { world } = boot();
    const stor = netModelOf(world).plan.hosts.get("stor-b");
    expect(stor).toBeDefined();
    expect(stor?.rail).toBeUndefined();
    expect(stor?.leaf).toBe(railLeaf(1));
  });

  test("the leaves are routed and speak BGP to both spines, and nothing is stretched with VXLAN or EVPN", () => {
    const { show } = boot();
    const summary = show(railLeaf(1), "show ip bgp summary");
    expect(summary.match(/Estab/g)).toHaveLength(2);
    expect(show("gsp1", "show ip bgp summary").match(/Estab/g)).toHaveLength(RAILS);
    expect(show(railLeaf(1), "show vxlan vni")).toMatch(/not configured/);
    expect(show(railLeaf(1), "show bgp evpn summary")).not.toMatch(/Estab/);
    expect(show(railLeaf(1), "show running-config")).not.toMatch(/vxlan|evpn/i);
  });

  test("a NIC of one rail reaches a NIC of another rail through the spines, and each NIC has its own MAC", () => {
    const { show } = boot();
    expect(show(railLeaf(1), "ping 10.0.2.11")).toMatch(/5/);
    expect(show(railLeaf(4), "ping 10.0.0.12")).toMatch(/5/);
    const table = show(railLeaf(3), "show ip arp");
    const macs = table.match(/[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}/g) ?? [];
    expect(macs.length).toBeGreaterThanOrEqual(3);
    expect(new Set(macs).size).toBe(macs.length);
  });

  test("without a fabric property, servers cabled to four or more leaves make a GPU fabric by themselves", () => {
    const { world } = boot(false);
    const plan = netModelOf(world).plan;
    expect(fabricOfLeaf(plan, railLeaf(1))).toBe("gpu");
    expect([...plan.hosts.values()].filter((h) => h.rail !== undefined)).toHaveLength(3 * RAILS);
  });

  test("a server cabled to just two leaves (dual-homed) does not make one", () => {
    const bp = gpuLab(false);
    const keep = new Set([railLeaf(1), railLeaf(2)]);
    const links = bp.links.filter(
      (l) => l.kind !== "network" || !GPU_SERVERS.includes(l.from as never) || keep.has(l.to),
    );
    const world = World.fromBlueprint({ ...bp, links }, catalog);
    const plan = netModelOf(world).plan;
    expect(fabricOfLeaf(plan, railLeaf(1))).toBe("legacy");
    expect([...plan.hosts.values()].some((h) => h.rail !== undefined)).toBe(false);
  });

  test("a healthy cluster raises no rail alarm", () => {
    const { alarms } = boot();
    expect(alarms("gpu_rail_degraded")).toEqual([]);
    expect(alarms("host_unreachable")).toEqual([]);
  });
});

describe("losing a rail slows a server down instead of cutting it off [REQ-067]", () => {
  test("a pulled NIC cable names the server and the rail, once, and leaves the others alone", () => {
    const { pull, alarms } = boot();
    pull("srv-a1", 3);
    const found = alarms("gpu_rail_degraded");
    expect(found.map((a) => a.entityId)).toEqual(["srv-a1"]);
    expect(found[0]).toMatchObject({ severity: "warning" });
    expect(found[0]?.message).toContain("레일 3번");
    expect(found[0]?.message).toContain("8개 중 1개");
    expect(alarms("host_unreachable")).toEqual([]);
  });

  test("two rails lost are told in one alarm, and putting the cable back clears it", () => {
    const { pull, alarms, world, nicCable, settle } = boot();
    pull("srv-a1", 2);
    pull("srv-a1", 7);
    const found = alarms("gpu_rail_degraded");
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("레일 2, 7번");
    expect(found[0]?.message).toContain("8개 중 2개");
    for (const rail of [2, 7])
      world.apply(
        { type: "link.admin", target: nicCable("srv-a1", rail), end: "from", down: false },
        "test",
      );
    settle();
    expect(alarms("gpu_rail_degraded")).toEqual([]);
  });

  test("a rail leaf without power slows every server by that one rail", () => {
    const { world, alarms, settle } = boot();
    world.apply({ type: "power.set", target: railLeaf(4), on: false }, "test");
    settle();
    const found = alarms("gpu_rail_degraded");
    expect(found.map((a) => a.entityId).sort()).toEqual([...GPU_SERVERS].sort());
    for (const a of found) expect(a.message).toContain("레일 4번");
    expect(alarms("host_unreachable")).toEqual([]);
  });

  test("a spine lost leaves every rail up, because the other spine carries them", () => {
    const { world, alarms, settle } = boot();
    world.apply({ type: "power.set", target: "gsp1", on: false }, "test");
    settle();
    expect(alarms("gpu_rail_degraded")).toEqual([]);
  });

  test("a rail leaf that shut both of its BGP neighbors loses its rail, and the BGP alarm says why", () => {
    const { cli, alarms, settle, show } = boot();
    const plan = show(railLeaf(2), "show ip bgp summary");
    const neighbors = [...plan.matchAll(/(172\.16\.\d+\.\d+)/g)].map((m) => m[1] as string);
    expect(neighbors).toHaveLength(2);
    const asn = /local AS number (\d+)/i.exec(plan)?.[1] ?? /AS (\d+)/.exec(plan)?.[1];
    cli(
      railLeaf(2),
      [`router bgp ${asn}`, ...neighbors.map((n) => `neighbor ${n} shutdown`)],
      true,
    );
    settle();
    const found = alarms("gpu_rail_degraded");
    expect(found.map((a) => a.entityId).sort()).toEqual([...GPU_SERVERS].sort());
    for (const a of found) expect(a.message).toContain("레일 2번");
    expect(alarms("bgp_session_down")).toHaveLength(1);
    expect(alarms("host_unreachable")).toEqual([]);
  });

  test("all eight rails lost is critical: the server cannot reach the cluster", () => {
    const { pull, alarms } = boot();
    for (let rail = 1; rail <= RAILS; rail++) pull("srv-b1", rail);
    const found = alarms("gpu_rail_degraded");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ entityId: "srv-b1", severity: "critical" });
    expect(found[0]?.message).toContain("클러스터와 통신할 수 없어요");
  });

  test("a server that is switched off raises no rail alarm", () => {
    const { world, alarms, settle } = boot();
    world.apply({ type: "power.set", target: "srv-a2", on: false }, "test");
    world.apply({ type: "power.set", target: railLeaf(5), on: false }, "test");
    settle();
    expect(
      alarms("gpu_rail_degraded")
        .map((a) => a.entityId)
        .sort(),
    ).toEqual(["srv-a1", "srv-b1"]);
  });
});
