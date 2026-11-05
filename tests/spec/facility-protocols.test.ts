/**
 * Power, cooling and network equipment over the protocols real equipment speaks (REQ-060, ADR-0057): a
 * UPS answers SNMP UPS-MIB, a switch IF-MIB, cooling and plant equipment BACnet, a PDU or CDU Redfish.
 * Each answer comes from the physically simulated world, and the writes change what the physics does next.
 */
import { Catalog } from "@terrarium/core/catalog";
import { createFacades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import {
  callEffect,
  callTargets,
  TOOL_NAMES,
  Toolbox,
  type ToolContext,
} from "@terrarium/core/tools";
import { type Blueprint, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../packages/core/src/world/test-support/sample";

const catalog = new Catalog();

function boot(bp: Blueprint = sampleBlueprint()) {
  const world = World.fromBlueprint(bp, catalog);
  const physics = new Physics(world);
  physics.settle();
  physics.run(600);
  const facades = createFacades(world);
  const ctx: ToolContext = { world, facades };
  const tools = new Toolbox(TOOL_NAMES);
  const call = (name: string, args: Record<string, unknown>) => {
    const r = tools.call(name, args, ctx);
    expect(r.error).toBeUndefined();
    return r.data as any;
  };
  const snmp = (device: string, args: Record<string, unknown>) =>
    call("snmp_request", { device, ...args });
  const bacnet = (args: Record<string, unknown>) => call("bacnet_request", args);
  return { world, physics, tools, ctx, call, snmp, bacnet };
}

const fault = (world: World, id: string, type: string, target: string, params = {}) =>
  world.apply({ type: "fault.add", fault: { id, type, target, params } as never }, "test");

const valuesOf = (reply: { varbinds: Array<{ value?: unknown; exception?: string }> }) =>
  reply.varbinds.map((b) => b.value ?? b.exception);

describe("SNMP: the UPS network card speaks UPS-MIB (RFC 1628) [REQ-060] [REQ-002]", () => {
  test("a healthy UPS reports normal battery, mains output and full charge", () => {
    const { snmp } = boot();
    const r = snmp("ups-1", {
      operation: "get",
      oids: [
        "sysDescr.0",
        "UPS-MIB::upsBatteryStatus.0",
        "upsOutputSource.0",
        "1.3.6.1.2.1.33.1.2.4.0",
        "upsAlarmsPresent.0",
      ],
    });
    expect(r).toMatchObject({ version: "2c", errorStatus: "noError", errorIndex: 0 });
    expect(r.varbinds[0].value).toContain("UPS 500kVA");
    expect(r.varbinds[1]).toMatchObject({ value: 2, label: "batteryNormal", type: "INTEGER" });
    expect(r.varbinds[2]).toMatchObject({ value: 3, label: "normal" });
    expect(r.varbinds[3].value).toBeGreaterThanOrEqual(99);
    expect(r.varbinds[4]).toMatchObject({ value: 0, type: "Gauge32" });
  });

  test("a grid outage shows as battery output, a falling charge and an upsAlarmOnBattery row", () => {
    const { world, physics, snmp } = boot();
    fault(world, "out", "grid_outage", "ups-1");
    physics.run(300);
    const state = world.stateAs("ups-1", "ups");
    expect(state.onBattery).toBe(true);
    const r = snmp("ups-1", {
      operation: "get",
      oids: [
        "upsOutputSource.0",
        "upsEstimatedChargeRemaining.0",
        "upsSecondsOnBattery.0",
        "upsAlarmsPresent.0",
        "upsAlarmDescr.1",
        "upsInputLineBads.0",
        "upsEstimatedMinutesRemaining.0",
      ],
    });
    expect(r.varbinds[0]).toMatchObject({ value: 5, label: "battery" });
    expect(r.varbinds[1].value).toBe(Math.round(state.batteryPct));
    expect(r.varbinds[2].value).toBeGreaterThan(0);
    expect(r.varbinds[3].value).toBeGreaterThanOrEqual(1);
    expect(r.varbinds[4]).toMatchObject({
      type: "OBJECT IDENTIFIER",
      value: "1.3.6.1.2.1.33.1.6.3.2",
    });
    expect(r.varbinds[5].value).toBe(1);
    expect(r.varbinds[6].value).toBeGreaterThan(0);
  });

  test("the battery reads low once the charge falls under the threshold the alarm uses", () => {
    const { world, physics, snmp } = boot();
    fault(world, "out", "grid_outage", "ups-1");
    fault(world, "weak", "ups_battery_degraded", "ups-1", { factor: 0.05 });
    for (let i = 0; i < 200 && world.stateAs("ups-1", "ups").batteryPct >= 19; i++) physics.run(60);
    const status = snmp("ups-1", { operation: "get", oids: ["upsBatteryStatus.0"] }).varbinds[0];
    expect(status).toMatchObject({ value: 3, label: "batteryLow" });
    const codes = snmp("ups-1", { operation: "walk", oids: ["upsAlarmDescr"] }).varbinds.map(
      (b: any) => b.value,
    );
    expect(codes).toContain("1.3.6.1.2.1.33.1.6.3.3");
  });

  test("walk, getnext and getbulk agree, in strictly increasing OID order", () => {
    const { snmp } = boot();
    const walk = snmp("ups-1", { operation: "walk", oids: ["upsMIB"] }).varbinds;
    expect(walk.length).toBeGreaterThan(15);
    const nums = walk.map((b: any) => b.oid.split(".").map(Number));
    for (let i = 1; i < nums.length; i++) {
      const [a, b] = [nums[i - 1], nums[i]];
      const at = a.findIndex((n: number, k: number) => n !== b[k]);
      expect(at < 0 ? a.length - b.length : a[at] - b[at]).toBeLessThan(0);
    }
    const next = snmp("ups-1", { operation: "getnext", oids: ["upsMIB"] }).varbinds[0];
    expect(next.oid).toBe(walk[0].oid);
    const bulk = snmp("ups-1", {
      operation: "getbulk",
      oids: ["upsMIB"],
      nonRepeaters: 0,
      maxRepetitions: 5,
    }).varbinds;
    expect(bulk.map((b: any) => b.oid)).toEqual(walk.slice(0, 5).map((b: any) => b.oid));
    const end = snmp("ups-1", { operation: "getnext", oids: [walk[walk.length - 1].oid] });
    expect(end.varbinds[0].exception).toBe("endOfMibView");
  });

  test("objects the world has no number for answer noSuchInstance; unknown OIDs noSuchObject", () => {
    const { snmp } = boot();
    const r = snmp("ups-1", {
      operation: "get",
      oids: ["upsBatteryVoltage.0", "1.3.6.1.2.1.33.1.2.99.0", "1.3.6.1.4.1.5.5.0"],
    });
    expect(valuesOf(r)).toEqual(["noSuchInstance", "noSuchObject", "noSuchObject"]);
  });

  test("communities: public reads, private also writes, anything else gets no answer", () => {
    const { snmp } = boot();
    expect(
      snmp("ups-1", { operation: "get", oids: ["sysName.0"], community: "wrong" }),
    ).toMatchObject({
      timeout: true,
    });
    const denied = snmp("ups-1", {
      operation: "set",
      values: [{ oid: "sysName.0", type: "OCTET STRING", value: "x" }],
    });
    expect(denied.errorStatus).toBe("noAccess");
    const set = snmp("ups-1", {
      operation: "set",
      community: "private",
      values: [{ oid: "sysName.0", type: "OCTET STRING", value: "ups-main" }],
    });
    expect(set.errorStatus).toBe("noError");
    expect(snmp("ups-1", { operation: "get", oids: ["sysName.0"] }).varbinds[0].value).toBe(
      "ups-main",
    );
    const readOnly = snmp("ups-1", {
      operation: "set",
      community: "private",
      values: [
        { oid: "sysLocation.0", type: "OCTET STRING", value: "moved" },
        { oid: "upsBatteryStatus.0", type: "INTEGER", value: 2 },
      ],
    });
    expect(readOnly).toMatchObject({ errorStatus: "notWritable", errorIndex: 2 });
    expect(snmp("ups-1", { operation: "get", oids: ["sysLocation.0"] }).varbinds[0].value).not.toBe(
      "moved",
    );
  });

  test("a UPS without input and battery is silent", () => {
    const { world, physics, snmp } = boot();
    fault(world, "out", "grid_outage", "ups-1");
    fault(world, "weak", "ups_battery_degraded", "ups-1", { factor: 0.05 });
    for (let i = 0; i < 3000 && world.stateAs("ups-1", "ups").batteryPct > 0; i++) physics.run(60);
    expect(snmp("ups-1", { operation: "get", oids: ["sysName.0"] })).toMatchObject({
      timeout: true,
    });
  });
});

describe("SNMP: switches speak IF-MIB (RFC 2863) [REQ-060] [REQ-002]", () => {
  test("ports are named after the links and follow their state", () => {
    const { world, physics, snmp } = boot();
    const ports = snmp("tor-a", {
      operation: "get",
      oids: ["ifNumber.0", "ifDescr.1", "ifOperStatus.1"],
    });
    expect(ports.varbinds[0].value).toBeGreaterThanOrEqual(4);
    expect(ports.varbinds[1].value).toBe("Ethernet1/1");
    expect(ports.varbinds[2]).toMatchObject({ value: 1, label: "up" });
    const first = world.index.incoming("tor-a", "network")[0]?.id as string;
    fault(world, "cut", "link_down", first);
    physics.run(30);
    expect(snmp("tor-a", { operation: "get", oids: ["ifOperStatus.1"] }).varbinds[0]).toMatchObject(
      {
        value: 2,
        label: "down",
      },
    );
    const last = snmp("tor-a", { operation: "get", oids: ["ifNumber.0"] }).varbinds[0].value;
    expect(
      snmp("tor-a", { operation: "get", oids: [`ifOperStatus.${last}`] }).varbinds[0].value,
    ).toBe(2);
  });

  test("an unpowered switch does not answer", () => {
    const { world, physics, snmp } = boot();
    fault(world, "trip", "breaker_trip", "pdu-a");
    physics.run(60);
    expect(snmp("tor-a", { operation: "get", oids: ["sysName.0"] })).toMatchObject({
      timeout: true,
    });
  });
});

describe("each kind of equipment answers on its own protocol [REQ-060]", () => {
  test("the wrong protocol gets the answer a real device gives, with what it does speak", () => {
    const { tools, ctx } = boot();
    const asked = (name: string, args: Record<string, unknown>) => tools.call(name, args, ctx);
    expect(
      asked("snmp_request", { device: "crah-1", operation: "get", oids: ["sysName.0"] }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("BACnet"),
    });
    expect(asked("bacnet_request", { device: "srv-a1", service: "read-property" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("Redfish"),
    });
    expect(
      asked("snmp_request", { device: "nothing", operation: "get", oids: ["sysName.0"] }).ok,
    ).toBe(false);
  });

  test("the tools check their arguments and say what they do to the world", () => {
    const { tools, ctx } = boot();
    const bad = tools.call(
      "snmp_request",
      { device: "ups-1", operation: "get", oids: "sysName.0" },
      ctx,
    );
    expect(bad.error).toMatch(/array/);
    expect(callTargets("snmp_request", { device: "ups-1" })).toEqual(["ups-1"]);
    expect(callTargets("bacnet_request", { device: "crah-1" })).toEqual(["crah-1"]);
    expect(callEffect("snmp_request", { operation: "get" })).toBe("observe");
    expect(callEffect("snmp_request", { operation: "set" })).toBe("act");
    expect(callEffect("bacnet_request", { service: "read-property" })).toBe("observe");
    expect(callEffect("bacnet_request", { service: "write-property" })).toBe("act");
  });

  test("a PDU's Redfish service is reached through redfish_request", () => {
    const { call } = boot();
    const root = call("redfish_request", { server: "pdu-a", method: "GET", path: "/redfish/v1" });
    expect(root.status).toBe(200);
    expect(root.body).toMatchObject({
      PowerEquipment: { "@odata.id": "/redfish/v1/PowerEquipment" },
    });
  });
});
