/**
 * Controllability (REQ-069): everything an operator can change in the world is on one list (CONTROL_ROWS),
 * and the list is true. Each row's blocks, tools and action kinds exist; the kinds it says a command acts on are
 * exactly the kinds the world accepts it for; every route an agent has is driven here with a real tool call that
 * changes the world and is recorded as the action scoring sees. If a new command, a new powerable kind, or a new
 * action appears without a row, a test here fails.
 */
import { Catalog } from "@terrarium/core/catalog";
import {
  ACTION_KINDS,
  agentActions,
  BLOCK_SPECS,
  CONTROL_ROWS,
  type ControlRow,
  emptyScenario,
  FAULT_RESPONSES,
  matchesAction,
  NOT_OPERATOR,
  type ScenarioDoc,
} from "@terrarium/core/scenario";
import { Session } from "@terrarium/core/session";
import { TOOL_NAMES, TOOL_SPECS } from "@terrarium/core/tools";
import { type Blueprint, FAULT_SPECS, World, type WorldCommand } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { dbLab } from "../../packages/core/src/world/test-support/db-lab";
import { networkLab } from "../../packages/core/src/world/test-support/net-lab";
import { campusBlueprint } from "../../packages/core/src/world/test-support/sample-campus";
import { sdnLab } from "../../packages/core/src/world/test-support/sdn-lab";
import { serviceLab } from "../../packages/core/src/world/test-support/service-lab";

const rowOf = (id: string) => CONTROL_ROWS.find((r) => r.id === id) as ControlRow;

describe("the list of what can be controlled is made of real things [REQ-069]", () => {
  test("rows have unique ids and name only blocks, tools and actions that exist", () => {
    expect(new Set(CONTROL_ROWS.map((r) => r.id)).size).toBe(CONTROL_ROWS.length);
    const blocks = new Map(BLOCK_SPECS.map((b) => [b.type, b]));
    for (const row of CONTROL_ROWS) {
      for (const b of row.blocks)
        expect(blocks.get(b)?.status, `${row.id}: ${b}`).toBe("supported");
      for (const a of row.agent) expect(TOOL_NAMES, `${row.id}: ${a.tool}`).toContain(a.tool);
      for (const a of row.actions) expect(ACTION_KINDS, `${row.id}: ${a}`).toContain(a);
    }
  });

  test("every tool that changes the world is a route of some row, and no row lists one that does not", () => {
    const mutating = TOOL_SPECS.filter((t) => t.mutating).map((t) => t.name);
    const routed = new Set(CONTROL_ROWS.flatMap((r) => r.agent.map((a) => a.tool)));
    for (const tool of mutating) expect(routed.has(tool), tool).toBe(true);
    for (const tool of routed) expect(mutating, tool).toContain(tool);
  });

  test("a row an agent cannot reach says why; one it can reach is scored", () => {
    for (const row of CONTROL_ROWS) {
      if (row.agent.length === 0) {
        expect(row.note, row.id).toBeTruthy();
        expect(row.actions, row.id).toEqual([]);
      } else {
        expect(row.actions.length, row.id).toBeGreaterThan(0);
      }
    }
  });

  test("every world command is either on the list or named as no operator's", () => {
    const onList = new Set(CONTROL_ROWS.map((r) => r.command));
    for (const command of Object.keys(NOT_OPERATOR))
      expect(onList.has(command as never)).toBe(false);
    expect([...onList].sort()).toEqual([
      "breaker.reset",
      "db.failover",
      "db.promote",
      "db.restore",
      "firmware.update",
      "host.act",
      "ingress.restart",
      "link.admin",
      "load.set",
      "net.set",
      "outdoor.set",
      "outlet.set",
      "policy.revert",
      "policy.set",
      "power.set",
      "sdn.failover",
      "sdn.sync",
      "service.failover",
      "setpoint.set",
      "storage.path_switch",
      "vm.migrate",
    ]);
  });

  test("every action kind comes from some row, and every operation block is on a row or planned", () => {
    const actions = new Set(CONTROL_ROWS.flatMap((r) => r.actions));
    for (const a of ACTION_KINDS) expect(actions.has(a), a).toBe(true);
    const listed = new Set(CONTROL_ROWS.flatMap((r) => r.blocks));
    for (const b of BLOCK_SPECS.filter((s) => s.category === "operation"))
      expect(listed.has(b.type) || b.status === "planned", b.type).toBe(true);
  });

  test("every supported fault has an answer for what an agent can do about it", () => {
    const supported = FAULT_SPECS.filter((f) => f.status === "supported").map((f) => f.type);
    expect(Object.keys(FAULT_RESPONSES).sort()).toEqual(
      FAULT_SPECS.filter((f) => !isMistake(f.type))
        .map((f) => f.type)
        .sort(),
    );
    for (const type of supported.filter((t) => !isMistake(t))) {
      const answer = FAULT_RESPONSES[type as keyof typeof FAULT_RESPONSES];
      for (const via of answer.via)
        expect(
          CONTROL_ROWS.map((r) => r.id),
          type,
        ).toContain(via);
      expect(answer.via.length > 0, type).toBe(answer.remedy !== "diagnose");
    }
  });
});

