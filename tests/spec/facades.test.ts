/**
 * Protocol behaviour on a physically simulated world: the facades read what the physics produced and
 * their actions change what the physics does next. Cross-unit, so it lives in tests/spec.
 */
import { Catalog } from "@terrarium/core/catalog";
import {
  type FacadeRequest,
  RedfishFacade,
  SIM_EPOCH_MS,
  simTimeIso,
  stableUuid,
  VcenterFacade,
  VropsFacade,
} from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { ProfileRegistry } from "@terrarium/core/profiles";
import { type Blueprint, ReadOnlyWorldPort, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint, withChanges } from "../../packages/core/src/world/test-support/sample";

const catalog = new Catalog();
const profiles = new ProfileRegistry();

function boot(bp: Blueprint = sampleBlueprint()) {
  const world = World.fromBlueprint(bp, catalog);
  const physics = new Physics(world);
  physics.settle();
  physics.run(600);
  return { world, physics };
}

const get = (path: string, query: Record<string, string> = {}): FacadeRequest => ({
  method: "GET",
  path,
  query,
  headers: {},
});
const post = (path: string, body?: unknown, query: Record<string, string> = {}): FacadeRequest => ({
  method: "POST",
  path,
  query,
  body,
  headers: {},
});
const body = (response: { body: unknown }) => response.body as Record<string, any>;

function withProfile(serverId: string, key: string): Blueprint {
  const bp = sampleBlueprint();
  const server = bp.entities.find((e) => e.id === serverId) as Blueprint["entities"][number];
  return withChanges(bp, { entities: [{ ...server, props: { bmcProfile: key } }] });
}

