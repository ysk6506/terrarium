/**
 * BACnet on cooling, plant and power equipment (REQ-060, ADR-0057): the services a building management
 * system uses (Who-Is, ReadProperty, ReadPropertyMultiple, WriteProperty with the priority array), answered
 * from the simulated world, with the standard's error classes and codes. A write to a cooling unit's
 * setpoint or enable changes what the physics does next.
 */
import { Catalog } from "@terrarium/core/catalog";
import { createFacades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { TOOL_NAMES, Toolbox, type ToolContext } from "@terrarium/core/tools";
import { type Blueprint, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../packages/core/src/world/test-support/sample";
import { campusBlueprint } from "../../packages/core/src/world/test-support/sample-campus";

function boot(bp: Blueprint = sampleBlueprint()) {
  const world = World.fromBlueprint(bp, new Catalog());
  const physics = new Physics(world);
  physics.settle();
  physics.run(600);
  const ctx: ToolContext = { world, facades: createFacades(world) };
  const tools = new Toolbox(TOOL_NAMES);
  const bacnet = (args: Record<string, unknown>) => {
    const r = tools.call("bacnet_request", args, ctx);
    expect(r.error).toBeUndefined();
    return r.data as any;
  };
  return { world, physics, bacnet };
}

const read = (
  bacnet: (a: Record<string, unknown>) => any,
  device: string,
  objectType: string,
  instance: number,
  property = "present-value",
  extra: Record<string, unknown> = {},
) => bacnet({ service: "read-property", device, objectType, instance, property, ...extra });

const write = (
  bacnet: (a: Record<string, unknown>) => any,
  device: string,
  objectType: string,
  instance: number,
  rest: Record<string, unknown>,
) =>
  bacnet({
    service: "write-property",
    device,
    objectType,
    instance,
    property: "present-value",
    ...rest,
  });

describe("BACnet discovery and reads [REQ-060] [REQ-002]", () => {
  test("Who-Is finds the cooling, power and UPS devices, and a range narrows it", () => {
    const { bacnet } = boot();
    const all = bacnet({ service: "who-is" });
    expect(all.service).toBe("i-am");
    const ids = all.devices.map((d: any) => d.entityId);
    expect(ids).toEqual(expect.arrayContaining(["crah-1", "crah-2", "panel-1", "ups-1"]));
    expect(ids).not.toContain("srv-a1");
    const instances = all.devices.map((d: any) => d.deviceIdentifier.instance);
    expect(new Set(instances).size).toBe(instances.length);
    const one = bacnet({ service: "who-is", low: instances[1], high: instances[1] });
    expect(one.devices).toHaveLength(1);
    expect(bacnet({ service: "who-is", device: "crah-1" }).devices[0]).toMatchObject({
      entityId: "crah-1",
      maxApduLengthAccepted: 1476,
      segmentationSupported: "no-segmentation",
    });
  });

  test("a cooling unit's analog inputs are the world's readings, with standard units", () => {
    const { world, bacnet } = boot();
    const s = world.stateAs("crah-1", "cooling_unit");
    const supply = read(bacnet, "crah-1", "analog-input", 1);
    expect(supply).toMatchObject({
      service: "read-property-ack",
      property: "present-value",
      propertyId: 85,
      value: { type: "real" },
    });
    expect(supply.value.value).toBeCloseTo(s.supplyC, 1);
    expect(read(bacnet, "crah-1", "analog-input", 1, "units").value).toMatchObject({
      type: "enumerated",
      value: 62,
      name: "degrees-celsius",
    });
    expect(read(bacnet, "crah-1", "analog-input", 3, "units").value.value).toBe(48);
    expect(read(bacnet, "crah-1", "analog-input", 4, "units").value.value).toBe(98);
    expect(read(bacnet, "crah-1", "analog-input", 2, "object-name").value.value).toBe(
      "Return-Air-Temp",
    );
    expect(read(bacnet, "crah-1", "binary-input", 1).value).toMatchObject({
      type: "enumerated",
      value: 1,
    });
  });

  test("the device object lists its objects, and array properties honour arrayIndex", () => {
    const { world, bacnet } = boot();
    const device = bacnet({ service: "who-is", device: "crah-1" }).devices[0].deviceIdentifier
      .instance;
    expect(read(bacnet, "crah-1", "device", device, "object-name").value.value).toBe(
      world.index.entity("crah-1").name,
    );
    const count = read(bacnet, "crah-1", "device", device, "object-list", { arrayIndex: 0 });
    expect(count.value).toMatchObject({ type: "unsigned" });
    expect(count.value.value).toBeGreaterThan(5);
    expect(
      read(bacnet, "crah-1", "device", device, "object-list", { arrayIndex: 1 }).value,
    ).toMatchObject({
      type: "object-identifier",
      value: { objectType: "device", instance: device },
    });
    expect(
      read(bacnet, "crah-1", "device", device, "object-list", { arrayIndex: 99 }),
    ).toMatchObject({
      errorClass: "property",
      errorCode: "invalid-array-index",
    });
    expect(
      read(bacnet, "crah-1", "analog-input", 1, "present-value", { arrayIndex: 1 }),
    ).toMatchObject({
      errorCode: "property-is-not-an-array",
    });
    expect(read(bacnet, "crah-1", "device", device, "vendor-identifier").value.value).toBe(0);
  });

  test("ReadPropertyMultiple reads several properties of several objects, and reports each failure on its own", () => {
    const { bacnet } = boot();
    const r = bacnet({
      service: "read-property-multiple",
      device: "crah-1",
      requests: [
        {
          objectType: "analog-input",
          instance: 1,
          properties: ["present-value", "units", "no-such-thing"],
        },
        { objectType: "analog-input", instance: 99, properties: ["present-value"] },
        { objectType: "binary-input", instance: 1, properties: ["all"] },
      ],
    });
    expect(r.service).toBe("read-property-multiple-ack");
    expect(r.results[0].results.map((x: any) => x.property)).toEqual([
      "present-value",
      "units",
      "no-such-thing",
    ]);
    expect(r.results[0].results[2].error).toMatchObject({ errorCode: "unknown-property" });
    expect(r.results[1].error).toMatchObject({ errorClass: "object", errorCode: "unknown-object" });
    expect(r.results[2].results.length).toBeGreaterThan(8);
  });

  test("errors carry the standard's class and code, with their numbers", () => {
    const { bacnet } = boot();
    expect(read(bacnet, "crah-1", "analog-input", 99)).toMatchObject({
      service: "error",
      errorClass: "object",
      errorClassId: 1,
      errorCode: "unknown-object",
      errorCodeId: 31,
    });
    expect(read(bacnet, "crah-1", "analog-input", 1, "nonsense")).toMatchObject({
      errorClass: "property",
      errorClassId: 2,
      errorCode: "unknown-property",
      errorCodeId: 32,
    });
  });
});

describe("BACnet writes and the priority array [REQ-060] [REQ-005]", () => {
  test("writing the setpoint changes the unit; the highest priority wins; relinquishing hands control back", () => {
    const { world, bacnet } = boot();
    expect(write(bacnet, "crah-1", "analog-value", 1, { value: 24, priority: 8 })).toEqual({
      service: "simple-ack",
    });
    expect(world.stateAs("crah-1", "cooling_unit").setpointC).toBe(24);
    write(bacnet, "crah-1", "analog-value", 1, { value: 18, priority: 16 });
    expect(world.stateAs("crah-1", "cooling_unit").setpointC).toBe(24);
    const slots = read(bacnet, "crah-1", "analog-value", 1, "priority-array").value.value;
    expect(slots).toHaveLength(16);
    expect(slots[7]).toMatchObject({ type: "real", value: 24 });
    expect(slots[15]).toMatchObject({ type: "real", value: 18 });
    expect(slots[0]).toEqual({ type: "null" });
    expect(
      read(bacnet, "crah-1", "analog-value", 1, "priority-array", { arrayIndex: 8 }).value.value,
    ).toBe(24);
    write(bacnet, "crah-1", "analog-value", 1, { relinquish: true, priority: 8 });
    expect(world.stateAs("crah-1", "cooling_unit").setpointC).toBe(18);
    write(bacnet, "crah-1", "analog-value", 1, { relinquish: true, priority: 16 });
    expect(world.stateAs("crah-1", "cooling_unit").setpointC).toBe(20);
    expect(read(bacnet, "crah-1", "analog-value", 1, "relinquish-default").value.value).toBe(20);
  });

  test("a setpoint outside the model's range, a wrong priority and a read-only point are refused", () => {
    const { world, bacnet } = boot();
    expect(write(bacnet, "crah-1", "analog-value", 1, { value: 5, priority: 8 })).toMatchObject({
      errorClass: "property",
      errorCode: "value-out-of-range",
    });
    expect(world.stateAs("crah-1", "cooling_unit").setpointC).toBe(20);
    expect(write(bacnet, "crah-1", "analog-value", 1, { value: 22, priority: 0 })).toMatchObject({
      errorClass: "services",
      errorCode: "parameter-out-of-range",
    });
    expect(write(bacnet, "crah-1", "analog-input", 1, { value: 1 })).toMatchObject({
      errorClass: "property",
      errorCode: "write-access-denied",
    });
    expect(
      bacnet({
        service: "write-property",
        device: "crah-1",
        objectType: "analog-value",
        instance: 1,
        property: "object-name",
        value: 1,
      }),
    ).toMatchObject({ errorCode: "write-access-denied" });
    expect(write(bacnet, "crah-1", "analog-value", 9, { value: 22 })).toMatchObject({
      errorCode: "unknown-object",
    });
  });

  test("the enable command stops and starts the unit", () => {
    const { world, physics, bacnet } = boot();
    expect(read(bacnet, "crah-1", "binary-output", 1).value).toMatchObject({
      value: 1,
      name: "active",
    });
    write(bacnet, "crah-1", "binary-output", 1, { value: 0, priority: 8 });
    physics.run(60);
    expect(world.stateAs("crah-1", "cooling_unit")).toMatchObject({
      adminOn: false,
      running: false,
    });
    expect(read(bacnet, "crah-1", "binary-input", 1).value.value).toBe(0);
    write(bacnet, "crah-1", "binary-output", 1, { relinquish: true, priority: 8 });
    physics.run(60);
    expect(world.stateAs("crah-1", "cooling_unit").running).toBe(true);
  });

  test("a device that lost its power does not answer", () => {
    const { world, physics, bacnet } = boot();
    world.apply(
      {
        type: "fault.add",
        fault: { id: "t", type: "breaker_trip", target: "panel-1", params: {} },
      },
      "test",
    );
    physics.run(60);
    expect(read(bacnet, "crah-1", "analog-input", 1)).toMatchObject({ timeout: true });
    expect(bacnet({ service: "who-is" }).devices.map((d: any) => d.entityId)).not.toContain(
      "crah-1",
    );
  });
});

describe("BACnet on plant equipment [REQ-060]", () => {
  test("CDU, chiller and generator expose their state as points", () => {
    const { world, bacnet } = boot(campusBlueprint());
    const cdu = world.stateAs("cdu-1", "cdu");
    expect(read(bacnet, "cdu-1", "analog-input", 1).value.value).toBeCloseTo(cdu.supplyC, 1);
    expect(read(bacnet, "cdu-1", "binary-input", 2, "object-name").value.value).toBe("Pump-1-OK");
    expect(write(bacnet, "cdu-1", "analog-value", 1, { value: 30 })).toMatchObject({
      errorCode: "write-access-denied",
    });
    const chiller = world.stateAs("chiller-1", "chiller");
    expect(read(bacnet, "chiller-1", "analog-input", 1).value.value).toBeCloseTo(
      chiller.supplyC,
      1,
    );
    expect(read(bacnet, "gen-1", "multi-state-input", 1).value).toMatchObject({
      type: "unsigned",
      value: 1,
    });
    expect(
      read(bacnet, "gen-1", "multi-state-input", 1, "state-text").value.value.map(
        (t: any) => t.value,
      ),
    ).toEqual(["standby", "starting", "running", "failed"]);
    expect(read(bacnet, "gen-1", "analog-input", 1, "units").value.value).toBe(98);
  });

  test("a power panel shows its breaker, and the UPS its battery", () => {
    const { world, physics, bacnet } = boot();
    expect(read(bacnet, "panel-1", "binary-input", 2).value.value).toBe(0);
    expect(read(bacnet, "ups-1", "analog-input", 1).value.value).toBeGreaterThanOrEqual(99);
    world.apply(
      {
        type: "fault.add",
        fault: { id: "o", type: "grid_outage", target: "ups-1", params: {} } as never,
      },
      "test",
    );
    physics.run(120);
    expect(read(bacnet, "ups-1", "binary-input", 1).value.value).toBe(1);
    expect(read(bacnet, "ups-1", "binary-input", 1, "event-state").value).toMatchObject({
      name: "offnormal",
    });
    expect(read(bacnet, "ups-1", "binary-input", 1, "status-flags").value.value["in-alarm"]).toBe(
      true,
    );
  });
});

describe("the numbers are the standard's [REQ-002]", () => {
  test("object types, properties, units, error classes and codes match ANSI/ASHRAE 135 (bacnet-stack bacenum.h)", async () => {
    const core = await import("@terrarium/core/facades");
    expect(core.BACNET_OBJECT_TYPE_ID).toEqual({
      "analog-input": 0,
      "analog-value": 2,
      "binary-input": 3,
      "binary-output": 4,
      "multi-state-input": 13,
      device: 8,
    });
    expect(core.BACNET_UNITS).toMatchObject({
      amperes: 3,
      "degrees-celsius": 62,
      kilowatts: 48,
      percent: 98,
      "no-units": 95,
    });
    expect(core.BACNET_PROPERTY_ID).toMatchObject({
      "present-value": 85,
      "object-name": 77,
      "object-identifier": 75,
      "status-flags": 111,
      "event-state": 36,
      "priority-array": 87,
      "relinquish-default": 104,
      units: 117,
      "object-list": 76,
      "vendor-name": 121,
      "vendor-identifier": 120,
    });
    expect(core.BACNET_ERROR_CLASS).toMatchObject({
      device: 0,
      object: 1,
      property: 2,
      resources: 3,
      security: 4,
      services: 5,
    });
    expect(core.BACNET_ERROR_CODE).toMatchObject({
      "unknown-object": 31,
      "unknown-property": 32,
      "write-access-denied": 40,
      "value-out-of-range": 37,
      "invalid-data-type": 9,
      "property-is-not-an-array": 50,
      "invalid-array-index": 42,
      "parameter-out-of-range": 80,
    });
  });
});