const MISTAKES = new Set([
  "port_vlan_mismatch",
  "port_shutdown",
  "svi_shutdown",
  "bgp_neighbor_shutdown",
  "route_missing",
  "outlet_off",
]);
function isMistake(type: string): boolean {
  return MISTAKES.has(type);
}

describe("the kinds a row says it acts on are the kinds the world accepts [REQ-069]", () => {
  const bp = campusBlueprint();
  const kinds = [...new Set(bp.entities.map((e) => e.kind))];

  /** Which kinds of entity in the campus world accept the command, found by trying it on each. */
  function accepted(command: (id: string) => WorldCommand): string[] {
    const out = new Set<string>();
    for (const entity of bp.entities) {
      const world = World.fromBlueprint(bp, new Catalog());
      try {
        world.apply(command(entity.id), "probe");
        out.add(entity.kind);
      } catch {
        // refused: not this kind
      }
    }
    return [...out].sort();
  }

  const claimed = (command: string) =>
    [
      ...new Set(CONTROL_ROWS.filter((r) => r.command === command).flatMap((r) => r.targets)),
    ].sort();

  test.each([
    ["power.set", (id: string): WorldCommand => ({ type: "power.set", target: id, on: false })],
    [
      "setpoint.set",
      (id: string): WorldCommand => ({ type: "setpoint.set", target: id, celsius: 20 }),
    ],
    ["breaker.reset", (id: string): WorldCommand => ({ type: "breaker.reset", target: id })],
    [
      "outlet.set",
      (id: string): WorldCommand => ({ type: "outlet.set", target: id, outlet: 1, on: false }),
    ],
    ["load.set", (id: string): WorldCommand => ({ type: "load.set", target: id, value: 0.5 })],
    ["db.promote", (id: string): WorldCommand => ({ type: "db.promote", target: id })],
    ["db.failover", (id: string): WorldCommand => ({ type: "db.failover", target: id })],
    [
      "db.restore",
      (id: string): WorldCommand => ({ type: "db.restore", target: id, backup: "latest" }),
    ],
    [
      "storage.path_switch",
      (id: string): WorldCommand => ({ type: "storage.path_switch", target: id }),
    ],
  ])("%s", (name, command) => {
    expect(accepted(command)).toEqual(claimed(name));
  });

  test("the campus world has every kind that matters, so the probe above means something", () => {
    for (const k of [
      "server",
      "vm",
      "switch",
      "storage",
      "cooling_unit",
      "chiller",
      "cdu",
      "generator",
      "pdu",
      "power_panel",
    ])
      expect(kinds).toContain(k);
  });
});

// ── driving each route ─────────────────────────────────────────────────────────────────────────

interface Drive {
  readonly world: () => Blueprint;
  readonly tool: string;
  readonly args: Record<string, unknown>;
  /** Make the world ready (trip the breaker that the reset will clear). */
  readonly before?: (world: World) => void;
  /** The change the world shows afterwards. */
  readonly changed: (world: World) => boolean;
  readonly action: { kind: string; target: string };
}