describe("Redfish facade [REQ-002] [REQ-003]", () => {
  test("service root and collections follow the profile's member ids", () => {
    const { world } = boot();
    const redfish = new RedfishFacade(world, profiles);
    const root = body(redfish.handle("srv-a1", get("/redfish/v1")));
    expect(root).toMatchObject({
      "@odata.type": "#ServiceRoot.v1_15_0.ServiceRoot",
      RedfishVersion: "1.17.0",
      Systems: { "@odata.id": "/redfish/v1/Systems" },
    });
    expect(body(redfish.handle("srv-a1", get("/redfish/v1/Systems"))).Members).toEqual([
      { "@odata.id": "/redfish/v1/Systems/System.Embedded.1" },
    ]);
    const lite = new RedfishFacade(boot(withProfile("srv-a1", "bmc-lite/2.80")).world, profiles);
    expect(body(lite.handle("srv-a1", get("/redfish/v1/Chassis"))).Members).toEqual([
      { "@odata.id": "/redfish/v1/Chassis/1" },
    ]);
  });

  test("the computer system reports model, power, health and allowed resets", () => {
    const redfish = new RedfishFacade(boot().world, profiles);
    const system = body(redfish.handle("srv-a1", get("/redfish/v1/Systems/System.Embedded.1")));
    expect(system).toMatchObject({
      Id: "System.Embedded.1",
      Model: "2U 범용 서버",
      PowerState: "On",
      Status: { State: "Enabled", Health: "OK" },
      ProcessorSummary: { Count: 2, CoreCount: 96 },
    });
    expect(system.SerialNumber).toMatch(/^TRM[0-9A-F]{7}$/);
    expect(system.Actions["#ComputerSystem.Reset"]["ResetType@Redfish.AllowableValues"]).toContain(
      "GracefulRestart",
    );
  });

  test("the chassis knows its rack and unit", () => {
    const chassis = body(
      new RedfishFacade(boot().world, profiles).handle(
        "srv-a1",
        get("/redfish/v1/Chassis/System.Embedded.1"),
      ),
    );
    expect(chassis.Location.PartLocation).toMatchObject({
      ServiceLabel: "rack-a",
      LocationOrdinalValue: 10,
    });
    expect(chassis).toHaveProperty("Thermal");
    expect(chassis).toHaveProperty("ThermalSubsystem");
  });

  test("legacy and subsystem schemas are offered according to the profile", () => {
    const legacy = new RedfishFacade(boot(withProfile("srv-a1", "bmc-gen14/4.40")).world, profiles);
    expect(
      legacy.handle("srv-a1", get("/redfish/v1/Chassis/System.Embedded.1/Thermal")).status,
    ).toBe(200);
    expect(
      legacy.handle("srv-a1", get("/redfish/v1/Chassis/System.Embedded.1/ThermalSubsystem")).status,
    ).toBe(404);
    const lite = new RedfishFacade(boot(withProfile("srv-a1", "bmc-lite/2.80")).world, profiles);
    expect(lite.handle("srv-a1", get("/redfish/v1/Chassis/1/Thermal")).status).toBe(404);
    const metrics = body(
      lite.handle("srv-a1", get("/redfish/v1/Chassis/1/ThermalSubsystem/ThermalMetrics")),
    );
    expect(metrics.TemperatureReadingsCelsius[0].DeviceName).toBe("System Board Inlet Temp");
    expect(
      body(lite.handle("srv-a1", get("/redfish/v1/Chassis/1/ThermalSubsystem/Fans"))).Members,
    ).toHaveLength(6);
    expect(
      body(lite.handle("srv-a1", get("/redfish/v1/Chassis/1/ThermalSubsystem/Fans/2"))).SpeedPercent
        .SpeedRPM,
    ).toBeGreaterThan(0);
    expect(lite.handle("srv-a1", get("/redfish/v1/Chassis/1/ThermalSubsystem/Fans/9")).status).toBe(
      404,
    );
    expect(
      body(lite.handle("srv-a1", get("/redfish/v1/Chassis/1/PowerSubsystem"))).CapacityWatts,
    ).toBe(750);
    expect(
      body(lite.handle("srv-a1", get("/redfish/v1/Chassis/1/PowerSubsystem/PowerSupplies")))
        .Members,
    ).toHaveLength(2);
    expect(
      body(lite.handle("srv-a1", get("/redfish/v1/Chassis/1/PowerSubsystem/PowerSupplies/1")))
        .Status.Health,
    ).toBe("OK");
    expect(
      lite.handle("srv-a1", get("/redfish/v1/Chassis/1/PowerSubsystem/PowerSupplies/5")).status,
    ).toBe(404);
  });

  test("thermal readings follow the world; a drifting sensor misreports while the truth stays put", () => {
    const { world, physics } = boot();
    const redfish = new RedfishFacade(world, profiles);
    const reading = () =>
      body(redfish.handle("srv-a1", get("/redfish/v1/Chassis/System.Embedded.1/Thermal")))
        .Temperatures[0].ReadingCelsius;
    const truth = world.stateAs("srv-a1", "server").inletC;
    expect(reading()).toBeCloseTo(truth, 0);
    world.apply(
      {
        type: "fault.add",
        fault: { id: "d", type: "sensor_drift", target: "srv-a1", params: { deltaC: 9 } },
      },
      "scenario",
    );
    physics.run(10);
    expect(reading()).toBeCloseTo(world.stateAs("srv-a1", "server").inletC + 9, 0);
    expect(world.stateAs("srv-a1", "server").inletC).toBeCloseTo(truth, 0);
  });

  test("a failed fan and a failed PSU show up as critical members", () => {
    const { world, physics } = boot();
    world.apply(
      {
        type: "fault.add",
        fault: { id: "f", type: "fan_failure", target: "srv-a1", params: { fanIndex: 1 } },
      },
      "scenario",
    );
    world.apply(
      {
        type: "fault.add",
        fault: { id: "p", type: "psu_failure", target: "srv-a1", params: { psuIndex: 0 } },
      },
      "scenario",
    );
    physics.run(60);
    const redfish = new RedfishFacade(world, profiles);
    const thermal = body(
      redfish.handle("srv-a1", get("/redfish/v1/Chassis/System.Embedded.1/Thermal")),
    );
    expect(thermal.Fans[1]).toMatchObject({ Reading: 0, Status: { Health: "Critical" } });
    const power = body(
      redfish.handle("srv-a1", get("/redfish/v1/Chassis/System.Embedded.1/Power")),
    );
    expect(power.PowerSupplies.map((p: any) => p.Status.Health)).toEqual(["Critical", "OK"]);
    expect(power.PowerControl[0].PowerConsumedWatts).toBeGreaterThan(200);
  });

  test.each([
    ["ForceOff", false],
    ["GracefulShutdown", false],
    ["On", true],
    ["GracefulRestart", true],
  ])("reset %s changes power and is recorded with its cause", (resetType, on) => {
    const { world } = boot();
    const redfish = new RedfishFacade(world, profiles);
    const response = redfish.handle(
      "srv-a1",
      post("/redfish/v1/Systems/System.Embedded.1/Actions/ComputerSystem.Reset", {
        ResetType: resetType,
      }),
    );
    expect(response.status).toBe(204);
    expect(world.stateAs("srv-a1", "server").adminOn).toBe(on);
    expect(world.events().at(-1)?.cause).toBe(`redfish:srv-a1:${resetType}`);
  });

  test("PushPowerButton toggles and NMI only leaves a note", () => {
    const { world } = boot(withProfile("srv-a1", "bmc-gen14/4.40"));
    const redfish = new RedfishFacade(world, profiles);
    const reset = (type: string) =>
      redfish.handle(
        "srv-a1",
        post("/redfish/v1/Systems/System.Embedded.1/Actions/ComputerSystem.Reset", {
          ResetType: type,
        }),
      );
    reset("PushPowerButton");
    expect(world.stateAs("srv-a1", "server").adminOn).toBe(false);
    reset("PushPowerButton");
    expect(world.stateAs("srv-a1", "server").adminOn).toBe(true);
    reset("Nmi");
    expect(world.events().at(-1)).toMatchObject({ type: "note" });
  });

  test("an unsupported reset type is a Redfish error naming the allowed values", () => {
    const response = new RedfishFacade(boot().world, profiles).handle(
      "srv-a1",
      post("/redfish/v1/Systems/System.Embedded.1/Actions/ComputerSystem.Reset", {
        ResetType: "Explode",
      }),
    );
    expect(response.status).toBe(400);
    expect(body(response).error.message).toContain("GracefulRestart");
  });

  test("the event log lists the server's alarms with simulated timestamps", () => {
    const { world, physics } = boot();
    world.apply(
      { type: "fault.add", fault: { id: "f", type: "fan_failure", target: "srv-a1", params: {} } },
      "scenario",
    );
    physics.run(30);
    const log = body(
      new RedfishFacade(world, profiles).handle(
        "srv-a1",
        get("/redfish/v1/Systems/System.Embedded.1/LogServices/EventLog/Entries"),
      ),
    );
    expect(log.Members.map((m: any) => m.MessageId)).toEqual(["Terrarium.1.0.fan_failed"]);
    const raised = world.events().find((e) => e.type === "alarm.raise");
    expect(log.Members[0].Created).toBe(simTimeIso(raised?.t ?? -1));
    const lite = new RedfishFacade(boot(withProfile("srv-a1", "bmc-lite/2.80")).world, profiles);
    expect(
      lite.handle("srv-a1", get("/redfish/v1/Systems/1/LogServices/EventLog/Entries")).status,
    ).toBe(404);
  });

  test("an unresponsive or unpowered BMC, a non-server, a wrong id, path or method all fail properly", () => {
    const { world, physics } = boot();
    const redfish = new RedfishFacade(world, profiles);
    expect(redfish.handle("rack-a", get("/redfish/v1")).status).toBe(404);
    expect(redfish.handle("srv-a1", get("/redfish/v1/Systems/System.Embedded.9")).status).toBe(404);
    expect(redfish.handle("srv-a1", get("/redfish/v1/Nope")).status).toBe(404);
    expect(redfish.handle("srv-a1", post("/redfish/v1/Systems")).status).toBe(405);
    expect(body(redfish.handle("srv-a1", get("/redfish/v1/Nope"))).error.code).toBe(
      "Base.1.18.ResourceMissingAtURI",
    );
    world.apply(
      {
        type: "fault.add",
        fault: { id: "b", type: "bmc_unresponsive", target: "srv-a2", params: {} },
      },
      "scenario",
    );
    expect(redfish.handle("srv-a2", get("/redfish/v1")).status).toBe(504);
    world.apply(
      { type: "fault.add", fault: { id: "t", type: "breaker_trip", target: "pdu-b", params: {} } },
      "scenario",
    );
    physics.run(10);
    expect(redfish.handle("srv-b1", get("/redfish/v1")).status).toBe(503);
  });

  test("the same facade over a read-only port answers reads and refuses control (REQ-008)", () => {
    const { world } = boot();
    const readOnly = new RedfishFacade(new ReadOnlyWorldPort(world), profiles);
    expect(readOnly.handle("srv-a1", get("/redfish/v1/Systems/System.Embedded.1")).status).toBe(
      200,
    );
    const refused = readOnly.handle(
      "srv-a1",
      post("/redfish/v1/Systems/System.Embedded.1/Actions/ComputerSystem.Reset", {
        ResetType: "ForceOff",
      }),
    );
    expect(refused.status).toBe(403);
    expect(world.stateAs("srv-a1", "server").adminOn).toBe(true);
  });

  test("manager reports the BMC firmware of the profile", () => {
    const manager = body(
      new RedfishFacade(boot().world, profiles).handle(
        "srv-a1",
        get("/redfish/v1/Managers/iDRAC.Embedded.1"),
      ),
    );
    expect(manager).toMatchObject({ ManagerType: "BMC", FirmwareVersion: "7.10" });
  });
});

