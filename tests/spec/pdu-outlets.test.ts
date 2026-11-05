/**
 * PDU outlet control (REQ-063, ADR-0060): an operator, or an agent over Redfish `Outlet.PowerControl`, switches
 * one outlet of a rack PDU off or on. The device on that cable loses that feed; a device with a second feed
 * keeps running, a device with only that feed goes dark and raises its alarm.
 */
import { Catalog } from "@terrarium/core/catalog";
import { type FacadeRequest, RedfishFacade } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { ProfileRegistry } from "@terrarium/core/profiles";
import { actionsOf } from "@terrarium/core/scenario";
import { type Blueprint, outletCount, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint, withChanges } from "../../packages/core/src/world/test-support/sample";
import { schemaErrors } from "./redfish-schemas/validator";

const catalog = new Catalog();

/** srv-a1 gets a second feed from pdu-b; srv-a2 and tor-a keep a single feed from pdu-a. */
function dualFed(): Blueprint {
  const bp = sampleBlueprint();
  return withChanges(bp, {
    links: [{ id: "l-extra-feed", kind: "power", from: "srv-a1", to: "pdu-b", props: {} }],
  });
}

function boot(bp: Blueprint = dualFed()) {
  const world = World.fromBlueprint(bp, catalog);
  const physics = new Physics(world);
  physics.settle();
  physics.run(300);
  const redfish = new RedfishFacade(world, new ProfileRegistry());
  return { world, physics, redfish };
}

const req = (method: FacadeRequest["method"], path: string, body?: unknown): FacadeRequest => ({
  method,
  path,
  query: {},
  headers: {},
  body,
});

const OUTLETS = "/redfish/v1/PowerEquipment/RackPDUs/1/Outlets";
const off = (outlet: number, on = false) =>
  ({ type: "outlet.set", target: "pdu-a", outlet, on }) as const;

describe("switching an outlet changes who is fed [REQ-063] [REQ-002]", () => {
  test("a device with one feed goes dark when its outlet is switched off, and comes back when it is switched on", () => {
    const { world, physics } = boot();
    expect(world.stateAs("srv-a2", "server").powered).toBe(true);
    world.apply(off(2), "test");
    physics.run(30);
    expect(world.stateAs("srv-a2", "server").powered).toBe(false);
    expect(world.stateAs("srv-a1", "server").powered).toBe(true);
    expect(
      world.alarms().some((a) => a.code === "server_power_lost" && a.entityId === "srv-a2"),
    ).toBe(true);
    world.apply(off(2, true), "test");
    physics.run(300);
    expect(world.stateAs("srv-a2", "server").powered).toBe(true);
  });

  test("a device with a second feed keeps running, and the PDU it left carries less", () => {
    const { world, physics } = boot();
    const before = world.stateAs("pdu-a", "pdu").loadW;
    world.apply(off(1), "test");
    physics.run(60);
    expect(world.stateAs("srv-a1", "server").powered).toBe(true);
    expect(world.stateAs("pdu-a", "pdu").loadW).toBeLessThan(before);
  });

  test("an empty outlet can be switched too, and the PDU remembers it", () => {
    const { world } = boot();
    const empty = outletCount(world, "pdu-a");
    expect(empty).toBeGreaterThan(3);
    world.apply(off(empty), "test");
    expect(world.stateAs("pdu-a", "pdu").outletsOff).toEqual([empty]);
    world.apply(off(empty, true), "test");
    expect(world.stateAs("pdu-a", "pdu").outletsOff).toBeUndefined();
  });

  test("the outlets stay switched off in a copy of the world taken from a checkpoint", () => {
    const { world, physics } = boot();
    world.apply(off(2), "test");
    physics.run(30);
    const copy = World.fromBlueprint(dualFed(), catalog);
    copy.restore(world.checkpoint());
    expect(copy.stateAs("pdu-a", "pdu").outletsOff).toEqual([2]);
  });

  test("a command for something that has no such outlet is refused and changes nothing", () => {
    const { world } = boot();
    const count = outletCount(world, "pdu-a");
    for (const bad of [0, count + 1, 1.5, -2])
      expect(() => world.apply(off(bad), "test")).toThrow(/no outlet/);
    expect(() => world.apply({ ...off(1), target: "srv-a1" }, "test")).toThrow(/no outlets/);
    expect(world.stateAs("pdu-a", "pdu").outletsOff).toBeUndefined();
  });
});

