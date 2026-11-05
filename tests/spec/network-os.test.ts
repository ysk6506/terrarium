/**
 * Switches speak the languages of the operating systems they run (REQ-062, ADR-0059): Arista EOS, Cisco
 * NX-OS and Cisco IOS XE each with their own prompts, abbreviations and error texts, Arista eAPI and Cisco
 * NX-API on top. A `shutdown` on a port is not a printout: the link goes down in the world, the server on
 * the other end loses its network, and SNMP and the far end of the cable see it.
 */
import { Catalog } from "@terrarium/core/catalog";
import { createFacades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { actionsOf } from "@terrarium/core/scenario";
import { callEffect, TOOL_NAMES, Toolbox, type ToolContext } from "@terrarium/core/tools";
import { type Blueprint, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../packages/core/src/world/test-support/sample";

const catalog = new Catalog();

/** The sample world with its top-of-rack switch running `profile` and its odd port labels removed. */
function variant(profile?: string): Blueprint {
  const bp = sampleBlueprint();
  return {
    ...bp,
    entities: bp.entities.map((e) =>
      e.id === "tor-a" && profile ? { ...e, props: { ...e.props, nosProfile: profile } } : e,
    ),
    links: bp.links.map((l) => (l.kind === "network" && profile ? { ...l, props: {} } : l)),
  };
}

function boot(profile?: string) {
  const world = World.fromBlueprint(variant(profile), catalog);
  const physics = new Physics(world);
  physics.settle();
  physics.run(300);
  const facades = createFacades(world);
  const tools = new Toolbox(TOOL_NAMES);
  const ctx: ToolContext = { world, facades };
  const call = (name: string, args: Record<string, unknown>) => {
    const r = tools.call(name, args, ctx);
    return r.error ? { error: r.error } : (r.data as any);
  };
  const cli = (commands: string[], configure = false, device = "tor-a") =>
    call("network_cli", { device, commands, configure });
  const out = (r: any, i = 0): string => r.steps[i].output;
  const outOf = (r: any, command: string): string =>
    r.steps.find((s: any) => s.command === command).output;
  return { world, physics, facades, tools, ctx, call, cli, out, outOf };
}

/** The n-th cable into the top-of-rack switch (a server or storage on a port, in port order). */
const linkOf = (world: World, n: number) =>
  world.index.incoming("tor-a", "network")[n] as ReturnType<World["index"]["incoming"]>[number];

const EOS = "eos/4.32";
const IOS = "ios-xe/17.9";

describe("switch ports can be shut and opened in the world [REQ-062] [REQ-005]", () => {
  test("a shut port takes the link down at both ends and raises the link alarm; no shutdown brings it back", () => {
    const { world, physics } = boot();
    const link = linkOf(world, 0);
    expect(world.linkUp(link.id)).toBe(true);
    world.apply({ type: "link.admin", target: link.id, end: "to", down: true }, "test");
    expect(world.linkUp(link.id)).toBe(false);
    expect(world.linkAdminDown(link.id, "to")).toBe(true);
    expect(world.linkAdminDown(link.id, "from")).toBe(false);
    physics.run(30);
    expect(world.alarms().some((a) => a.code === `link_down.${link.id}`)).toBe(true);
    world.apply({ type: "link.admin", target: link.id, end: "to", down: false }, "test");
    physics.run(30);
    expect(world.linkUp(link.id)).toBe(true);
    expect(world.alarms().some((a) => a.code === `link_down.${link.id}`)).toBe(false);
  });

  test("a link that is cut by a fault stays down after no shutdown", () => {
    const { world } = boot();
    const link = linkOf(world, 0);
    world.apply(
      {
        type: "fault.add",
        fault: { id: "f1", type: "link_down", target: link.id, params: {} } as never,
      },
      "test",
    );
    world.apply({ type: "link.admin", target: link.id, end: "to", down: true }, "test");
    world.apply({ type: "link.admin", target: link.id, end: "to", down: false }, "test");
    expect(world.linkUp(link.id)).toBe(false);
  });

  test("an unknown link is refused, and shutting a port is a scenario action", () => {
    const { world } = boot();
    expect(() =>
      world.apply({ type: "link.admin", target: "nope", end: "to", down: true }, "test"),
    ).toThrow(/no network link/);
    expect(actionsOf([{ type: "link.admin", target: "l1", end: "to", down: true }])).toEqual([
      { action: "port_shutdown", target: "l1" },
    ]);
    expect(actionsOf([{ type: "link.admin", target: "l1", end: "to", down: false }])).toEqual([
      { action: "port_enable", target: "l1" },
    ]);
  });
});

describe("each switch runs one of three operating systems [REQ-062]", () => {
  test("the role picks the OS unless the switch says otherwise", () => {
    const sample = boot();
    expect(sample.out(sample.cli(["show version"]))).toContain("NX-OS");
    expect(sample.cli(["show version"]).os).toBe("nxos");
    expect(boot(EOS).cli(["enable", "show version"]).os).toBe("eos");
    expect(boot(IOS).cli(["show version"]).os).toBe("iosxe");
  });

  test("ports carry the names of their OS", () => {
    const eos = boot(EOS);
    const iosxe = boot(IOS);
    const nxos = boot("nxos/10.3");
    expect(eos.out(eos.cli(["enable", "show interfaces status"]), 1)).toMatch(/^Et1 /m);
    expect(nxos.out(nxos.cli(["show interface status"]))).toMatch(/^Eth1\/1 /m);
    expect(iosxe.out(iosxe.cli(["show interfaces status"]))).toMatch(/^Twe1\/0\/1 /m);
  });
});

describe("the command line behaves like the real one [REQ-062]", () => {
  test("EOS starts in user mode, privileged commands say so, enable unlocks them", () => {
    const { cli } = boot(EOS);
    const r = cli([
      "show running-config",
      "enable",
      "show running-config | include hostname",
      "configure terminal",
    ]);
    expect(r.steps[0]).toMatchObject({
      ok: false,
      output: "% Invalid input (privileged mode required)",
      prompt: "tor-a>",
    });
    expect(r.steps[1].prompt).toBe("tor-a>");
    expect(r.steps[2].output).toBe("hostname tor-a");
    expect(r.steps[3].output).toBe("");
    expect(r.prompt).toBe("tor-a(config)#");
  });

  test("EOS reports an unknown word by its token, and an unfinished or ambiguous command", () => {
    const { cli, out } = boot(EOS);
    const r = cli(["enable", "show frobnicate", "show", "show i"]);
    expect(out(r, 1)).toBe("% Invalid input (at token 1: 'frobnicate')");
    expect(out(r, 2)).toBe("% Incomplete command");
    expect(out(r, 3)).toBe("% Ambiguous command");
  });

  test("NX-OS starts privileged and marks the bad word with a caret", () => {
    const { cli } = boot();
    const r = cli(["show frobnicate"]);
    expect(r.steps[0].prompt).toBe("tor-a# ");
    expect(r.steps[0].output).toBe(
      `${" ".repeat("tor-a# show ".length)}^\n% Invalid command at '^' marker.`,
    );
    expect(cli(["conf t"]).steps[0].output).toBe(
      "Enter configuration commands, one per line.  End with CNTL/Z.",
    );
  });

  test("IOS XE puts the caret under the bad word and keeps show running-config out of user mode", () => {
    const { cli, out } = boot(IOS);
    const r = cli(["show frobnicate", "show running-config", "show ip"]);
    expect(out(r, 0)).toBe(
      `${" ".repeat("tor-a>show ".length)}^\n% Invalid input detected at '^' marker.`,
    );
    expect(out(r, 1)).toContain("Invalid input detected");
    expect(out(r, 2)).toBe("% Incomplete command.");
  });

  test("words can be abbreviated, and an exact word beats a longer one that starts with it", () => {
    const { cli, out } = boot();
    expect(out(cli(["sh int status"]))).toContain("Eth1/1");
    expect(out(cli(["sh int eth1/1"]))).toContain("Ethernet1/1 is up");
    expect(out(cli(["sh int e1/1 status"]))).toContain("Eth1/1");
  });

  test("output can be piped through include, exclude, begin, section and count", () => {
    const { cli, out } = boot();
    const all = out(cli(["show interface status"]));
    const connected = out(cli(["show interface status | include connected"]));
    expect(connected.split("\n").length).toBeLessThan(all.split("\n").length);
    expect(connected).toMatch(/Eth1\/1/);
    expect(out(cli(["show interface status | exclude notconnect|sfpAbsent|disabled"]))).not.toMatch(
      /sfpAbsent/,
    );
    expect(out(cli(["show interface status | count"]))).toMatch(/^Total number of lines: \d+$/);
    expect(
      out(cli(["show running-config | begin interface Ethernet1/1"])).startsWith(
        "interface Ethernet1/1",
      ),
    ).toBe(true);
    expect(out(cli(["show running-config | section interface Ethernet1/1"]))).toContain(
      "description srv-a1",
    );
  });

  test("a switch without power does not answer", () => {
    const { world, cli } = boot();
    world.apply({ type: "power.set", target: "tor-a", on: false }, "test");
    expect(cli(["show version"])).toMatchObject({ timeout: true, device: "tor-a" });
  });

  test("equipment that is not a switch has no command line, and says what it does speak", () => {
    const { call } = boot();
    expect(call("network_cli", { device: "srv-a1", commands: ["show version"] }).error).toMatch(
      /no CLI \(SSH\) service/,
    );
    expect(call("network_cli", { device: "tor-a", commands: "show version" }).error).toMatch(
      /commands/,
    );
  });
});

describe("shutdown on a port changes the world and every view of it [REQ-062] [REQ-002] [REQ-005]", () => {
  test("shutdown cuts the server off; SNMP, the alarm list and the far end agree; no shutdown restores it", () => {
    const { world, physics, cli, outOf, call } = boot();
    const shut = cli(
      ["interface Ethernet1/1", "shutdown", "end", "show interface status | include Eth1/1"],
      true,
    );
    expect(shut.steps.every((s: any) => s.ok)).toBe(true);
    expect(outOf(shut, "show interface status | include Eth1/1")).toContain("disabled");
    physics.run(30);
    const link = linkOf(world, 0);
    expect(world.linkUp(link.id)).toBe(false);
    expect(world.alarms().some((a) => a.code === `link_down.${link.id}`)).toBe(true);
    const snmp = call("snmp_request", {
      device: "tor-a",
      operation: "get",
      oids: ["ifAdminStatus.1", "ifOperStatus.1", "ifAdminStatus.2"],
    });
    expect(snmp.varbinds.map((b: any) => b.value)).toEqual([2, 2, 1]);
    const vc = call("vcenter_request", { method: "GET", path: "/api/vcenter/host" });
    expect(JSON.stringify(vc)).toContain("srv-a1");
    const back = cli(["interface Ethernet1/1", "no shutdown"], true);
    expect(back.steps.every((s: any) => s.ok)).toBe(true);
    physics.run(30);
    expect(world.linkUp(link.id)).toBe(true);
    expect(world.alarms().some((a) => a.code === `link_down.${link.id}`)).toBe(false);
  });

  test("setting ifAdminStatus over SNMP does the same as the CLI", () => {
    const { world, call } = boot();
    const set = call("snmp_request", {
      device: "tor-a",
      operation: "set",
      community: "private",
      values: [{ oid: "ifAdminStatus.2", type: "INTEGER", value: 2 }],
    });
    expect(set.errorStatus).toBe("noError");
    const link = linkOf(world, 1);
    expect(world.linkAdminDown(link.id, "to")).toBe(true);
    const bad = call("snmp_request", {
      device: "tor-a",
      operation: "set",
      community: "private",
      values: [{ oid: "ifAdminStatus.2", type: "INTEGER", value: 3 }],
    });
    expect(bad.errorStatus).toBe("wrongValue");
  });

  test("a shut link between two switches is disabled on one end and not connected on the other", () => {
    const bp = variant();
    const spine = {
      ...(bp.entities.find((e) => e.id === "tor-a") as never as Record<string, unknown>),
      id: "spine-1",
      name: "spine-1",
      modelId: "sw-spine-32x100g",
      parentId: "rack-b",
      placement: { type: "unit", u: 30 },
      props: { nosProfile: EOS },
    };
    const world = World.fromBlueprint(
      {
        ...bp,
        entities: [...bp.entities, spine as never],
        links: [
          ...bp.links,
          { id: "up-1", kind: "network", from: "tor-a", to: "spine-1", props: {} } as never,
          { id: "pw-s", kind: "power", from: "spine-1", to: "pdu-b", props: {} } as never,
        ],
      },
      catalog,
    );
    new Physics(world).settle();
    const facades = createFacades(world);
    facades.network.cli("tor-a", {
      commands: ["interface Ethernet1/5", "shutdown"],
      configure: true,
    });
    const near = facades.network.cli("tor-a", {
      commands: ["show interface status | include Eth1/5"],
    }) as any;
    const far = facades.network.cli("spine-1", {
      commands: ["enable", "show interfaces status | include Et1 "],
    }) as any;
    expect(near.steps[0].output).toContain("disabled");
    expect(far.steps[1].output).toContain("notconnect");
    expect(world.linkUp("up-1")).toBe(false);
  });

  test("hostname and description are remembered and SNMP shows the same", () => {
    const { cli, out, call } = boot();
    cli(["hostname core-tor", "interface Ethernet2/1", "description uplink-to-lab"], true);
    expect(out(cli(["show hostname"]))).toBe("core-tor");
    expect(cli(["show version"]).steps[0].prompt).toBe("core-tor# ");
    const snmp = call("snmp_request", {
      device: "tor-a",
      operation: "get",
      oids: ["sysName.0", "ifAlias.2"],
    });
    expect(snmp.varbinds.map((b: any) => b.value)).toEqual(["core-tor", "uplink-to-lab"]);
    expect(out(cli(["show interface description | include uplink"]))).toContain("uplink-to-lab");
  });

  test("a port with no cable can be shut too, and shows disabled", () => {
    const { cli, outOf } = boot();
    const r = cli(
      ["interface Ethernet1/30", "shutdown", "end", "show interface status | include 1/30"],
      true,
    );
    expect(outOf(r, "show interface status | include 1/30")).toContain("disabled");
  });

  test("LLDP lists live neighbours only", () => {
    const { cli, out } = boot();
    expect(out(cli(["show lldp neighbors"]))).toContain("srv-a1");
    cli(["interface Ethernet1/1", "shutdown"], true);
    expect(out(cli(["show lldp neighbors"]))).not.toContain("srv-a1");
  });
});

describe("Arista eAPI and Cisco NX-API [REQ-062]", () => {
  const eapi = (f: any, body: unknown, device = "tor-a") => f.network.eapi(device, body);

  test("eAPI answers runCmds in JSON and in text, and shuts a port with config commands", () => {
    const { facades, world } = boot(EOS);
    const version = eapi(facades, {
      jsonrpc: "2.0",
      method: "runCmds",
      params: { version: 1, cmds: ["show version"] },
      id: "7",
    }) as any;
    expect(version).toMatchObject({ jsonrpc: "2.0", id: "7" });
    expect(version.result[0]).toMatchObject({
      version: "4.32.2F",
      serialNumber: expect.stringMatching(/^FOC/),
    });
    const status = eapi(facades, {
      jsonrpc: "2.0",
      method: "runCmds",
      params: { version: 1, cmds: ["show interfaces status"] },
      id: "8",
    }) as any;
    expect(status.result[0].interfaceStatuses.Ethernet1).toMatchObject({
      linkStatus: "connected",
      description: "srv-a1",
    });
    const text = eapi(facades, {
      jsonrpc: "2.0",
      method: "runCmds",
      params: { version: 1, cmds: ["show hostname"], format: "text" },
      id: "9",
    }) as any;
    expect(text.result[0].output).toContain("Hostname: tor-a");
    const config = eapi(facades, {
      jsonrpc: "2.0",
      method: "runCmds",
      params: { version: 1, cmds: ["enable", "configure", "interface Ethernet1", "shutdown"] },
      id: "10",
    }) as any;
    expect(config.result).toEqual([{}, {}, {}, {}]);
    const link = linkOf(world, 0);
    expect(world.linkAdminDown(link.id, "to")).toBe(true);
  });

  test("eAPI fails a whole call with the error code eAPI uses", () => {
    const { facades } = boot(EOS);
    const bad = eapi(facades, {
      jsonrpc: "2.0",
      method: "runCmds",
      params: { version: 1, cmds: ["show hostname", "show frobnicate"] },
      id: "1",
    }) as any;
    expect(bad.error.code).toBe(1002);
    expect(bad.error.message).toBe("CLI command 2 of 2 'show frobnicate' failed: invalid command");
    expect(bad.error.data).toHaveLength(2);
    const unconverted = eapi(facades, {
      jsonrpc: "2.0",
      method: "runCmds",
      params: { version: 1, cmds: ["show clock"] },
      id: "2",
    }) as any;
    expect(unconverted.error.code).toBe(1003);
    expect(eapi(facades, { jsonrpc: "2.0", method: "other", id: "3" })).toMatchObject({
      error: { code: -32601 },
    });
  });

  test("each switch has only the HTTP API its OS has", () => {
    const nx = boot();
    expect(() => nx.facades.network.eapi("tor-a", {})).toThrow(/NX-API, not Arista eAPI/);
    expect(() => boot(EOS).facades.network.nxapi("tor-a", {})).toThrow(/eAPI, not Cisco NX-API/);
    expect(() => boot(IOS).facades.network.eapi("tor-a", {})).toThrow(/only the CLI/);
  });

  test("NX-API wraps one command in an object and several in a list, with a code for each", () => {
    const { facades } = boot();
    const one = facades.network.nxapi("tor-a", {
      ins_api: {
        version: "1.0",
        type: "cli_show",
        chunk: "0",
        sid: "1",
        input: "show version",
        output_format: "json",
      },
    }) as any;
    expect(one.ins_api.outputs.output).toMatchObject({
      input: "show version",
      msg: "Success",
      code: "200",
      body: { nxos_ver_str: "10.3(4a)" },
    });
    const many = facades.network.nxapi("tor-a", {
      ins_api: { version: "1.0", type: "cli_show", input: "show hostname ;show interface status" },
    }) as any;
    expect(many.ins_api.outputs.output).toHaveLength(2);
    expect(many.ins_api.outputs.output[1].body.TABLE_interface.ROW_interface[0]).toMatchObject({
      interface: "Ethernet1/1",
      state: "connected",
    });
    const ascii = facades.network.nxapi("tor-a", {
      ins_api: { version: "1.0", type: "cli_show_ascii", input: "show clock" },
    }) as any;
    expect(typeof ascii.ins_api.outputs.output.body).toBe("string");
  });

  test("NX-API reports command errors and unstructured output the way it does", () => {
    const { facades } = boot();
    const bad = facades.network.nxapi("tor-a", {
      ins_api: { version: "1.0", type: "cli_show", input: "show frobnicate" },
    }) as any;
    expect(bad.ins_api.outputs.output).toMatchObject({
      code: "400",
      msg: "Input CLI command error",
    });
    expect(bad.ins_api.outputs.output.clierror).toContain("Invalid command");
    const plain = facades.network.nxapi("tor-a", {
      ins_api: { version: "1.0", type: "cli_show", input: "show clock" },
    }) as any;
    expect(plain.ins_api.outputs.output.code).toBe("501");
    const wrong = facades.network.nxapi("tor-a", {
      ins_api: { version: "1.0", type: "cli_show", input: "shutdown" },
    }) as any;
    expect(wrong.ins_api.outputs.output.code).toBe("400");
  });

  test("NX-API configures in configuration mode and shuts a port", () => {
    const { facades, world } = boot();
    const r = facades.network.nxapi("tor-a", {
      ins_api: { version: "1.0", type: "cli_conf", input: "interface Ethernet1/1 ;shutdown" },
    }) as any;
    expect(r.ins_api.outputs.output.map((o: any) => o.code)).toEqual(["200", "200"]);
    const link = linkOf(world, 0);
    expect(world.linkAdminDown(link.id, "to")).toBe(true);
  });
});

describe("the network tools are protocol tools that act when they configure [REQ-062] [REQ-007]", () => {
  test("reading is observing, configuring is acting", () => {
    expect(callEffect("network_cli", { device: "s", commands: ["enable", "show version"] })).toBe(
      "observe",
    );
    expect(callEffect("network_cli", { device: "s", commands: ["shutdown"] })).toBe("act");
    expect(
      callEffect("network_cli", { device: "s", commands: ["show version"], configure: true }),
    ).toBe("act");
    expect(
      callEffect("eapi_request", { device: "s", body: { params: { cmds: ["show version"] } } }),
    ).toBe("observe");
    expect(
      callEffect("eapi_request", {
        device: "s",
        body: { params: { cmds: ["configure", "shutdown"] } },
      }),
    ).toBe("act");
    expect(
      callEffect("nxapi_request", { device: "s", body: { ins_api: { type: "cli_conf" } } }),
    ).toBe("act");
    expect(
      callEffect("nxapi_request", { device: "s", body: { ins_api: { type: "cli_show" } } }),
    ).toBe("observe");
  });
});