describe("vCenter facade [REQ-003] [REQ-004]", () => {
  test("lists VMs with filters and shows details; a VM's host is found by the hosts filter", () => {
    const vc = new VcenterFacade(boot().world, profiles);
    const vms = body(vc.handle(get("/api/vcenter/vm"))) as unknown as any[];
    expect(vms.map((v) => v.vm)).toEqual(["vm-db", "vm-web"]);
    expect(vms[0]).toMatchObject({
      power_state: "POWERED_ON",
      cpu_count: 16,
      memory_size_MiB: 128 * 1024,
    });
    expect(
      (body(vc.handle(get("/api/vcenter/vm", { hosts: "srv-a1" }))) as unknown as any[]).map(
        (v) => v.vm,
      ),
    ).toEqual(["vm-web"]);
    expect(body(vc.handle(get("/api/vcenter/vm", { names: "nope" })))).toEqual([]);
    expect(
      (body(vc.handle(get("/api/vcenter/vm", { hosts: "srv-a2" }))) as unknown as any[]).map(
        (v) => v.vm,
      ),
    ).toEqual(["vm-db"]);
    expect(body(vc.handle(get("/api/vcenter/vm/vm-db")))).toMatchObject({ cpu: { count: 16 } });
    expect(body(vc.handle(get("/api/vcenter/vm/vm-db")))).not.toHaveProperty("placement");
    expect(vc.handle(get("/api/vcenter/vm/ghost")).status).toBe(404);
  });

  test("power actions control VMs in the simulated world", () => {
    const { world, physics } = boot();
    const vc = new VcenterFacade(world, profiles);
    expect(
      vc.handle(post("/api/vcenter/vm/vm-web/power", undefined, { action: "stop" })).status,
    ).toBe(204);
    physics.run(10);
    expect(body(vc.handle(get("/api/vcenter/vm", { power_states: "POWERED_OFF" })))).toHaveLength(
      1,
    );
    expect(
      vc.handle(post("/api/vcenter/vm/vm-web/power", undefined, { action: "reset" })).status,
    ).toBe(204);
    expect(
      vc.handle(post("/api/vcenter/vm/vm-web/power", undefined, { action: "explode" })).status,
    ).toBe(400);
    expect(
      vc.handle(post("/api/vcenter/vm/ghost/power", undefined, { action: "start" })).status,
    ).toBe(404);
  });

  test("a host whose network is down is NOT_RESPONDING; clusters and datastores are listed", () => {
    const { world, physics } = boot();
    const vc = new VcenterFacade(world, profiles);
    const link = world.index.outgoing("srv-a1", "network")[0]?.id as string;
    world.apply(
      { type: "fault.add", fault: { id: "l", type: "link_down", target: link, params: {} } },
      "scenario",
    );
    physics.run(10);
    const hosts = body(vc.handle(get("/api/vcenter/host"))) as unknown as any[];
    expect(hosts.find((h) => h.host === "srv-a1")).toMatchObject({
      connection_state: "NOT_RESPONDING",
      power_state: "POWERED_ON",
    });
    expect(hosts.find((h) => h.host === "srv-a2")?.connection_state).toBe("CONNECTED");
    expect(body(vc.handle(get("/api/vcenter/cluster")))).toEqual([
      { cluster: "cl1", name: "Cluster-A", ha_enabled: true, drs_enabled: true },
    ]);
    expect((body(vc.handle(get("/api/vcenter/datastore"))) as unknown as any[])[0]).toMatchObject({
      datastore: "ds1",
      name: "vsan-ds",
    });
    expect(vc.handle(post("/api/session")).status).toBe(201);
    expect(body(vc.handle(get("/api/session")))).toHaveProperty("user");
  });

  test("only vCenter 7.0 answers the deprecated /rest API, with value envelopes", () => {
    const { world } = boot();
    const v7 = new VcenterFacade(world, profiles, "vcenter/7.0");
    expect(body(v7.handle(get("/rest/vcenter/vm"))).value).toHaveLength(2);
    expect(body(v7.handle(get("/rest/vcenter/vm/vm-web"))).value.name).toBe("vm-web");
    expect(body(v7.handle(get("/rest/vcenter/host"))).value).toHaveLength(2);
    expect(body(v7.handle(post("/rest/com/vmware/cis/session"))).value).toMatch(
      /^vmware-api-session-/,
    );
    const v8 = new VcenterFacade(world, profiles);
    const missing = v8.handle(get("/rest/vcenter/vm"));
    expect(missing.status).toBe(404);
    expect(body(missing).error_type).toBe("NOT_FOUND");
  });
});