describe("Redfish Outlet.PowerControl [REQ-063] [REQ-060]", () => {
  test("an outlet names the device on its cable, reads On, and conforms to the DMTF schema", () => {
    const { redfish } = boot();
    const r = redfish.handle("pdu-a", req("GET", `${OUTLETS}/2`));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      ElectricalConsumerNames: ["srv-a2"],
      PowerEnabled: true,
      PowerState: "On",
    });
    expect(schemaErrors(r.body)).toEqual([]);
    expect(
      (r.body as { Actions: Record<string, { target: string }> }).Actions["#Outlet.PowerControl"]
        ?.target,
    ).toBe(`${OUTLETS}/2/Actions/Outlet.PowerControl`);
  });

  test("Off cuts the device on that cable; the outlet then reads Off and On brings it back", () => {
    const { world, physics, redfish } = boot();
    const action = `${OUTLETS}/2/Actions/Outlet.PowerControl`;
    expect(redfish.handle("pdu-a", req("POST", action, { PowerState: "Off" })).status).toBe(204);
    physics.run(30);
    expect(world.stateAs("srv-a2", "server").powered).toBe(false);
    const read = redfish.handle("pdu-a", req("GET", `${OUTLETS}/2`));
    expect(read.body).toMatchObject({ PowerEnabled: false, PowerState: "Off" });
    expect(schemaErrors(read.body)).toEqual([]);
    expect(redfish.handle("pdu-a", req("POST", action, { PowerState: "On" })).status).toBe(204);
    physics.run(300);
    expect(world.stateAs("srv-a2", "server").powered).toBe(true);
    expect(redfish.handle("pdu-a", req("GET", `${OUTLETS}/2`)).body).toMatchObject({
      PowerState: "On",
    });
  });

  test("a value the action does not offer, or an outlet that is not there, is refused", () => {
    const { redfish } = boot();
    const action = (n: number) => `${OUTLETS}/${n}/Actions/Outlet.PowerControl`;
    expect(
      redfish.handle("pdu-a", req("POST", action(2), { PowerState: "PowerCycle" })).status,
    ).toBe(400);
    expect(redfish.handle("pdu-a", req("POST", action(2), {})).status).toBe(400);
    expect(redfish.handle("pdu-a", req("POST", action(99), { PowerState: "Off" })).status).toBe(
      404,
    );
    expect(redfish.handle("pdu-a", req("GET", `${OUTLETS}/abc`)).status).toBe(404);
  });

  test("an outlet reads Off while its PDU has no power, whatever the switch says", () => {
    const { world, physics, redfish } = boot();
    world.apply(
      { type: "fault.add", fault: { id: "t", type: "breaker_trip", target: "pdu-a", params: {} } },
      "test",
    );
    physics.run(30);
    expect(redfish.handle("pdu-a", req("GET", `${OUTLETS}/1`)).body).toMatchObject({
      PowerEnabled: true,
      PowerState: "Off",
    });
  });
});

describe("what a scenario sees [REQ-063] [REQ-007]", () => {
  test("an outlet command is an outlet action on its PDU", () => {
    expect(
      actionsOf([
        { type: "outlet.set", target: "pdu-a", outlet: 2, on: false },
        { type: "outlet.set", target: "pdu-a", outlet: 2, on: true },
      ]),
    ).toEqual([
      { action: "outlet_off", target: "pdu-a" },
      { action: "outlet_on", target: "pdu-a" },
    ]);
  });
});
