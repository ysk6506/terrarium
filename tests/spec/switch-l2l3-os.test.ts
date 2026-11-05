/**
 * The layer-2 and layer-3 commands in each operating system's own dress, the configuration commands that build
 * VLANs, trunks, addresses and routes, and the ways a ping can fail (REQ-064, ADR-0061). The first spec file
 * follows one fault from command to alarm; this one goes through the commands and OS variants.
 */
import { Catalog } from "@terrarium/core/catalog";
import { createFacades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { TOOL_NAMES, Toolbox, type ToolContext } from "@terrarium/core/tools";
import { type Blueprint, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { networkLab } from "../../packages/core/src/world/test-support/net-lab";

const catalog = new Catalog();
const OS = {
  eos: "eos/4.32",
  nxos: "nxos/10.3",
  iosxe: "ios-xe/17.9",
} as const;

function boot(
  profile: string | undefined = undefined,
  switches: string[] = [],
  edit?: (bp: Blueprint) => Blueprint,
) {
  let bp = networkLab();
  if (profile)
    bp = {
      ...bp,
      entities: bp.entities.map((e) =>
        switches.includes(e.id) ? { ...e, props: { ...e.props, nosProfile: profile } } : e,
      ),
    };
  if (edit) bp = edit(bp);
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
  /** The commands typed, without the enable / configure terminal / end the tool wraps around them. */
  const steps = (device: string, commands: string[]): any[] =>
    cli(device, commands, true).steps.filter(
      (s: any) => !["enable", "configure terminal", "end"].includes(s.command),
    );
  const alarms = () => world.alarms().filter((a) => a.code === "host_unreachable");
  return { world, physics, call, cli, show, steps, alarms };
}

describe.each(Object.entries(OS))(
  "%s prints the tables in its own layout [REQ-064] [REQ-062]",
  (os, profile) => {
    const lab = () => boot(profile, ["sp1", "core1"]);

    test("ARP, interface summary, MAC table and VLAN table all name the rack's VLAN interface and servers", () => {
      const { show } = lab();
      const arp = show("sp1", "show ip arp");
      expect(arp).toMatch(/10\.0\.0\.10\s/);
      expect(arp).toMatch(/10\.0\.0\.11\s/);
      expect(arp).toMatch(/02[0-9a-f]{2}\.[0-9a-f]{4}\.[0-9a-f]{4}/);
      const brief = show("sp1", "show ip interface brief");
      expect(brief).toMatch(/Vlan100/);
      expect(brief).toMatch(/Vlan101/);
      expect(brief).toMatch(os === "iosxe" ? /10\.0\.0\.2\s/ : /10\.0\.0\.2/);
      expect(show("sp1", "show mac address-table")).toMatch(/100\s+02[0-9a-f]{2}\./);
      expect(show("sp1", "show vlan")).toMatch(/\b100\b/);
    });

    test("a ping that works and a traceroute that ends at the server", () => {
      const { show } = lab();
      expect(show("core1", "ping 10.0.1.10")).toMatch(/5/);
      const route = show("core1", "traceroute 10.0.1.10");
      expect(route).toMatch(/10\.0\.1\.10/);
      expect(route).toMatch(/172\.16\.0\.\d+/);
    });

    test("the default route is marked, and a name that is not an address is refused", () => {
      const { show } = lab();
      expect(show("sp1", "show ip route")).toMatch(/0\.0\.0\.0\/0/);
      if (os === "iosxe")
        expect(show("sp1", "show ip route")).toMatch(/Gateway of last resort is 172\.16\.0\.1/);
      const refusal = os === "iosxe" ? /Unrecognized host/ : /unknown host example\.com/;
      expect(show("sp1", "ping example.com")).toMatch(refusal);
      expect(show("sp1", "traceroute example.com")).toMatch(refusal);
    });

    test("a switched-off server cannot be reached from its gateway", () => {
      const { show, world, physics } = lab();
      world.apply({ type: "power.set", target: "srv-a1", on: false }, "test");
      physics.run(5);
      const out = show("sp1", "ping 10.0.0.10");
      if (os === "eos") expect(out).toMatch(/Destination Host Unreachable/);
      if (os === "nxos") expect(out).toMatch(/Request 0 timed out/);
      if (os === "iosxe") expect(out).toMatch(/UUUUU\nSuccess rate is 0 percent \(0\/5\)/);
      expect(show("sp1", "traceroute 10.0.0.10")).toMatch(/\* \* \*|\*\s+\*\s+\*/);
    });
  },
);

describe.each([
  [
    "eos",
    OS.eos,
    "no ip virtual-router address",
    /5 packets transmitted, 0 received, 100% packet loss/,
  ],
  ["iosxe", OS.iosxe, "no standby 1 ip", /\.{5}\nSuccess rate is 0 percent/],
] as const)(
  "%s: a rack VLAN with no gateway address [REQ-064] [REQ-062]",
  (_os, profile, removeGateway, lost) => {
    test("the request arrives, the reply is lost, and the alarm says the gateway does not answer", () => {
      const { show, steps, alarms, physics } = boot(profile, ["sp1", "sp2", "core1"]);
      for (const sw of ["sp1", "sp2"])
        expect(steps(sw, ["interface Vlan100", removeGateway]).every((s) => s.ok)).toBe(true);
      physics.run(5);
      expect(show("core1", "ping 10.0.0.10")).toMatch(lost);
      expect(
        alarms()
          .map((a) => a.entityId)
          .sort(),
      ).toEqual(["srv-a1", "srv-a2"]);
      expect(alarms()[0]?.message).toMatch(/게이트웨이/);
    });
  },
);

describe("trunks are shown and changed like the devices do [REQ-064]", () => {
  test("allowed VLAN lists compress to ranges, add and remove work, none and all are the extremes", () => {
    const { steps, show } = boot();
    const trunk = () => show("tor-a", "show interface trunk");
    const set = (...cmds: string[]) => steps("tor-a", ["interface Ethernet1/1", ...cmds]);
    const done = set(
      "switchport mode trunk",
      "switchport trunk allowed vlan 100,102-104",
      "switchport trunk native vlan 7",
    );
    expect(done.every((s) => s.ok)).toBe(true);
    expect(trunk()).toMatch(/Eth1\/1\s+on\s+802\.1q\s+trunking\s+7/);
    expect(trunk()).toMatch(/Eth1\/1\s+100,102-104/);
    set("switchport trunk allowed vlan add 106");
    expect(trunk()).toMatch(/Eth1\/1\s+100,102-104,106/);
    set("switchport trunk allowed vlan remove 102-103");
    expect(trunk()).toMatch(/Eth1\/1\s+100,104,106/);
    set("switchport trunk allowed vlan none");
    expect(trunk()).toMatch(/Eth1\/1\s+none/);
    set("switchport trunk allowed vlan all");
    expect(trunk()).toMatch(/Eth1\/1\s+1-4094/);
    const config = show("tor-a", "show running-config");
    expect(config).toMatch(/interface Ethernet1\/1[\s\S]*?switchport mode trunk/);
    expect(config).toMatch(/switchport trunk native vlan 7/);
  });

  test("a trunk-mode change back to access, and a bad VLAN list, are handled", () => {
    const { steps, show } = boot();
    steps("tor-a", ["interface Ethernet1/1", "switchport mode trunk"]);
    const back = steps("tor-a", ["interface Ethernet1/1", "switchport mode access"]);
    expect(back.every((s) => s.ok)).toBe(true);
    const bad = steps("tor-a", ["interface Ethernet1/1", "switchport trunk allowed vlan 5000"]);
    expect(bad[1]?.ok).toBe(false);
    expect(bad[1]?.output).toMatch(/not a VLAN list/);
    const backwards = steps("tor-a", [
      "interface Ethernet1/1",
      "switchport trunk allowed vlan 9-3",
    ]);
    expect(backwards[1]?.ok).toBe(false);
    expect(show("tor-a", "show vlan brief")).toMatch(/^100\s+tor-a\s+active/m);
  });
});

describe("VLANs, addresses and routes can be created, changed and removed [REQ-064]", () => {
  test("vlan, name, no vlan; a VLAN interface comes and goes", () => {
    const { steps, show } = boot();
    expect(
      steps("sp1", ["vlan 300", "name lab-net", "exit", "vlan 301", "exit"]).every((s) => s.ok),
    ).toBe(true);
    expect(show("sp1", "show vlan")).toMatch(/^300\s+lab-net\s+active/m);
    expect(show("sp1", "show vlan")).toMatch(/^301\s+VLAN0301\s+active/m);
    steps("sp1", ["no vlan 301"]);
    expect(show("sp1", "show vlan")).not.toMatch(/^301\s/m);
    steps("sp1", ["interface Vlan300", "ip address 10.9.9.1/24"]);
    expect(show("sp1", "show ip interface brief")).toMatch(/Vlan300/);
    steps("sp1", ["no interface vlan 300"]);
    expect(show("sp1", "show ip interface brief")).not.toMatch(/Vlan300/);
    const vlan1 = steps("sp1", ["no vlan 1"])[0];
    expect(vlan1.ok).toBe(false);
    const huge = steps("sp1", ["vlan 5000"])[0];
    expect(huge.ok).toBe(false);
    expect(huge.output).toMatch(/VLAN ID must be 1-4094/);
  });

  test("a routed port takes an address with a prefix or a mask, and gives it up again", () => {
    const { steps, show } = boot();
    const first = steps("tor-a", [
      "interface Ethernet2/1",
      "no switchport",
      "ip address 10.7.7.1/31",
    ]);
    expect(first.every((s) => s.ok)).toBe(true);
    expect(show("tor-a", "show ip interface brief")).toMatch(/Eth2\/1\s+10\.7\.7\.1/);
    steps("tor-a", ["interface Ethernet2/1", "no ip address"]);
    expect(show("tor-a", "show ip interface brief")).not.toMatch(/10\.7\.7\.1/);
    const withMask = steps("tor-a", [
      "interface Ethernet2/1",
      "ip address 10.7.7.1 255.255.255.254",
    ]);
    expect(withMask.every((s) => s.ok)).toBe(true);
    expect(show("tor-a", "show ip interface brief")).toMatch(/10\.7\.7\.1/);
    steps("tor-a", ["interface Ethernet2/1", "switchport"]);
    const refused = steps("tor-a", ["interface Ethernet2/1", "ip address 10.7.7.1/31"]);
    expect(refused[1]?.ok).toBe(false);
    expect(refused[1]?.output).toMatch(/no switchport/);
    const badMask = steps("tor-a", [
      "interface Ethernet2/1",
      "no switchport",
      "ip address 10.7.7.1 255.0.255.0",
    ]);
    expect(badMask[2]?.ok).toBe(false);
    expect(badMask[2]?.output).toMatch(/not an address with a mask/);
  });

  test("an address on a switch port that is not a routed one, or on no port at all, is refused", () => {
    const { steps } = boot();
    const noPort = steps("tor-a", ["ip address 10.7.7.1/31"]);
    expect(noPort[0]?.ok).toBe(false);
    const sviOnly = steps("sp1", [
      "interface Vlan100",
      "no ip virtual-router address",
      "no ip address",
    ]);
    expect(sviOnly.every((s) => s.ok)).toBe(true);
    const virtualOnPort = steps("sp1", [
      "interface Ethernet3",
      "ip virtual-router address 10.1.1.1",
    ]);
    expect(virtualOnPort[1]?.ok).toBe(false);
    const gone = steps("sp1", ["no interface vlan 777"]);
    expect(gone.every((s) => s.ok)).toBe(true);
  });

  test("routes with a mask or a prefix are added, shown in the running configuration and removed", () => {
    const { steps, show, cli } = boot();
    const add = steps("core1", [
      "ip route 10.8.0.0 255.255.0.0 172.16.0.0",
      "ip route 10.9.0.0/16 172.16.0.2",
    ]);
    expect(add.every((s) => s.ok)).toBe(true);
    const table = show("core1", "show ip route");
    expect(table).toMatch(/10\.8\.0\.0\/16/);
    expect(table).toMatch(/10\.9\.0\.0\/16/);
    const config = cli("core1", ["enable", "show running-config"]).steps[1].output;
    expect(config).toMatch(/ip route 10\.8\.0\.0\/16 172\.16\.0\.0/);
    steps("core1", [
      "no ip route 10.8.0.0 255.255.0.0 172.16.0.0",
      "no ip route 10.9.0.0/16 172.16.0.2",
    ]);
    expect(show("core1", "show ip route")).not.toMatch(/10\.[89]\.0\.0\/16/);
    const bad = steps("core1", ["ip route 10.8.0.1/16 172.16.0.0"]);
    expect(bad[0]?.ok).toBe(false);
    const notNet = steps("core1", ["ip route nonsense 172.16.0.0"]);
    expect(notNet[0]?.ok).toBe(false);
  });
});

describe("IOS XE keeps its own habits [REQ-064] [REQ-062]", () => {
  const ios = () => boot(OS.iosxe, ["tor-a", "sp1", "core1"]);

  test("an access VLAN that does not exist is created, with the message the OS prints", () => {
    const { steps, show } = ios();
    const r = steps("tor-a", ["interface Ethernet1/1", "switchport access vlan 150"]);
    expect(r[1]?.output).toMatch(/Access VLAN does not exist. Creating vlan 150/);
    expect(show("tor-a", "show vlan brief")).toMatch(/^150\s+VLAN0150\s+active\s+Et1\/1/m);
  });

  test("the HSRP address on a VLAN interface is the gateway, and the running configuration says so", () => {
    const { steps, cli } = ios();
    expect(
      steps("sp1", ["interface Vlan100", "no standby 1 ip", "standby 1 ip 10.0.0.1"]).every(
        (s) => s.ok,
      ),
    ).toBe(true);
    const config = cli("sp1", ["enable", "show running-config"]).steps[1].output;
    expect(config).toMatch(
      /interface Vlan100\n\s+ip address 10\.0\.0\.2 255\.255\.255\.0\n\s+standby 1 ip 10\.0\.0\.1/,
    );
    expect(config).toMatch(/ip route 0\.0\.0\.0 0\.0\.0\.0 172\.16\.0\.1/);
  });
});

describe("EOS and NX-OS running configuration carry the L2/L3 lines [REQ-064] [REQ-062]", () => {
  test("EOS: vlan names, switchport lines, virtual router address and routes", () => {
    const { steps, cli } = boot();
    steps("sp1", [
      "vlan 300",
      "name lab-net",
      "exit",
      "interface Ethernet1",
      "switchport access vlan 300",
    ]);
    const config = cli("sp1", ["enable", "show running-config"]).steps[1].output;
    expect(config).toMatch(/vlan 300\n\s+name lab-net/);
    expect(config).toMatch(
      /interface Vlan100\n\s+ip address 10\.0\.0\.2\/24\n\s+ip virtual-router address 10\.0\.0\.1/,
    );
    expect(config).toMatch(/ip route 0\.0\.0\.0\/0 172\.16\.0\.1/);
    expect(config).toMatch(/ip routing/);
  });

  test("NX-OS: hsrp under the VLAN interface, no shutdown and routed ports", () => {
    const { steps, cli } = boot(OS.nxos, ["sp1"]);
    steps("sp1", ["interface Ethernet1/20", "no switchport", "ip address 10.5.5.1/31"]);
    const config = cli("sp1", ["show running-config"]).steps[0].output;
    expect(config).toMatch(
      /interface Vlan100\n\s+no shutdown\n\s+ip address 10\.0\.0\.2\/24\n\s+hsrp 1\n\s+ip 10\.0\.0\.1/,
    );
    expect(config).toMatch(/ip address 10\.5\.5\.1\/31/);
  });
});

describe("routes that point at each other and routes that are gone [REQ-064] [REQ-002]", () => {
  test("a routing loop ends with 'time to live exceeded' and traceroute does not reach the end", () => {
    const { steps, show } = boot();
    steps("sp1", ["ip route 10.77.0.0/16 172.16.0.1"]);
    steps("core1", ["ip route 10.77.0.0/16 172.16.0.0"]);
    expect(show("sp1", "ping 10.77.0.1")).toMatch(/Time to live exceeded/);
    expect(show("sp1", "traceroute 10.77.0.1")).toMatch(/\* \* \*/);
  });

  test("without the core's routes down to the racks, every server is named in an alarm that says no route", () => {
    const { steps, alarms, physics } = boot();
    steps("core1", ["no ip route 10.0.0.0/23 172.16.0.0", "no ip route 10.0.0.0/23 172.16.0.2"]);
    physics.run(5);
    expect(alarms().length).toBeGreaterThanOrEqual(4);
    expect(alarms().every((a) => /경로가 없어요/.test(a.message))).toBe(true);
  });

  test("a VLAN with no ports shows in the NX-OS JSON without a port list", () => {
    const { steps, call } = boot();
    steps("tor-a", ["interface Ethernet1/3", "switchport trunk allowed vlan 100"]);
    steps("tor-a", ["interface Ethernet1/4", "switchport trunk allowed vlan 100"]);
    steps("tor-a", ["vlan 300"]);
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
    const rows = nx.ins_api.outputs.output.body.TABLE_vlanbriefxbrief.ROW_vlanbriefxbrief;
    const empty = rows.find((r: any) => r["vlanshowbr-vlanid"] === "300");
    expect(empty).toBeDefined();
    expect(empty["vlanshowplist-ifidx"]).toBeUndefined();
  });
});
