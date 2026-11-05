/**
 * The two ways a hall's network can be built (REQ-065, ADR-0062): a legacy one (VLANs on trunks, a spanning tree,
 * gateways with VLAN interfaces) and a cloud one (every leaf uplink a routed cable, an eBGP session on each, the
 * same gateway address on every leaf). A person shuts a BGP neighbor and sees the session, the routes, the ping
 * and the alarm follow; a cable pulled moves the spanning tree.
 */
import { Catalog } from "@terrarium/core/catalog";
import { createFacades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import {
  type CampusSpec,
  DEFAULT_CAMPUS,
  DEFAULT_WORLDGEN,
  generateCampus,
  generateWorld,
} from "@terrarium/core/sources/worldgen";
import { TOOL_NAMES, Toolbox, type ToolContext } from "@terrarium/core/tools";
import { type Blueprint, netModelOf, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { networkLab } from "../../packages/core/src/world/test-support/net-lab";

const catalog = new Catalog();
const OS = {
  eos: "eos/4.32",
  nxos: "nxos/10.3",
  iosxe: "ios-xe/17.9",
} as const;
type OsName = keyof typeof OS;

const LEAVES = ["tor-a", "tor-b"];
const SPINES = ["sp1", "sp2"];

/** The lab with its two racks, two spines and core; `fabric` is what the racks' switches say they are built as. */
function boot(
  fabric: "legacy" | "cloud",
  profile?: string,
  switches: readonly string[] = [],
  edit?: (bp: Blueprint) => Blueprint,
) {
  let bp = networkLab();
  bp = {
    ...bp,
    entities: bp.entities.map((e) => {
      const props: Record<string, string> = { ...(e.props as Record<string, string>) };
      if ([...LEAVES, ...SPINES].includes(e.id)) props.fabric = fabric;
      if (profile && switches.includes(e.id)) props.nosProfile = profile;
      return { ...e, props };
    }),
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
  /** One show command, entered at the privileged prompt where the OS has one. */
  const show = (device: string, command: string): string => {
    const nx = world.index.find(device)?.props.nosProfile === "nxos/10.3";
    const nxDefault = !profile && device.startsWith("tor");
    const steps = cli(device, nx || nxDefault ? [command] : ["enable", command]).steps;
    return steps.at(-1).output;
  };
  const steps = (device: string, commands: string[]): any[] =>
    cli(device, commands, true).steps.filter(
      (s: any) => !["enable", "configure terminal", "end"].includes(s.command),
    );
  const alarms = (code?: string) => world.alarms().filter((a) => (code ? a.code === code : true));
  const settle = () => physics.run(5);
  return { world, physics, facades, call, cli, show, steps, alarms, settle };
}

/** Where the lab's leaf uplinks are: tor-a ↔ sp1/sp2 on 172.16.0.4–.7, tor-b ↔ sp1/sp2 on .8–.11. */
const TOR_A = { as: 4210000000, sp1: "172.16.0.5", sp2: "172.16.0.7" };
const TOR_B = { as: 4210000001, sp1: "172.16.0.9", sp2: "172.16.0.11" };
const SPINE_AS = 4200000000;

/** The commands that shut or reopen one BGP neighbor, in the OS's own words. */
function neighbor(os: OsName, asn: number, ip: string, shut: boolean): string[] {
  const no = shut ? "" : "no ";
  return os === "nxos"
    ? [`router bgp ${asn}`, `neighbor ${ip}`, `${no}shutdown`]
    : [`router bgp ${asn}`, `${no}neighbor ${ip} shutdown`];
}

describe.each(Object.entries(OS))("%s in a cloud fabric [REQ-065] [REQ-062]", (name, profile) => {
  const os = name as OsName;
  const lab = () => boot("cloud", profile, ["tor-a", "sp1"]);

  test("a leaf has one established eBGP session to each spine, and the summary says so", () => {
    const { show } = lab();
    const out = show("tor-a", "show ip bgp summary");
    expect(out).toContain(String(TOR_A.as));
    expect(out).toContain(TOR_A.sp1);
    expect(out).toContain(TOR_A.sp2);
    expect(out).toContain(String(SPINE_AS));
    if (os === "eos") expect(out.match(/Estab/g)).toHaveLength(2);
    else expect(out).toMatch(/172\.16\.0\.5\s+4\s+4200000000.*\s1$/m);
    const spine = show("sp1", "show ip bgp summary");
    expect(spine).toContain(`${TOR_A.as}`);
    expect(spine).toContain(`${TOR_B.as}`);
  });

  test("the leaf's default route is learned over BGP from both spines, and the spine's table has the racks", () => {
    const { show } = lab();
    const leaf = show("tor-a", "show ip route");
    expect(leaf).toContain(TOR_A.sp1);
    expect(leaf).toContain(TOR_A.sp2);
    if (os === "eos") expect(leaf).toMatch(/B E\s+0\.0\.0\.0\/0 \[200\/0\]/);
    if (os === "nxos")
      expect(leaf).toMatch(/0\.0\.0\.0\/0, ubest\/mbest: 2\/0[\s\S]*bgp-4210000000, external/);
    if (os === "iosxe") expect(leaf).toMatch(/B\*\s+0\.0\.0\.0\/0 \[20\/0\] via 172\.16\.0\.5/);
    const spine = show("sp1", "show ip route");
    expect(spine).toMatch(/10\.0\.0\.0\/24[\s\S]{0,40}172\.16\.0\.4/);
    expect(spine).toMatch(/10\.0\.1\.0\/24[\s\S]{0,40}172\.16\.0\.8/);
  });

  test("servers in different racks reach each other over the routed uplinks", () => {
    const { show, alarms, settle } = lab();
    expect(show("tor-b", "ping 10.0.0.10")).toMatch(/5/);
    const route = show("tor-b", "traceroute 10.0.0.10");
    expect(route).toMatch(/172\.16\.0\.(9|11)/);
    expect(route).toContain("10.0.0.10");
    settle();
    expect(alarms()).toEqual([]);
  });

  test("shutting one neighbor ends that session and its route; the other path carries on and monitoring says who shut it", () => {
    const { show, steps, alarms, settle, world } = lab();
    const done = steps("tor-a", neighbor(os, TOR_A.as, TOR_A.sp1, true));
    expect(done.every((s) => s.ok)).toBe(true);
    const summary = show("tor-a", "show ip bgp summary");
    expect(summary).toMatch(os === "eos" ? /172\.16\.0\.5.*Idle/ : /172\.16\.0\.5.*Idle \(Admin\)/);
    const routes = show("tor-a", "show ip route");
    expect(routes).not.toContain(`via ${TOR_A.sp1}`);
    expect(routes).toContain(TOR_A.sp2);
    // the spine has lost the session too: the other side only sees it down
    expect(show("sp1", "show ip bgp summary")).toMatch(/Active/);
    expect(show("tor-b", "ping 10.0.0.10")).toMatch(/5/);
    settle();
    const down = alarms("bgp_session_down");
    expect(down).toHaveLength(1);
    expect(down[0]).toMatchObject({ entityId: "tor-a", severity: "warning" });
    expect(down[0]?.message).toContain("172.16.0.5");
    expect(alarms("host_unreachable")).toEqual([]);
    expect(world.alarms().some((a) => a.code === "link_down")).toBe(false);
  });

  test("shutting both neighbors cuts the rack off: the ping fails, and the servers are named", () => {
    const { show, steps, alarms, settle } = lab();
    steps("tor-a", [
      ...neighbor(os, TOR_A.as, TOR_A.sp1, true),
      ...neighbor(os, TOR_A.as, TOR_A.sp2, true),
    ]);
    expect(show("tor-a", "show ip route")).not.toMatch(/0\.0\.0\.0\/0/);
    expect(show("tor-b", "ping 10.0.0.10")).not.toMatch(/ 0% packet loss|5 packets received|!!!!!/);
    settle();
    const cut = alarms("host_unreachable").map((a) => a.entityId);
    expect(cut).toEqual(expect.arrayContaining(["srv-a1", "srv-a2"]));
    const down = alarms("bgp_session_down");
    expect(down).toHaveLength(1);
    expect(down[0]?.message).toContain("2개");
    expect(down[0]?.message).toContain(TOR_A.sp1);
    expect(down[0]?.message).toContain(TOR_A.sp2);
    steps("tor-a", neighbor(os, TOR_A.as, TOR_A.sp1, false));
    steps("tor-a", neighbor(os, TOR_A.as, TOR_A.sp2, false));
    settle();
    expect(alarms("host_unreachable")).toEqual([]);
    expect(alarms("bgp_session_down")).toEqual([]);
    expect(show("tor-b", "ping 10.0.0.10")).toMatch(/5/);
  });

  test("the running configuration shows the BGP section, the anycast gateway, the VXLAN mapping and a shut neighbor", () => {
    const { show, steps } = lab();
    steps("tor-a", neighbor(os, TOR_A.as, TOR_A.sp1, true));
    const config = show("tor-a", "show running-config");
    expect(config).toContain(`router bgp ${TOR_A.as}`);
    expect(config).toContain(`neighbor ${TOR_A.sp1}`);
    expect(config).toContain("shutdown");
    expect(config).toContain("10100");
    // learned routes are not typed routes
    expect(config).not.toMatch(/ip route 0\.0\.0\.0/);
    if (os === "eos") {
      expect(config).toMatch(/interface Vlan100[\s\S]*ip address virtual 10\.0\.0\.1\/24/);
      expect(config).toContain("vxlan vlan 100 vni 10100");
    }
    if (os === "nxos") {
      expect(config).toMatch(/interface Vlan100[\s\S]*fabric forwarding mode anycast-gateway/);
      expect(config).toContain("member vni 10100");
    }
  });

  test("EVPN has a session per BGP neighbor, and the VNI table maps each rack's VLAN", () => {
    const { show } = lab();
    const evpn = show(
      "tor-a",
      os === "eos" ? "show bgp evpn summary" : "show bgp l2vpn evpn summary",
    );
    expect(evpn).toContain(TOR_A.sp1);
    expect(evpn).toContain(TOR_A.sp2);
    const vni = show("tor-a", os === "eos" ? "show vxlan vni" : "show nve vni");
    expect(vni).toContain("10100");
    expect(vni).toContain("100");
    expect(show("tor-a", "show ip bgp summary")).not.toBe(evpn);
  });
});

describe("the BGP command line [REQ-065] [REQ-062]", () => {
  test.each([
    ["eos", "(config-router-bgp)#"],
    ["nxos", "(config-router)#"],
    ["iosxe", "(config-router)#"],
  ] as const)(
    "%s: the prompts follow the BGP sections, and one line at a time is accepted",
    (os, tail) => {
      const { steps } = boot("cloud", OS[os], ["tor-a"]);
      const out = steps("tor-a", neighbor(os, TOR_A.as, TOR_A.sp1, true));
      expect(out[0].prompt).toMatch(/\(config\)#\s*$/);
      expect(out[1].prompt).toContain(tail);
      if (os === "nxos") {
        expect(out[1].prompt).toBe("tor-a(config-router)# ");
        expect(out[2].prompt).toContain("(config-router-neighbor)#");
      }
    },
  );

  test.each(Object.keys(OS) as OsName[])(
    "%s: wrong AS, unknown neighbor, mismatched remote-as and deleting a learned route are refused",
    (os) => {
      const { steps, show, world } = boot("cloud", OS[os], ["tor-a"]);
      const wrongAs = steps("tor-a", ["router bgp 65000"]);
      expect(wrongAs[0].ok).toBe(false);
      expect(wrongAs[0].output).toContain(`AS is ${TOR_A.as}`);
      const unknown = steps("tor-a", [
        `router bgp ${TOR_A.as}`,
        ...(os === "nxos" ? ["neighbor 172.99.0.1"] : ["neighbor 172.99.0.1 shutdown"]),
      ]);
      expect(unknown.at(-1).ok).toBe(false);
      expect(unknown.at(-1).output).toContain("172.99.0.1");
      const remote =
        os === "nxos"
          ? [
              `router bgp ${TOR_A.as}`,
              `neighbor ${TOR_A.sp1}`,
              "remote-as 65001",
              `remote-as ${SPINE_AS}`,
            ]
          : [
              `router bgp ${TOR_A.as}`,
              `neighbor ${TOR_A.sp1} remote-as 65001`,
              `neighbor ${TOR_A.sp1} remote-as ${SPINE_AS}`,
            ];
      const checked = steps("tor-a", remote);
      expect(checked.at(-2).ok).toBe(false);
      expect(checked.at(-2).output).toContain("would not match");
      expect(checked.at(-1).ok).toBe(true);
      const gone = steps("tor-a", [`no ip route 0.0.0.0/0 ${TOR_A.sp1}`]);
      expect(gone[0].ok).toBe(false);
      expect(gone[0].output).toContain("learned over BGP");
      // nothing above changed the network
      expect(netModelOf(world).sessionState("tor-a", TOR_A.sp1)).toBe("established");
      expect(show("tor-a", "show ip route")).toContain(TOR_A.sp1);
    },
  );

  test("a switch that is not in a cloud fabric has no BGP to show or to configure", () => {
    const eos = boot("legacy", OS.eos, ["tor-a"]);
    expect(eos.show("tor-a", "show ip bgp summary")).toBe("BGP inactive");
    const refused = eos.steps("tor-a", ["router bgp 65000"]);
    expect(refused[0].ok).toBe(false);
    expect(refused[0].output).toContain("not in a cloud fabric");
    const ios = boot("legacy", OS.iosxe, ["tor-a"]);
    expect(ios.show("tor-a", "show ip bgp summary")).toBe("% BGP not active");
    expect(boot("legacy").show("tor-a", "show ip bgp summary")).toBe("BGP is not enabled");
  });

  test("the HTTP APIs return the BGP summary as JSON", () => {
    const eos = boot("cloud", OS.eos, ["tor-a"]);
    const e = eos.facades.network.eapi("tor-a", {
      jsonrpc: "2.0",
      method: "runCmds",
      params: { version: 1, cmds: ["show ip bgp summary"] },
      id: "1",
    }) as any;
    const peers = e.result[0].vrfs.default.peers;
    expect(peers[TOR_A.sp1]).toMatchObject({ peerState: "Established", asn: String(SPINE_AS) });
    expect(e.result[0].vrfs.default.asn).toBe(String(TOR_A.as));
    const nx = boot("cloud", OS.nxos, ["tor-a"]);
    const body = (
      nx.facades.network.nxapi("tor-a", {
        ins_api: { version: "1.0", type: "cli_show", input: "show ip bgp summary" },
      }) as any
    ).ins_api.outputs.output.body;
    const af = body.TABLE_vrf.ROW_vrf.TABLE_af.ROW_af;
    expect(af.TABLE_neighbor.ROW_neighbor).toHaveLength(2);
    expect(af.TABLE_neighbor.ROW_neighbor[0]).toMatchObject({
      neighboras: String(SPINE_AS),
      state: "Established",
    });
  });
});

describe("a cable or a spine lost in a cloud fabric [REQ-065]", () => {
  test("a pulled cable ends the session by the cable alarm, not the BGP one, and the other spine carries the rack", () => {
    const { world, show, alarms, settle } = boot("cloud", OS.eos, ["tor-a"]);
    const cable = world.index
      .allLinks()
      .find((l) => l.kind === "network" && l.from === "tor-a" && l.to === "sp1");
    world.apply({ type: "link.admin", target: cable?.id ?? "", end: "from", down: true }, "test");
    settle();
    expect(show("tor-a", "show ip bgp summary")).toMatch(/172\.16\.0\.5.*(Active|Idle)/);
    expect(show("tor-a", "show ip route")).not.toContain("via 172.16.0.5");
    expect(show("tor-b", "ping 10.0.0.10")).toMatch(/5/);
    expect(alarms("host_unreachable")).toEqual([]);
  });

  test("a spine without power ends both of its sessions, and the leaves keep the other spine", () => {
    const { world, show, alarms, settle } = boot("cloud", OS.eos, ["tor-a", "tor-b"]);
    world.apply({ type: "power.set", target: "sp1", on: false }, "test");
    settle();
    const summary = show("tor-b", "show ip bgp summary");
    expect(summary.match(/Estab/g)).toHaveLength(1);
    expect(show("tor-a", "ping 10.0.1.10")).toMatch(/5/);
    expect(alarms("host_unreachable")).toEqual([]);
    expect(alarms("bgp_session_down")).toEqual([]);
  });
});

describe("a legacy network and its spanning tree [REQ-065]", () => {
  const lab = () => boot("legacy", OS.eos, ["tor-a", "tor-b", "sp1", "sp2"]);

  test("the gateway with the best priority is the root; the leaves reach it, the other gateway blocks one cable", () => {
    const { show } = lab();
    const root = show("sp1", "show spanning-tree");
    expect(root).toContain("This bridge is the root");
    expect(root).toContain("Priority    4096");
    const leaf = show("tor-a", "show spanning-tree");
    expect(leaf).toMatch(/Root ID\s+Priority\s+4096/);
    expect(leaf).toMatch(/Et3\s+root\s+forwarding/);
    expect(leaf).toMatch(/Et4\s+designated\s+forwarding/);
    expect(leaf).toMatch(/Et1\/1\s+designated\s+forwarding/);
    const other = show("sp2", "show spanning-tree");
    expect(other).toMatch(/alternate\s+discarding/);
    expect(other).toMatch(/root\s+forwarding/);
    expect(other).toContain("Priority    8192");
  });

  test.each(["nxos", "iosxe"] as const)("%s prints one Rapid-PVST section per VLAN", (os) => {
    const { show } = boot("legacy", OS[os], ["tor-a", "tor-b", "sp1", "sp2"]);
    const all = show("tor-b", "show spanning-tree");
    expect(all).toMatch(/VLAN0001[\s\S]*VLAN0101/);
    expect(all).toContain("Spanning tree enabled protocol rstp");
    expect(all).toMatch(/Root ID\s+Priority\s+4097/);
    const one = show("tor-b", "show spanning-tree vlan 101");
    expect(one).toMatch(/^VLAN0101/);
    expect(one).toMatch(/Root ID\s+Priority\s+4197/);
    expect(one).toMatch(/Root FWD/);
    expect(show("tor-b", "show spanning-tree vlan 300")).toMatch(/does not exist/);
    expect(show("sp1", "show spanning-tree")).toContain("This bridge is the root");
  });

  test("pulling the cable to the root moves the leaf's root port to the other gateway", () => {
    const { world, show, settle } = lab();
    expect(show("tor-a", "show spanning-tree")).toMatch(/Et3\s+root/);
    const cable = world.index
      .allLinks()
      .find((l) => l.kind === "network" && l.from === "tor-a" && l.to === "sp1");
    world.apply({ type: "link.admin", target: cable?.id ?? "", end: "from", down: true }, "test");
    settle();
    const after = show("tor-a", "show spanning-tree");
    expect(after).toMatch(/Et4\s+root\s+forwarding/);
    expect(after).toMatch(/Cost\s+6000/);
    expect(after).not.toMatch(/Et3\s/);
    // the root itself did not change
    expect(show("sp1", "show spanning-tree")).toContain("This bridge is the root");
  });

  test("with the root's power off the other gateway becomes the root", () => {
    const { world, show, settle } = lab();
    world.apply({ type: "power.set", target: "sp1", on: false }, "test");
    settle();
    const out = show("sp2", "show spanning-tree");
    expect(out).toContain("This bridge is the root");
    expect(out).toContain("Priority    8192");
    expect(show("tor-a", "show spanning-tree")).toMatch(/Root ID\s+Priority\s+8192/);
  });

  test("a cloud fabric has no spanning tree", () => {
    const eos = boot("cloud", OS.eos, ["tor-a"]);
    expect(eos.show("tor-a", "show spanning-tree")).toBe("No spanning tree instances exist.");
    const nx = boot("cloud", OS.nxos, ["tor-a"]);
    expect(nx.show("tor-a", "show spanning-tree")).toBe("No spanning tree instance exists.");
  });

  test("a legacy domain has no BGP and keeps its VLAN interfaces, with no anycast gateway", () => {
    const { show } = boot("legacy", OS.eos, ["sp1"]);
    const config = (() => {
      const lab2 = boot("legacy", OS.eos, ["sp1"]);
      return lab2.show("sp1", "show running-config");
    })();
    expect(config).not.toContain("router bgp");
    expect(config).not.toContain("virtual 10.0.0.1/24");
    expect(show("sp1", "show vxlan vni")).toBe("VXLAN is not configured");
  });
});

describe("generated campuses build their pods as legacy or cloud networks [REQ-065] [REQ-047]", () => {
  const spec = (seed: number): CampusSpec => ({
    ...DEFAULT_CAMPUS,
    site: "giheung",
    seed,
    buildings: 1,
    hallsPerFloor: 2,
    podsPerHall: 4,
  });

  test("every pod's switches agree on a fabric, both kinds appear, and a cloud pod's leaf runs BGP", () => {
    const found = new Set<string>();
    let cloud: { world: World; leaf: string } | undefined;
    for (let seed = 1; seed <= 12 && (found.size < 2 || !cloud); seed++) {
      const { blueprint, issues } = generateCampus(spec(seed), catalog);
      expect(issues.filter((i) => i.severity === "error")).toEqual([]);
      const switches = blueprint.entities.filter((e) => e.kind === "switch" && e.props.fabric);
      for (const s of switches) {
        expect(["legacy", "cloud"]).toContain(s.props.fabric);
        found.add(String(s.props.fabric));
      }
      const leaf = switches.find((s) => s.props.fabric === "cloud" && s.id.endsWith("-tor"));
      if (leaf && !cloud) cloud = { world: World.fromBlueprint(blueprint, catalog), leaf: leaf.id };
    }
    expect([...found].sort()).toEqual(["cloud", "legacy"]);
    const bgp = netModelOf((cloud as { world: World }).world).bgp((cloud as { leaf: string }).leaf);
    expect(bgp?.neighbors.length).toBeGreaterThanOrEqual(1);
    expect(bgp?.asn).toBeGreaterThan(4_200_000_000);
  });

  test("a hall built by the single-room generator is a legacy network", () => {
    const { blueprint } = generateWorld(
      { ...DEFAULT_WORLDGEN, site: "giheung", seed: 1, rows: 2, racksPerRow: 3 },
      catalog,
    );
    expect(blueprint.entities.some((e) => e.props.fabric === "cloud")).toBe(false);
    const world = World.fromBlueprint(blueprint, catalog);
    const leaf = blueprint.entities.find((e) => e.kind === "switch" && e.id.endsWith("-tor"));
    expect(netModelOf(world).bgp(leaf?.id ?? "")).toBeUndefined();
  });
});
