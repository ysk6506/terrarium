/**
 * Every Redfish payload the emulation produces is checked against the DMTF JSON schemas, by following the
 * links from the service root the way a client would (REQ-002, REQ-060). A resource the schemas reject, a
 * link that leads nowhere, or a resource type missing from the schema bundle fails the test.
 */
import { Catalog } from "@terrarium/core/catalog";
import { type FacadeRequest, RedfishFacade } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { ProfileRegistry } from "@terrarium/core/profiles";
import { type Blueprint, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint, withChanges } from "../../packages/core/src/world/test-support/sample";
import { campusBlueprint } from "../../packages/core/src/world/test-support/sample-campus";
import { crawl, schemaErrors } from "./redfish-schemas/validator";

const catalog = new Catalog();

function boot(bp: Blueprint) {
  const world = World.fromBlueprint(bp, catalog);
  const physics = new Physics(world);
  physics.settle();
  physics.run(600);
  return { world, physics, redfish: new RedfishFacade(world, new ProfileRegistry()) };
}

const req = (method: FacadeRequest["method"], path: string, body?: unknown): FacadeRequest => ({
  method,
  path,
  query: {},
  headers: {},
  body,
});

function crawlOf(redfish: RedfishFacade, id: string) {
  return crawl((path) => {
    const r = redfish.handle(id, req("GET", path));
    return { status: r.status, body: r.body };
  });
}

const withProfile = (key: string): Blueprint => {
  const bp = sampleBlueprint();
  const server = bp.entities.find((e) => e.id === "srv-a1") as Blueprint["entities"][number];
  return withChanges(bp, { entities: [{ ...server, props: { bmcProfile: key } }] });
};

describe("server BMCs match the DMTF schemas [REQ-002]", () => {
  for (const profile of ["bmc-gen14/4.40", "bmc-gen16/7.10", "bmc-lite/2.80"]) {
    test(`${profile}: every linked resource conforms`, () => {
      const { redfish } = boot(withProfile(profile));
      const result = crawlOf(redfish, "srv-a1");
      expect(result.invalid).toEqual({});
      expect(result.broken).toEqual({});
      expect(result.visited.length).toBeGreaterThan(8);
    });
  }

  test("a failed power supply and a stopped fan still conform", () => {
    const { world, physics, redfish } = boot(sampleBlueprint());
    for (const [id, type] of [
      ["f1", "psu_failure"],
      ["f2", "fan_failure"],
    ] as const)
      world.apply({ type: "fault.add", fault: { id, type, target: "srv-a1", params: {} } }, "test");
    physics.run(60);
    const result = crawlOf(redfish, "srv-a1");
    expect(result.invalid).toEqual({});
    expect(result.broken).toEqual({});
  });
});

describe("power and cooling equipment match the DMTF schemas [REQ-060] [REQ-002]", () => {
  const equipment: Array<[string, string]> = [
    ["pdu-a", "rack PDU"],
    ["panel-1", "distribution panel"],
    ["ats-1", "transfer switch panel"],
    ["cdu-1", "CDU"],
  ];

  for (const [id, label] of equipment) {
    test(`${label} ${id}: every linked resource conforms`, () => {
      const { redfish } = boot(campusBlueprint());
      const result = crawlOf(redfish, id);
      expect(result.invalid).toEqual({});
      expect(result.broken).toEqual({});
      expect(result.visited.length).toBeGreaterThan(5);
    });
  }

  test("a tripped breaker reads Tripped, and BreakerControl resets it", () => {
    const { world, physics, redfish } = boot(sampleBlueprint());
    world.apply(
      { type: "fault.add", fault: { id: "t", type: "breaker_trip", target: "pdu-a", params: {} } },
      "test",
    );
    physics.run(60);
    const circuit = "/redfish/v1/PowerEquipment/RackPDUs/1/Mains/1";
    const tripped = redfish.handle("pdu-a", req("GET", circuit)).body as Record<string, unknown>;
    expect(tripped).toMatchObject({ BreakerState: "Tripped", PowerState: "Off" });
    expect(schemaErrors(tripped)).toEqual([]);
    const refused = redfish.handle(
      "pdu-a",
      req("POST", `${circuit}/Actions/Circuit.BreakerControl`, { PowerState: "Off" }),
    );
    expect(refused.status).toBe(400);
    const done = redfish.handle(
      "pdu-a",
      req("POST", `${circuit}/Actions/Circuit.BreakerControl`, { PowerState: "On" }),
    );
    expect(done.status).toBe(204);
    physics.run(60);
    expect(redfish.handle("pdu-a", req("GET", circuit)).body).toMatchObject({
      BreakerState: "Normal",
      PowerState: "On",
    });
  });

  test("a CDU reports its loop from the world and its pumps one by one", () => {
    const { world, redfish } = boot(campusBlueprint());
    const loop = redfish.handle(
      "cdu-1",
      req("GET", "/redfish/v1/ThermalEquipment/CDUs/1/SecondaryCoolantConnectors/1"),
    ).body as { SupplyTemperatureCelsius: { Reading: number } };
    const state = world.stateAs("cdu-1", "cdu");
    expect(loop.SupplyTemperatureCelsius.Reading).toBeCloseTo(state.supplyC, 0);
    const pumps = redfish.handle("cdu-1", req("GET", "/redfish/v1/ThermalEquipment/CDUs/1/Pumps"))
      .body as { Members: unknown[] };
    expect(pumps.Members).toHaveLength(state.pumpsOk.length);
  });

  test("equipment without a Redfish service says what it does speak", () => {
    const { redfish } = boot(sampleBlueprint());
    const ups = redfish.handle("ups-1", req("GET", "/redfish/v1"));
    expect(ups.status).toBe(404);
    expect(JSON.stringify(ups.body)).toContain("SNMP");
    expect(redfish.handle("crah-1", req("GET", "/redfish/v1")).status).toBe(404);
    expect(redfish.handle("nothing", req("GET", "/redfish/v1")).status).toBe(404);
  });
});

describe("the schema check can fail [REQ-002]", () => {
  test("a wrong enumeration, a missing required property and an unknown type are all reported", () => {
    const circuit = {
      "@odata.id": "/redfish/v1/x",
      "@odata.type": "#Circuit.v1_10_0.Circuit",
      Id: "1",
      Name: "x",
      BreakerState: "Open",
    };
    expect(schemaErrors(circuit).join(" ")).toMatch(/BreakerState/);
    expect(schemaErrors({ ...circuit, BreakerState: "Normal", Id: undefined }).join(" ")).toMatch(
      /Id/,
    );
    expect(schemaErrors({ "@odata.type": "#Nothing.v1_0_0.Nothing" })[0]).toMatch(/no schema/);
    expect(schemaErrors({})[0]).toMatch(/@odata.type/);
  });
});