describe("vROps facade [REQ-003]", () => {
  test("resources are listed with stable ids and filtered by kind", () => {
    const vrops = new VropsFacade(boot().world, profiles);
    const all = body(vrops.handle(get("/suite-api/api/resources"))).resourceList as any[];
    expect(all.map((r) => r.resourceKey.name).sort()).toEqual([
      "Cluster-A",
      "srv-a1",
      "srv-a2",
      "vcsa-01",
      "vm-db",
      "vm-web",
      "vsan-ds",
    ]);
    const vms = body(
      vrops.handle(get("/suite-api/api/resources", { resourceKind: "VirtualMachine" })),
    ).resourceList as any[];
    expect(vms.map((r) => r.identifier)).toEqual([stableUuid("vm-db"), stableUuid("vm-web")]);
    expect(
      body(vrops.handle(get(`/suite-api/api/resources/${stableUuid("vm-db")}`))).resourceHealth,
    ).toBe("GREEN");
    expect(vrops.handle(get("/suite-api/api/resources/nope")).status).toBe(404);
    expect(body(vrops.handle(post("/suite-api/api/auth/token/acquire"))).token).toMatch(
      /^OpsToken-/,
    );
  });

  test("latest stats follow the world for VMs, hosts and other resources", () => {
    const { world, physics } = boot();
    world.apply({ type: "load.set", target: "vm-web", value: 0.8 }, "scenario");
    physics.run(60);
    const vrops = new VropsFacade(world, profiles);
    const latest = (id: string) => {
      const stats = body(
        vrops.handle(get(`/suite-api/api/resources/${stableUuid(id)}/stats/latest`)),
      ).values[0]["stat-list"].stat as any[];
      return Object.fromEntries(stats.map((s) => [s.statKey.key, s.data[0]]));
    };
    expect(latest("vm-web")).toMatchObject({ "cpu|usage_average": 80, "sys|poweredOn": 1 });
    expect(latest("srv-a1")["power|power_average"]).toBeGreaterThan(200);
    expect(latest("cl1")).toEqual({ "badge|health": 100 });
    const stat = body(
      vrops.handle(get(`/suite-api/api/resources/${stableUuid("vm-web")}/stats/latest`)),
    ).values[0]["stat-list"].stat[0];
    expect(stat.timestamps[0]).toBe(SIM_EPOCH_MS + world.time() * 1000);
  });

  test("active alarms on monitored resources become alerts", () => {
    const { world, physics } = boot();
    world.apply(
      { type: "fault.add", fault: { id: "t", type: "breaker_trip", target: "pdu-a", params: {} } },
      "scenario",
    );
    physics.run(10);
    const alerts = body(
      new VropsFacade(world, profiles, "vrops/8.10").handle(get("/suite-api/api/alerts")),
    ).alerts as any[];
    const names = alerts.map((a) => a.alertDefinitionId).sort();
    expect(names).toContain("AlertDefinition-Terrarium-server_power_lost");
    expect(names).toContain("AlertDefinition-Terrarium-vm_down");
    expect(alerts.every((a) => a.status === "ACTIVE")).toBe(true);
    expect(names.some((n) => n.includes("breaker_tripped"))).toBe(false);
  });
});
