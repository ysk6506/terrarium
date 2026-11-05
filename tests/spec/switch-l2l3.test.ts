/**
 * Switches have VLANs, MAC tables, ARP tables and routes (REQ-064, ADR-0061). The design is derived from the
 * cables; a command typed on a switch is a world command, so a wrong VLAN or a deleted route really cuts a
 * server off: `ping` fails, the MAC table loses the address, and monitoring raises `host_unreachable`.
 */
import { Catalog } from "@terrarium/core/catalog";
import { createFacades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { TOOL_NAMES, Toolbox, type ToolContext } from "@terrarium/core/tools";
import { type Blueprint, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { networkLab } from "../../packages/core/src/world/test-support/net-lab";

const catalog = new Catalog();

function withProfile(bp: Blueprint, id: string, profile: string): Blueprint {
  return {
    ...bp,
    entities: bp.entities.map((e) =>
      e.id === id ? { ...e, props: { ...e.props, nosProfile: profile } } : e,
    ),
  };
}

function boot(profiles: Record<string, string> = {}) {
  let bp = networkLab();
  for (const [id, profile] of Object.entries(profiles)) bp = withProfile(bp, id, profile);
  const world = World.fromBlueprint(bp, catalog);
  const physics = new Physics(world);
  physics.settle();
  physics.run(60);
  const facades = createFacades(world);
  const tools = new Toolbox(TOOL_NAMES);
  const ctx: ToolContext = { world, facades };
  const call = (name: string, args: Record<string, unknown>) => {
    const r = tools.call(name, args, ctx);
    return r.error ? { error: r.error } : (r.data as any);
  };
  const cli = (device: string, commands: string[], configure = false) =>
    call("network_cli", { device, commands, configure });
  const show = (device: string, command: string): string => cli(device, [command]).steps[0].output;
  const alarms = () => world.alarms().filter((a) => a.code === "host_unreachable");
  return { world, physics, call, cli, show, alarms };
}

describe("VLANs, MAC table, ARP and routes show what the design says [REQ-064] [REQ-062]", () => {
  test("show vlan lists the rack's VLAN with its ports on NX-OS and with Cpu on EOS", () => {
    const { show } = boot();
    const tor = show("tor-a", "show vlan brief");
    expect(tor).toMatch(/^100\s+tor-a\s+active\s+Eth1\/1, Eth2\/1/m);
    expect(tor).toMatch(/^1\s+default\s+active/m);
    const spine = show("sp1", "show vlan");
    expect(spine).toMatch(/^100\s+tor-a\s+active\s+Cpu, /m);
    expect(spine).toMatch(/^101\s+tor-b\s+active\s+Cpu, /m);
  });

  test("the MAC table learns each server on the port that leads to it, here and one switch up", () => {
    const { show } = boot();
    const tor = show("tor-a", "show mac address-table");
    expect(tor).toMatch(/100\s+02[0-9a-f]{2}\.[0-9a-f.]+\s+dynamic\s+\d+\s+F\s+F\s+Eth1\/1/);
    expect(tor).toMatch(/100\s+02[0-9a-f]{2}\.[0-9a-f.]+\s+dynamic\s+\d+\s+F\s+F\s+Eth2\/1/);
    const spine = show("sp1", "show mac address-table vlan 100");
    expect(spine.match(/DYNAMIC/g)).toHaveLength(3); // two servers and sp2's VLAN interface
    expect(spine).toMatch(/\bEt\d+\b/);
  });

  test("the ARP table has the servers of the VLAN beside the interface they are on", () => {
    const { show } = boot();
    const arp = show("sp1", "show ip arp");
    expect(arp).toMatch(/10\.0\.0\.10\s+\S+\s+02[0-9a-f]{2}\.[0-9a-f.]+\s+Vlan100, Ethernet\d+/);
    expect(arp).toMatch(/10\.0\.1\.10\s+/);
  });

  test("the routing table has connected, local and static routes in each OS's layout", () => {
    const { show } = boot({ core1: "ios-xe/17.9", sp2: "nxos/10.3" });
    const eos = show("sp1", "show ip route");
    expect(eos).toMatch(
      /Gateway of last resort:\n S\s+0\.0\.0\.0\/0 \[1\/0\] via 172\.16\.0\.1, Ethernet\d/,
    );
    expect(eos).toMatch(/ C\s+10\.0\.0\.0\/24 is directly connected, Vlan100/);
    const ios = show("core1", "show ip route");
    expect(ios).toMatch(/S\s+10\.0\.0\.0\/23 \[1\/0\] via 172\.16\.0\.0/);
    expect(ios).toMatch(/C\s+172\.16\.0\.0\/31 is directly connected/);
    expect(ios).toMatch(/L\s+172\.16\.0\.1\/32 is directly connected/);
    const nxos = show("sp2", "show ip route");
    expect(nxos).toMatch(
      /10\.0\.0\.0\/24, ubest\/mbest: 1\/0, attached\n\s+\*via 10\.0\.0\.3, Vlan100, \[0\/0\], \S+, direct/,
    );
  });

  test("EOS eAPI and NX-API return the VLAN, MAC and route tables as JSON", () => {
    const { call } = boot();
    const eapi = (cmds: string[]) =>
      call("eapi_request", {
        device: "sp1",
        body: {
          jsonrpc: "2.0",
          method: "runCmds",
          params: { version: 1, cmds, format: "json" },
          id: "1",
        },
      });
    const r = eapi(["show vlan", "show ip route", "show mac address-table"]);
    expect(Object.keys(r.result[0].vlans)).toEqual(["1", "100", "101"]);
    expect(r.result[1].vrfs.default.routes["10.0.0.0/24"]).toMatchObject({
      routeType: "connected",
    });
    expect(r.result[2].unicastTable.tableEntries.length).toBeGreaterThan(3);
    const nx = call("nxapi_request", {
      device: "tor-a",
      body: {
        ins_api: {
          type: "cli_show",
          version: "1.0",
          chunk: "0",
          sid: "1",
          input: "show vlan brief",
          output_format: "json",
        },
      },
    });
    expect(nx.ins_api.outputs.output.body.TABLE_vlanbriefxbrief.ROW_vlanbriefxbrief.length).toBe(2);
  });
});

describe("ping and traceroute follow the real path [REQ-064]", () => {
  test("a ping from the core reaches a server in 2 hops and prints each OS's way", () => {
    const { show } = boot({ core1: "ios-xe/17.9", sp2: "nxos/10.3" });
    expect(show("sp1", "ping 10.0.0.10")).toMatch(
      /5 packets transmitted, 5 received, 0% packet loss/,
    );
    expect(show("core1", "ping 10.0.1.10")).toMatch(/!!!!!\nSuccess rate is 100 percent \(5\/5\)/);
    expect(show("sp2", "ping 10.0.0.11")).toMatch(
      /5 packets transmitted, 5 packets received, 0\.00% packet loss/,
    );
    const route = show("core1", "traceroute 10.0.0.10");
    expect(route).toMatch(/Tracing the route to 10\.0\.0\.10/);
    expect(route).toMatch(/\n\s+1 172\.16\.0\.\d+ .*\n\s+2 10\.0\.0\.10 /);
  });

  test("an address nobody has and a name it cannot resolve say so", () => {
    const { show } = boot();
    expect(show("sp1", "ping 10.0.0.200")).toMatch(/Destination Host Unreachable/);
    expect(show("sp1", "ping 192.168.9.9")).toMatch(
      /Destination Net Unreachable|Network is unreachable/,
    );
    expect(show("sp1", "ping example.com")).toMatch(/unknown host/);
  });
});

describe("a change typed on a switch cuts a server off [REQ-064] [REQ-002]", () => {
  test("access port moved to another VLAN: the ping fails, the MAC moves, the alarm names the server; moved back, it recovers", () => {
    const { cli, show, alarms, physics, world } = boot();
    expect(alarms()).toEqual([]);
    const r = cli("tor-a", ["interface Ethernet1/1", "switchport access vlan 101"], true);
    expect(r.steps.every((s: any) => s.ok)).toBe(true);
    expect(show("sp1", "ping 10.0.0.10")).toMatch(/Destination Host Unreachable/);
    // VLAN 101 does not exist on this switch, so the port is in no VLAN and nothing is learned on it.
    expect(show("tor-a", "show mac address-table")).not.toMatch(/Eth1\/1\s*$/m);
    cli("tor-a", ["vlan 101"], true);
    expect(show("tor-a", "show mac address-table")).toMatch(
      /101\s+02[0-9a-f]{2}\.[0-9a-f.]+\s+dynamic\s+\d+\s+F\s+F\s+Eth1\/1/,
    );
    expect(show("sp1", "ping 10.0.0.10")).toMatch(/Destination Host Unreachable/);
    physics.run(5);
    const [alarm] = alarms();
    expect(alarm).toMatchObject({ entityId: "srv-a1", severity: "critical" });
    expect(alarm?.message).toContain("통신 불가");
    expect(world.alarms().filter((a) => a.code === "host_unreachable")).toHaveLength(1);
    cli("tor-a", ["interface Ethernet1/1", "switchport access vlan 100"], true);
    expect(show("sp1", "ping 10.0.0.10")).toMatch(/5 received/);
    physics.run(5);
    expect(alarms()).toEqual([]);
  });

  test("a trunk without the rack's VLAN cuts the rack off only when both uplinks lose it", () => {
    const { cli, show, alarms, physics } = boot();
    const ports = show("tor-b", "show interface status")
      .split("\n")
      .filter((l) => /trunk/.test(l))
      .map((l) => l.split(/\s+/)[0] as string);
    expect(ports).toHaveLength(2);
    const trim = (port: string) =>
      cli("tor-b", [`interface ${port}`, "switchport trunk allowed vlan 1,100"], true);
    trim(ports[0] as string);
    physics.run(5);
    expect(alarms()).toEqual([]);
    trim(ports[1] as string);
    physics.run(5);
    expect(
      alarms()
        .map((a) => a.entityId)
        .sort(),
    ).toEqual(["srv-b1", "stor-b"]);
    expect(alarms()[0]?.message).toContain("통신 불가");
  });

  test("a VLAN interface shut on both gateways, a deleted route, and a removed VLAN are each a cut", () => {
    const { cli, show, alarms, physics } = boot();
    cli("sp1", ["interface Vlan100", "shutdown"], true);
    expect(show("sp1", "show ip interface brief")).toMatch(/Vlan100\s+10\.0\.0\.2\/24\s+down/);
    cli("sp2", ["interface Vlan100", "shutdown"], true);
    physics.run(5);
    expect(
      alarms()
        .map((a) => a.entityId)
        .sort(),
    ).toEqual(["srv-a1", "srv-a2"]);
    cli("sp2", ["interface Vlan100", "no shutdown"], true);
    physics.run(5);
    expect(alarms()).toEqual([]);
    cli(
      "core1",
      ["no ip route 10.0.0.0/23 172.16.0.0", "no ip route 10.0.0.0/23 172.16.0.2"],
      true,
    );
    expect(show("core1", "show ip route")).not.toMatch(/10\.0\.0\.0\/23/);
    expect(show("core1", "ping 10.0.1.10")).toMatch(/Network is unreachable/);
  });

  test("a route can be added back, and the table, running-config and ping all agree", () => {
    const { cli, show } = boot();
    cli(
      "core1",
      ["no ip route 10.0.0.0/23 172.16.0.0", "no ip route 10.0.0.0/23 172.16.0.2"],
      true,
    );
    expect(show("core1", "ping 10.0.0.10")).toMatch(/Network is unreachable/);
    cli("core1", ["ip route 10.0.0.0/23 172.16.0.0"], true);
    expect(show("core1", "ping 10.0.0.10")).toMatch(/5 received/);
    expect(cli("core1", ["enable", "show running-config"]).steps[1].output).toMatch(
      /ip route 10\.0\.0\.0\/23 172\.16\.0\.0/,
    );
  });

  test("configuration errors are refused the way the OS refuses them and change nothing", () => {
    const { cli, show } = boot();
    const bad = cli(
      "tor-a",
      ["interface Ethernet1/1", "switchport access vlan 5000", "ip address 1.2.3.4/24"],
      true,
    );
    expect(bad.steps[2].ok).toBe(false);
    expect(bad.steps[2].output).toMatch(/VLAN ID must be 1-4094/);
    expect(bad.steps[3].ok).toBe(false);
    expect(show("tor-a", "show vlan brief")).toMatch(/^100\s+tor-a\s+active\s+Eth1\/1/m);
  });
});

describe("a switch can be given VLANs and addresses of its own [REQ-064]", () => {
  test("vlan, name, interface vlan, ip address and a second route build a working path", () => {
    const { cli, show } = boot();
    const lines = [
      "vlan 300",
      "name lab-net",
      "exit",
      "interface Vlan300",
      "ip address 10.9.9.1/24",
      "end",
    ];
    const r = cli("sp1", lines, true);
    expect(r.steps.every((s: any) => s.ok)).toBe(true);
    expect(show("sp1", "show vlan")).toMatch(/^300\s+lab-net\s+active/m);
    expect(show("sp1", "show ip interface brief")).toMatch(/Vlan300\s+10\.9\.9\.1\/24/);
    expect(cli("sp1", ["enable", "show running-config"]).steps[1].output).toMatch(
      /interface Vlan300\n\s+ip address 10\.9\.9\.1\/24/,
    );
  });

  test("a new VLAN interface with an address shows up in the interface summary", () => {
    const { cli, show } = boot();
    cli("sp1", ["vlan 300", "exit", "interface Vlan300", "ip address 10.9.9.1/24"], true);
    expect(show("sp1", "show ip interface brief")).toMatch(/Vlan300\s+10\.9\.9\.1\/24\s+up/);
  });
});