const redfishReset = (type: string) => ({
  server: "srv-a1",
  method: "POST",
  path: "/redfish/v1/Systems/System.Embedded.1/Actions/ComputerSystem.Reset",
  body: { ResetType: type },
});
const bacnetWrite = (device: string, objectType: string, instance: number, value: number) => ({
  service: "write-property",
  device,
  objectType,
  instance,
  property: "present-value",
  value,
  priority: 8,
});
const off =
  (id: string, kind: "server" | "cooling_unit" | "vm" | "chiller" | "cdu" | "generator") =>
  (w: World) =>
    !(w.stateAs(id, kind as never) as { adminOn: boolean }).adminOn;
const tripped = (w: World) =>
  w.apply(
    { type: "fault.add", fault: { id: "trip", type: "breaker_trip", target: "pdu-a", params: {} } },
    "test",
  );
const eosPort = { cmds: ["enable", "configure", "interface Ethernet1", "shutdown"] };
const portDown = (device: string) => (w: World) =>
  w.index.allLinks().some((l) => (l.from === device || l.to === device) && w.linkAdminDown(l.id));

/** One call per (row, tool). The key is `row|tool|target` so a row with several targets drives each. */
const DRIVES: Record<string, Drive> = {
  "power.server|power_server": {
    world: campusBlueprint,
    tool: "power_server",
    args: { id: "srv-a1", action: "off" },
    changed: off("srv-a1", "server"),
    action: { kind: "power_off", target: "srv-a1" },
  },
  "power.server|redfish_request": {
    world: campusBlueprint,
    tool: "redfish_request",
    args: redfishReset("ForceOff"),
    changed: off("srv-a1", "server"),
    action: { kind: "power_off", target: "srv-a1" },
  },
  "power.vm|vcenter_request": {
    world: campusBlueprint,
    tool: "vcenter_request",
    args: { method: "POST", path: "/api/vcenter/vm/vm-web/power", query: { action: "stop" } },
    changed: off("vm-web", "vm"),
    action: { kind: "power_off", target: "vm-web" },
  },
  "power.cooling|restart_cooling_unit": {
    world: campusBlueprint,
    tool: "restart_cooling_unit",
    args: { unitId: "crah-1" },
    changed: (w) =>
      w.events().some((e) => e.type === "power.set" && e.target === "crah-1" && !e.on),
    action: { kind: "restart", target: "crah-1" },
  },
  "power.cooling|bacnet_request": {
    world: campusBlueprint,
    tool: "bacnet_request",
    args: bacnetWrite("crah-1", "binary-output", 1, 0),
    changed: off("crah-1", "cooling_unit"),
    action: { kind: "power_off", target: "crah-1" },
  },
  "power.plant|bacnet_request|chiller-1": {
    world: campusBlueprint,
    tool: "bacnet_request",
    args: bacnetWrite("chiller-1", "binary-output", 1, 0),
    changed: off("chiller-1", "chiller"),
    action: { kind: "power_off", target: "chiller-1" },
  },
  "power.plant|bacnet_request|cdu-1": {
    world: campusBlueprint,
    tool: "bacnet_request",
    args: bacnetWrite("cdu-1", "binary-output", 1, 0),
    changed: off("cdu-1", "cdu"),
    action: { kind: "power_off", target: "cdu-1" },
  },
  "power.plant|bacnet_request|gen-1": {
    world: campusBlueprint,
    tool: "bacnet_request",
    args: bacnetWrite("gen-1", "binary-output", 1, 0),
    changed: off("gen-1", "generator"),
    action: { kind: "power_off", target: "gen-1" },
  },
  "cooling.setpoint|set_cooling_setpoint": {
    world: campusBlueprint,
    tool: "set_cooling_setpoint",
    args: { unitId: "crah-1", celsius: 19 },
    changed: (w) => w.stateAs("crah-1", "cooling_unit").setpointC === 19,
    action: { kind: "setpoint_change", target: "crah-1" },
  },
  "cooling.setpoint|bacnet_request": {
    world: campusBlueprint,
    tool: "bacnet_request",
    args: bacnetWrite("crah-1", "analog-value", 1, 19),
    changed: (w) => w.stateAs("crah-1", "cooling_unit").setpointC === 19,
    action: { kind: "setpoint_change", target: "crah-1" },
  },
  "breaker.reset|reset_breaker": {
    world: campusBlueprint,
    tool: "reset_breaker",
    args: { id: "pdu-a" },
    before: tripped,
    changed: (w) => w.faultsOn("pdu-a").length === 0,
    action: { kind: "breaker_reset", target: "pdu-a" },
  },
  "breaker.reset|redfish_request": {
    world: campusBlueprint,
    tool: "redfish_request",
    args: {
      server: "pdu-a",
      method: "POST",
      path: "/redfish/v1/PowerEquipment/RackPDUs/1/Mains/1/Actions/Circuit.BreakerControl",
      body: { PowerState: "On" },
    },
    before: tripped,
    changed: (w) => w.faultsOn("pdu-a").length === 0,
    action: { kind: "breaker_reset", target: "pdu-a" },
  },
  "power.outlet|redfish_request": {
    world: campusBlueprint,
    tool: "redfish_request",
    args: {
      server: "pdu-a",
      method: "POST",
      path: "/redfish/v1/PowerEquipment/RackPDUs/1/Outlets/1/Actions/Outlet.PowerControl",
      body: { PowerState: "Off" },
    },
    changed: (w) => (w.stateAs("pdu-a", "pdu").outletsOff ?? []).includes(1),
    action: { kind: "outlet_off", target: "pdu-a" },
  },
  "firmware.update|redfish_request": {
    world: campusBlueprint,
    tool: "redfish_request",
    args: {
      server: "srv-a1",
      method: "POST",
      path: "/redfish/v1/UpdateService/Actions/UpdateService.SimpleUpdate",
      body: { ImageURI: "http://repo/fw/bios-2.4.1.bin" },
    },
    changed: (w) => w.stateAs("srv-a1", "server").fw?.version === "2.4.1",
    action: { kind: "firmware_update", target: "srv-a1" },
  },
  "network.port|network_cli": {
    world: networkLab,
    tool: "network_cli",
    args: { device: "tor-a", commands: ["interface Ethernet1/1", "shutdown"], configure: true },
    changed: portDown("tor-a"),
    action: { kind: "port_shutdown", target: "tor-a" },
  },
  "network.port|eapi_request": {
    world: networkLab,
    tool: "eapi_request",
    args: {
      device: "sp1",
      body: { jsonrpc: "2.0", method: "runCmds", params: { version: 1, ...eosPort }, id: "1" },
    },
    changed: portDown("sp1"),
    action: { kind: "port_shutdown", target: "sp1" },
  },
  "network.port|nxapi_request": {
    world: networkLab,
    tool: "nxapi_request",
    args: {
      device: "tor-a",
      body: {
        ins_api: { version: "1.0", type: "cli_conf", input: "interface Ethernet1/1 ;shutdown" },
      },
    },
    changed: portDown("tor-a"),
    action: { kind: "port_shutdown", target: "tor-a" },
  },
  "network.port|snmp_request": {
    world: networkLab,
    tool: "snmp_request",
    args: {
      device: "tor-a",
      operation: "set",
      community: "private",
      values: [{ oid: "ifAdminStatus.1", type: "INTEGER", value: 2 }],
    },
    changed: portDown("tor-a"),
    action: { kind: "port_shutdown", target: "tor-a" },
  },
  "network.config|network_cli": {
    world: networkLab,
    tool: "network_cli",
    args: {
      device: "tor-a",
      commands: ["interface Ethernet1/1", "switchport access vlan 101"],
      configure: true,
    },
    changed: (w) => w.events().some((e) => e.type === "net.set" && e.target === "tor-a"),
    action: { kind: "config_change", target: "tor-a" },
  },
  "network.config|eapi_request": {
    world: networkLab,
    tool: "eapi_request",
    args: {
      device: "sp1",
      body: {
        jsonrpc: "2.0",
        method: "runCmds",
        params: { version: 1, cmds: ["enable", "configure", "interface Vlan100", "shutdown"] },
        id: "1",
      },
    },
    changed: (w) => w.events().some((e) => e.type === "net.set" && e.target === "sp1"),
    action: { kind: "config_change", target: "sp1" },
  },
  "network.config|nxapi_request": {
    world: networkLab,
    tool: "nxapi_request",
    args: {
      device: "tor-a",
      body: {
        ins_api: {
          version: "1.0",
          type: "cli_conf",
          input: "interface Ethernet1/1 ;switchport access vlan 101",
        },
      },
    },
    changed: (w) => w.events().some((e) => e.type === "net.set" && e.target === "tor-a"),
    action: { kind: "config_change", target: "tor-a" },
  },
};

