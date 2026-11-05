/**
 * What each switch OS prints for each command, and the corners of its command line (REQ-062, ADR-0059):
 * the same eleven commands on EOS, NX-OS and IOS XE with a port shut, a port described and a cable
 * pulled; filters; mode changes; JSON of the HTTP APIs.
 */
import { Catalog } from "@terrarium/core/catalog";
import { createFacades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { type Blueprint, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../packages/core/src/world/test-support/sample";

const catalog = new Catalog();

function boot(profile: string) {
  const bp0 = sampleBlueprint();
  const bp: Blueprint = {
    ...bp0,
    entities: bp0.entities.map((e) =>
      e.id === "tor-a" ? { ...e, props: { ...e.props, nosProfile: profile } } : e,
    ),
    links: bp0.links.map((l) => (l.kind === "network" ? { ...l, props: {} } : l)),
  };
  const world = World.fromBlueprint(bp, catalog);
  new Physics(world).settle();
  const facades = createFacades(world);
  const cli = (commands: string[], configure = false) =>
    facades.network.cli("tor-a", { commands, configure }) as any;
  return { world, facades, cli };
}

const OSES = [
  {
    os: "eos",
    profile: "eos/4.32",
    pre: ["enable"],
    port1: "Ethernet1",
    port2: "Ethernet2",
    short: "Et1",
  },
  {
    os: "nxos",
    profile: "nxos/10.3",
    pre: [] as string[],
    port1: "Ethernet1/1",
    port2: "Ethernet1/2",
    short: "Eth1/1",
  },
  {
    os: "iosxe",
    profile: "ios-xe/17.9",
    pre: ["enable"],
    port1: "TwentyFiveGigE1/0/1",
    port2: "TwentyFiveGigE1/0/2",
    short: "Twe1/0/1",
  },
] as const;

describe("each OS prints the same commands in its own layout [REQ-062]", () => {
  for (const c of OSES) {
    const IF = c.os === "nxos" ? "interface" : "interfaces";
    test(`${c.os}: every supported command prints, with a shut port, a described port and a free port`, () => {
      const { cli, world } = boot(c.profile);
      world.advance(1_000_000);
      cli([`interface ${c.port2}`, "shutdown", "description lab-uplink"], true);
      const names = [
        "show version",
        "show clock",
        `show ${IF}`,
        `show ${IF} status`,
        `show ${IF} description`,
        "show ip interface brief",
        "show lldp neighbors",
        "show running-config",
        `show ${IF} ${c.port1}`,
        `show ${IF} ${c.port2}`,
        `show ${IF} ${c.port1} status`,
        `show running-config interface ${c.port2}`,
      ];
      const r = cli([...c.pre, ...names]);
      expect(r.steps.every((s: any) => s.ok)).toBe(true);
      const out = (command: string): string =>
        r.steps.find((s: any) => s.command === command).output;
      expect(out(`show ${IF} status`)).toContain("disabled");
      expect(out(`show ${IF} status`)).toContain("connected");
      expect(out(`show ${IF} status`)).toContain("lab-uplink");
      if (c.os !== "nxos") expect(out(`show ${IF} description`)).toContain("admin down");
      expect(out(`show ${IF} description`)).toContain("srv-a1");
      expect(out("show lldp neighbors")).toContain("srv-a1");
      expect(out("show lldp neighbors")).not.toContain("srv-a2");
      expect(out(`show ${IF} ${c.port2}`)).toMatch(/administratively down|Administratively down/);
      expect(out(`show ${IF} ${c.port1}`)).toMatch(/is up/);
      expect(out(`show ${IF} ${c.port1} status`).split("\n").length).toBeLessThanOrEqual(4);
      expect(out(`show running-config interface ${c.port2}`)).toContain("shutdown");
      expect(out("show running-config")).toContain("hostname tor-a");
      expect(out("show running-config")).toContain("description lab-uplink");
      expect(out("show running-config").trimEnd().endsWith("end")).toBe(true);
    });
  }

  test("EOS version, uptime and detail text", () => {
    const { cli, world } = boot("eos/4.32");
    world.advance(700_000);
    const r = cli([
      "enable",
      "show version",
      "show interfaces Ethernet1",
      "show hostname",
      "show ip interface brief",
    ]);
    expect(r.steps[1].output).toMatch(/Uptime: +1 week, 1 day, 2 hours and 26 minutes/);
    expect(r.steps[1].output).toContain("Software image version: 4.32.2F");
    expect(r.steps[2].output).toContain("Ethernet1 is up, line protocol is up (connected)");
    expect(r.steps[2].output).toContain("Description: srv-a1");
    expect(r.steps[3].output).toBe("Hostname: tor-a\nFQDN:     tor-a");
    expect(r.steps[4].output).toContain("Interface");
  });

  test("NX-OS and IOS XE version text carry the release", () => {
    const nx = boot("nxos/10.3");
    nx.world.advance(200_000);
    expect(nx.cli(["show version"]).steps[0].output).toMatch(/NXOS: version 10\.3\(4a\)/);
    expect(nx.cli(["show version"]).steps[0].output).toContain(
      "Kernel uptime is 2 day(s), 7 hour(s), 33 minute(s)",
    );
    expect(nx.cli(["show ip interface brief"]).steps[0].output).toContain("VRF");
    expect(nx.cli(["show clock"]).steps[0].output).toMatch(/UTC Sat Jan +3 2026/);
    const ios = boot("ios-xe/17.9");
    const v = ios.cli(["show version", "show clock", "show ip interface brief"]);
    expect(v.steps[0].output).toContain("Cisco IOS XE Software, Version 17.9.4a");
    expect(v.steps[0].output).toContain("tor-a uptime is 0 hours, 0 minutes");
    expect(v.steps[1].output).toMatch(/^\*00:00:00\.000 UTC Thu Jan 1 2026$/);
    expect(v.steps[2].output).toContain("unassigned");
  });

  test("a cable pulled (server off) shows not connected, not disabled", () => {
    for (const c of OSES) {
      const IF = c.os === "nxos" ? "interface" : "interfaces";
      const { world, cli } = boot(c.profile);
      world.apply({ type: "power.set", target: "srv-a1", on: false }, "test");
      const r = cli([...c.pre, `show ${IF} ${c.port1} status`, `show ${IF} ${c.port1}`]);
      const s = r.steps.at(-2).output;
      expect(s).toMatch(/notconnect/);
      expect(s).not.toMatch(/disabled/);
      expect(r.steps.at(-1).output).toMatch(/down/);
    }
  });
});

describe("the command line's corners [REQ-062]", () => {
  test("filters: grep flags, begin with no match, a bad pattern, an unknown filter, abbreviations", () => {
    const { cli } = boot("nxos/10.3");
    const r = cli([
      "show interface status | grep -i CONNECTED",
      "show interface status | grep -v connected | count",
      "show interface status | begin nothing-like-this",
      "show interface status | include (",
      "show interface status | frobnicate",
      "show interface status | i srv",
      "show version | json",
      "show interface Ethernet1/1 | json",
      "show hostname | no-more",
    ]);
    expect(r.steps[0].output).toContain("Eth1/1");
    expect(r.steps[1].output).toMatch(/Total number of lines/);
    expect(r.steps[2].output).toBe("");
    expect(r.steps[3].ok).toBe(false);
    expect(r.steps[4].ok).toBe(false);
    expect(r.steps[5].output).toContain("srv-a1");
    expect(JSON.parse(r.steps[6].output)).toMatchObject({ nxos_ver_str: "10.3(4a)" });
    expect(JSON.parse(r.steps[7].output).TABLE_interface.ROW_interface).toMatchObject({
      interface: "Ethernet1/1",
    });
    expect(r.steps[8].output).toBe("tor-a");
    const eos = boot("eos/4.32").cli(["enable", "show hostname | json", "show clock | json"]);
    expect(JSON.parse(eos.steps[1].output)).toMatchObject({ hostname: "tor-a" });
    expect(eos.steps[2].ok).toBe(false);
    expect(boot("ios-xe/17.9").cli(["show version | json"]).steps[0].ok).toBe(false);
  });

  test("modes: exit ladder, end, logout stops the session, blank lines are fine", () => {
    const { cli } = boot("nxos/10.3");
    const r = cli([
      "",
      "configure",
      "interface Ethernet1/1",
      "exit",
      "exit",
      "show clock",
      "logout",
      "show version",
    ]);
    expect(r.steps.map((s: any) => s.prompt)).toEqual([
      "tor-a# ",
      "tor-a# ",
      "tor-a(config)# ",
      "tor-a(config-if)# ",
      "tor-a(config)# ",
      "tor-a# ",
      "tor-a# ",
    ]);
    expect(r.steps).toHaveLength(7);
    expect(r.steps[1]).toMatchObject({ command: "configure", ok: true });
  });

  test("EOS: the interface prompt names the port, disable drops privilege, show works in config mode", () => {
    const { cli } = boot("eos/4.32");
    const r = cli(["enable", "conf", "interface et1", "show hostname", "end", "disable"]);
    expect(r.steps[3].prompt).toBe("tor-a(config-if-Et1)#");
    expect(r.steps[3].ok).toBe(true);
    expect(r.prompt).toBe("tor-a>");
  });

  test("IOS XE: show needs do inside configuration mode; write and copy save", () => {
    const { cli } = boot("ios-xe/17.9");
    const r = cli([
      "enable",
      "configure terminal",
      "show clock",
      "do show clock",
      "do show frobnicate",
      "end",
      "write memory",
      "copy running-config startup-config",
      "terminal length 0",
    ]);
    expect(r.steps[2].ok).toBe(false);
    expect(r.steps[3].ok).toBe(true);
    expect(r.steps[3].output).toContain("UTC");
    expect(r.steps[4].ok).toBe(false);
    expect(r.steps[6].output).toBe("Copy completed successfully.");
    expect(r.steps[7].output).toBe("Copy completed successfully.");
    expect(r.steps[8].ok).toBe(true);
    const nx = boot("nxos/10.3").cli(["copy running-config startup-config", "write memory"]);
    expect(nx.steps[0].output).toContain("Copy complete");
    expect(nx.steps[1].output).toBe("Copy complete.");
  });

  test("ports: wrong names are refused at the name, no description and no hostname undo what was set", () => {
    const { cli } = boot("nxos/10.3");
    const bad = cli(["show interface Ethernet9/9", "show interface 3", "show interface xyz1/1"]);
    expect(bad.steps.every((s: any) => !s.ok)).toBe(true);
    expect(bad.steps[0].output).toContain("^");
    cli(["hostname core", "interface Ethernet1/3", "description x y z"], true);
    expect(cli(["show interface Ethernet1/3"]).steps[0].output).toContain("Description: x y z");
    cli(["no hostname", "interface Ethernet1/3", "no description"], true);
    expect(cli(["show hostname"]).steps[0].output).toBe("tor-a");
    expect(cli(["show interface description | include 1/3"]).steps[0].output).not.toContain(
      "x y z",
    );
  });

  test("a configuring call that already left configuration mode does not leave twice", () => {
    const { cli } = boot("eos/4.32");
    const r = cli(["interface Ethernet1", "end"], true);
    expect(r.steps.map((s: any) => s.command)).toEqual([
      "enable",
      "configure terminal",
      "interface Ethernet1",
      "end",
    ]);
    expect(r.steps.every((s: any) => s.ok)).toBe(true);
  });
});

describe("the HTTP APIs' corners [REQ-062]", () => {
  const rpc = (cmds: unknown[], extra: Record<string, unknown> = {}) => ({
    jsonrpc: "2.0",
    method: "runCmds",
    params: { version: 1, cmds, ...extra },
    id: "x",
  });

  test("eAPI: object commands, JSON of interface details, LLDP, and bad requests", () => {
    const { facades } = boot("eos/4.32");
    const ok = facades.network.eapi(
      "tor-a",
      rpc([{ cmd: "enable" }, "show interfaces Ethernet1", "show lldp neighbors"]),
    ) as any;
    expect(ok.result[1].interfaces.Ethernet1).toMatchObject({
      interfaceStatus: "connected",
      lineProtocolStatus: "up",
    });
    expect(ok.result[2].lldpNeighbors[0]).toMatchObject({
      port: "Ethernet1",
      neighborDevice: "srv-a1",
    });
    const shut = boot("eos/4.32");
    shut.facades.network.eapi(
      "tor-a",
      rpc(["enable", "configure", "interface Ethernet2", "shutdown"]),
    );
    const down = shut.facades.network.eapi(
      "tor-a",
      rpc(["show interfaces Ethernet2", "show interfaces status"]),
    ) as any;
    expect(down.result[0].interfaces.Ethernet2).toMatchObject({
      interfaceStatus: "disabled",
      lineProtocolStatus: "notPresent",
    });
    expect(down.result[1].interfaceStatuses.Ethernet2.linkStatus).toBe("disabled");
    expect(facades.network.eapi("tor-a", rpc([]))).toMatchObject({ error: { code: -32602 } });
    expect(facades.network.eapi("tor-a", undefined)).toMatchObject({ error: { code: -32601 } });
    const text = facades.network.eapi(
      "tor-a",
      rpc(["configure", "hostname x"], { format: "text" }),
    ) as any;
    expect(text.result).toEqual([{ output: "" }, { output: "" }]);
  });

  test("NX-API: bad requests, a failed command stops the rest, single-port tables are objects", () => {
    const { facades } = boot("nxos/10.3");
    const nx = (body: unknown) => facades.network.nxapi("tor-a", body) as any;
    expect(nx(undefined).ins_api.outputs.output.code).toBe("400");
    expect(nx({ ins_api: { type: "cli_show", input: "  ;  " } }).ins_api.outputs.output.code).toBe(
      "400",
    );
    expect(nx({ ins_api: { type: "bash", input: "ls" } }).ins_api.outputs.output.code).toBe("400");
    const stopped = nx({
      ins_api: { version: "1.0", type: "cli_show", input: "show frobnicate ;show hostname" },
    });
    expect(stopped.ins_api.outputs.output).toMatchObject({ code: "400" });
    const detail = nx({
      ins_api: {
        version: "1.0",
        type: "cli_show",
        input: "show interface Ethernet1/1 ;show interface Ethernet1/1 status ;show lldp neighbors",
      },
    });
    const [d, s, l] = detail.ins_api.outputs.output;
    expect(d.body.TABLE_interface.ROW_interface).toMatchObject({
      interface: "Ethernet1/1",
      admin_state: "up",
      desc: "srv-a1",
    });
    expect(s.body.TABLE_interface.ROW_interface).toMatchObject({
      interface: "Ethernet1/1",
      state: "connected",
    });
    expect(l.body.neigh_count).toBe(4);
    const one = nx({
      ins_api: {
        version: "1.0",
        type: "cli_conf",
        input: "interface Ethernet1/9 ;shutdown ;frobnicate ;no shutdown",
      },
    });
    expect(one.ins_api.outputs.output.map((o: any) => o.code)).toEqual(["200", "200", "400"]);
    const down = nx({
      ins_api: { version: "1.0", type: "cli_show", input: "show interface Ethernet1/9" },
    });
    expect(down.ins_api.outputs.output.body.TABLE_interface.ROW_interface).toMatchObject({
      state: "down",
      admin_state: "down",
      state_rsn_desc: "Administratively down",
    });
  });

  test("a switch without power does not answer HTTP, and servers have no switch APIs", () => {
    const eos = boot("eos/4.32");
    eos.world.apply({ type: "power.set", target: "tor-a", on: false }, "test");
    expect(eos.facades.network.eapi("tor-a", rpc(["show version"]))).toMatchObject({
      timeout: true,
      device: "tor-a",
    });
    const nx = boot("nxos/10.3");
    nx.world.apply({ type: "power.set", target: "tor-a", on: false }, "test");
    expect(nx.facades.network.nxapi("tor-a", {})).toMatchObject({ timeout: true });
    expect(() => nx.facades.network.eapi("srv-a1", {})).toThrow(/no Arista eAPI service/);
    expect(() => nx.facades.network.cli("nobody", { commands: [] })).toThrow(/no equipment/);
  });

  test("SNMP shows the OS's port names and ifAdminStatus up re-enables a shut port", () => {
    for (const c of OSES) {
      const { facades, world } = boot(c.profile);
      const descr = facades.snmp.handle("tor-a", { operation: "get", oids: ["ifDescr.1"] }) as any;
      expect(descr.varbinds[0].value).toBe(c.port1);
      facades.snmp.handle("tor-a", {
        operation: "set",
        community: "private",
        values: [{ oid: "ifAdminStatus.1", type: "INTEGER", value: 2 }],
      });
      const link = world.index.incoming("tor-a", "network")[0] as { id: string };
      expect(world.linkAdminDown(link.id)).toBe(true);
      facades.snmp.handle("tor-a", {
        operation: "set",
        community: "private",
        values: [{ oid: "ifAdminStatus.1", type: "INTEGER", value: 1 }],
      });
      expect(world.linkAdminDown(link.id)).toBe(false);
    }
  });
});