// The service and operating-system routes (REQ-086, REQ-087, ADR-0091), in a world with three services.
const hostAct = (target: string, action: string) => (w: World) =>
  w
    .events()
    .some(
      (e) =>
        e.type === "host.act" &&
        (e as { target?: string }).target === target &&
        (e as { action?: string }).action === action,
    );
const happened = (type: string, target: string) => (w: World) =>
  w.events().some((e) => e.type === type && (e as { target?: string }).target === target);
const shell = (cmd: string) => ({ host: "vm-web", cmd });

Object.assign(DRIVES, {
  "host.process|run_command": {
    world: serviceLab,
    tool: "run_command",
    args: shell("systemctl restart portal"),
    changed: hostAct("vm-web", "restart"),
    action: { kind: "process_restart", target: "vm-web" },
  },
  "host.process|restart_service": {
    world: serviceLab,
    tool: "restart_service",
    args: { service: "svc-web" },
    changed: happened("service.restart", "svc-web"),
    action: { kind: "service_restart", target: "svc-web" },
  },
  "host.disk|run_command": {
    world: serviceLab,
    tool: "run_command",
    args: shell("rm /var/log/messages-20251221"),
    changed: hostAct("vm-web", "remove"),
    action: { kind: "disk_cleanup", target: "vm-web" },
  },
  "host.remount|run_command": {
    world: serviceLab,
    tool: "run_command",
    args: shell("mount -o remount,rw /"),
    changed: hostAct("vm-web", "remount_rw"),
    action: { kind: "fs_remount", target: "vm-web" },
  },
  "host.reboot|run_command": {
    world: serviceLab,
    tool: "run_command",
    args: shell("reboot"),
    changed: hostAct("vm-web", "reboot"),
    action: { kind: "restart", target: "vm-web" },
  },
  "service.failover|failover_service": {
    world: serviceLab,
    tool: "failover_service",
    args: { service: "svc-web" },
    changed: happened("service.failover", "svc-web"),
    action: { kind: "service_failover", target: "svc-web" },
  },
  "vm.migrate|migrate_vm": {
    world: serviceLab,
    tool: "migrate_vm",
    args: { vm: "vm-web", host: "srv-b1" },
    changed: happened("vm.migrate", "vm-web"),
    action: { kind: "vm_migrate", target: "vm-web" },
  },
  "host.database|run_command": {
    world: () => dbLab({ shape: "replicated" }),
    tool: "run_command",
    args: { host: "vm-db-2", cmd: "systemctl restart postgresql" },
    changed: hostAct("vm-db-2", "restart"),
    action: { kind: "process_restart", target: "vm-db-2" },
  },
  "db.promote|db_promote": {
    world: () => dbLab({ shape: "replicated" }),
    tool: "db_promote",
    args: { instance: "db-2" },
    changed: happened("db.promote", "db-2"),
    action: { kind: "db_promote", target: "db-2" },
  },
  "db.failover|db_failover": {
    world: () => dbLab({ shape: "replicated" }),
    tool: "db_failover",
    args: { cluster: "db-main" },
    changed: happened("db.failover", "db-main"),
    action: { kind: "db_failover", target: "db-main" },
  },
  "db.restore|db_restore": {
    world: () => dbLab({ shape: "replicated" }),
    tool: "db_restore",
    args: { instance: "db-2", backup: "latest" },
    changed: happened("db.restore", "db-2"),
    action: { kind: "db_restore", target: "db-2" },
  },
  "storage.path|storage_path_switch": {
    world: () => dbLab({ shape: "replicated", storage: "dual" }),
    tool: "storage_path_switch",
    args: { controller: "ctl-b" },
    changed: happened("storage.path_switch", "ctl-b"),
    action: { kind: "path_switch", target: "ctl-b" },
  },
  "host.cni|run_command": {
    world: () => sdnLab({ cloudNative: true }),
    tool: "run_command",
    args: shell("systemctl restart calico-node"),
    changed: hostAct("vm-web", "restart"),
    action: { kind: "process_restart", target: "vm-web" },
  },
  "sdn.sync|sdn_sync": {
    world: () => sdnLab(),
    tool: "sdn_sync",
    args: { switch: "tor-a" },
    changed: happened("sdn.sync", "tor-a"),
    action: { kind: "sdn_sync", target: "tor-a" },
  },
  "sdn.failover|sdn_failover": {
    world: () => sdnLab(),
    tool: "sdn_failover",
    args: { controller: "sdn-ctl-2" },
    changed: happened("sdn.failover", "sdn-ctl-2"),
    action: { kind: "sdn_failover", target: "sdn-ctl-2" },
  },
  "policy.revert|policy_revert": {
    world: () => sdnLab({ cloudNative: true }),
    tool: "policy_revert",
    args: { policy: "np-license" },
    before: (w) =>
      void w.apply({ type: "policy.set", target: "np-license", rule: "deny" }, "scenario"),
    changed: happened("policy.revert", "np-license"),
    action: { kind: "policy_revert", target: "np-license" },
  },
  "ingress.restart|ingress_restart": {
    world: () => sdnLab({ cloudNative: true }),
    tool: "ingress_restart",
    args: { ingress: "ingress-portal" },
    changed: happened("ingress.restart", "ingress-portal"),
    action: { kind: "ingress_restart", target: "ingress-portal" },
  },
} satisfies Record<string, Drive>);

const keyOf = (row: ControlRow, tool: string) => `${row.id}|${tool}`;
const driveKeys = (row: ControlRow, tool: string) =>
  Object.keys(DRIVES).filter((k) => k === keyOf(row, tool) || k.startsWith(`${keyOf(row, tool)}|`));

function quiet(world: Blueprint): ScenarioDoc {
  return {
    ...emptyScenario("drive", "w"),
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
    expectations: [{ id: "budget", kind: "tool_budget", maxCalls: 5, weight: 1 }],
    worldId: world.id ?? "w",
  };
}

describe("an agent really controls each thing on the list [REQ-069] [REQ-007]", () => {
  test("every route on the list has a drive here, and every drive belongs to a route", () => {
    const wanted = CONTROL_ROWS.flatMap((r) => r.agent.map((a) => keyOf(r, a.tool)));
    for (const key of wanted)
      expect(
        Object.keys(DRIVES).some((k) => k === key || k.startsWith(`${key}|`)),
        key,
      ).toBe(true);
    for (const key of Object.keys(DRIVES)) {
      const [row, tool] = key.split("|") as [string, string];
      expect(
        rowOf(row).agent.map((a) => a.tool),
        key,
      ).toContain(tool);
    }
    expect(driveKeys(rowOf("power.plant"), "bacnet_request")).toHaveLength(3);
  });

  test.each(Object.entries(DRIVES))(
    "%s changes the world and is scored as the action it is",
    (key, drive) => {
      const bp = drive.world();
      const session = Session.create({
        blueprint: bp,
        scenario: quiet(bp),
        tools: TOOL_NAMES,
        seed: 1,
      });
      session.start();
      drive.before?.(session.world);
      expect(drive.changed(session.world), "not already changed").toBe(false);
      const result = session.call(drive.tool, drive.args) as { ok?: boolean; error?: unknown };
      expect(result.ok ?? true, JSON.stringify(result).slice(0, 300)).not.toBe(false);
      expect(drive.changed(session.world), key).toBe(true);
      const done = session.finish();
      const actions = agentActions(done.toolCalls);
      const [row] = key.split("|") as [string];
      expect(
        actions.some((a) => matchesAction(a, drive.action.kind as never, drive.action.target)),
        `${key}: ${JSON.stringify(actions)}`,
      ).toBe(true);
      expect(rowOf(row).actions).toContain(drive.action.kind);
    },
  );
});
