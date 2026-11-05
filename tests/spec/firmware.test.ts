/**
 * Firmware on servers (REQ-002, ADR-0101): the BMC's UpdateService lists the BMC and the BIOS, SimpleUpdate starts an
 * update, the server reboots a few minutes later and then runs the new version, and an update that is made to fail
 * leaves the old version with a warning until another one works. A running update takes the server's virtual
 * machines down with it. Every resource conforms to the DMTF schemas.
 */
import { Catalog } from "@terrarium/core/catalog";
import { type FacadeRequest, RedfishFacade } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { ProfileRegistry } from "@terrarium/core/profiles";
import { REBOOT_SECONDS, STAGE_SECONDS, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { campusBlueprint } from "../../packages/core/src/world/test-support/sample-campus";
import { crawl, schemaErrors } from "./redfish-schemas/validator";

const catalog = new Catalog();

function boot() {
  const world = World.fromBlueprint(campusBlueprint(), catalog);
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

const BASE = "/redfish/v1";
const update = (uri: string) =>
  req("POST", `${BASE}/UpdateService/Actions/UpdateService.SimpleUpdate`, { ImageURI: uri });

describe("the UpdateService lists and updates firmware [REQ-002]", () => {
  test("the inventory has the BMC and the BIOS with their versions", () => {
    const { redfish } = boot();
    const bios = redfish.handle(
      "srv-a1",
      req("GET", `${BASE}/UpdateService/FirmwareInventory/BIOS`),
    );
    expect(bios.body).toMatchObject({ Id: "BIOS", Version: "1.0.0", Updateable: true });
    const members = redfish.handle("srv-a1", req("GET", `${BASE}/UpdateService/FirmwareInventory`));
    expect(members.body).toMatchObject({ "Members@odata.count": 2 });
    const system = redfish.handle("srv-a1", req("GET", `${BASE}/Systems/System.Embedded.1`));
    expect(system.body).toMatchObject({ BiosVersion: "1.0.0" });
  });

  test("SimpleUpdate answers with a task; after the staging the server is down, then it runs the new BIOS", () => {
    const { world, physics, redfish } = boot();
    const sent = redfish.handle("srv-a1", update("http://repo/fw/bios-2.4.1.bin"));
    expect(sent.status).toBe(202);
    expect(sent.headers.Location).toMatch(/TaskService\/Tasks\/\d+$/);
    const task = (sent.body as { "@odata.id": string })["@odata.id"];
    expect(redfish.handle("srv-a1", req("GET", task)).body).toMatchObject({ TaskState: "Running" });

    physics.run(STAGE_SECONDS - 20);
    expect(world.stateAs("srv-a1", "server").adminOn).toBe(true);
    physics.run(40);
    expect(world.stateAs("srv-a1", "server")).toMatchObject({ rebooting: true, adminOn: false });
    expect(world.stateAs("vm-web", "vm").running).toBe(false);
    const down = redfish.handle("srv-a1", req("GET", `${BASE}/Systems/System.Embedded.1`));
    expect(down.body).toMatchObject({ PowerState: "Off", BiosVersion: "1.0.0" });

    physics.run(REBOOT_SECONDS.bios);
    expect(world.stateAs("srv-a1", "server")).toMatchObject({
      rebooting: false,
      adminOn: true,
      biosVersion: "2.4.1",
    });
    expect(world.stateAs("vm-web", "vm").running).toBe(true);
    const done = redfish.handle("srv-a1", req("GET", `${BASE}/Systems/System.Embedded.1`));
    expect(done.body).toMatchObject({ PowerState: "On", BiosVersion: "2.4.1" });
    expect(redfish.handle("srv-a1", req("GET", task)).body).toMatchObject({
      TaskState: "Completed",
      PercentComplete: 100,
    });
    expect(
      world
        .events()
        .map((e) => e.type)
        .filter((t) => t.startsWith("firmware.")),
    ).toEqual(["firmware.update", "firmware.reboot", "firmware.finish"]);
  });

  test("a BMC update takes the BMC itself away while it restarts, and the manager then shows the new version", () => {
    const { physics, redfish } = boot();
    redfish.handle("srv-a1", update("http://repo/fw/bmc-8.40.bin"));
    physics.run(STAGE_SECONDS + 10);
    expect(redfish.handle("srv-a1", req("GET", `${BASE}/Systems/System.Embedded.1`)).status).toBe(
      503,
    );
    physics.run(REBOOT_SECONDS.bmc + 10);
    const manager = redfish.handle("srv-a1", req("GET", `${BASE}/Managers/iDRAC.Embedded.1`));
    expect(manager.body).toMatchObject({ FirmwareVersion: "8.40" });
  });

  test("a bad image name is refused, and a second update while one runs is refused", () => {
    const { redfish } = boot();
    expect(redfish.handle("srv-a1", update("http://repo/fw/readme.txt")).status).toBe(400);
    expect(
      redfish.handle(
        "srv-a1",
        req("POST", `${BASE}/UpdateService/Actions/UpdateService.SimpleUpdate`, {}),
      ).status,
    ).toBe(400);
    expect(redfish.handle("srv-a1", update("http://repo/fw/bios-2.4.1.bin")).status).toBe(202);
    expect(redfish.handle("srv-a1", update("http://repo/fw/bmc-8.40.bin")).status).toBe(409);
  });

  test("a server somebody switched off stays off after its update", () => {
    const { world, physics, redfish } = boot();
    world.apply({ type: "power.set", target: "srv-a1", on: false }, "test");
    redfish.handle("srv-a1", update("http://repo/fw/bios-2.4.1.bin"));
    physics.run(STAGE_SECONDS + REBOOT_SECONDS.bios + 20);
    expect(world.stateAs("srv-a1", "server")).toMatchObject({
      adminOn: false,
      biosVersion: "2.4.1",
    });
  });
});

describe("an update that is made to fail [REQ-002]", () => {
  function failing(failures: number) {
    const booted = boot();
    booted.world.apply(
      {
        type: "fault.add",
        fault: {
          id: "ff",
          type: "firmware_update_failure",
          target: "srv-a1",
          params: { failures },
        },
      },
      "test",
    );
    return booted;
  }
  const full = STAGE_SECONDS + REBOOT_SECONDS.bios + 20;

  test("it comes back with the old version and a warning; the next update works and clears the warning", () => {
    const { world, physics, redfish } = failing(1);
    const first = redfish.handle("srv-a1", update("http://repo/fw/bios-2.4.1.bin"));
    physics.run(full);
    expect(world.stateAs("srv-a1", "server")).toMatchObject({
      biosVersion: "1.0.0",
      adminOn: true,
      rebooting: false,
      fwFailed: "BIOS 2.4.1",
    });
    expect(world.alarms().some((a) => a.code === "firmware_update_failed")).toBe(true);
    const task = (first.body as { "@odata.id": string })["@odata.id"];
    expect(redfish.handle("srv-a1", req("GET", task)).body).toMatchObject({
      TaskState: "Exception",
      TaskStatus: "Critical",
    });

    redfish.handle("srv-a1", update("http://repo/fw/bios-2.4.1.bin"));
    physics.run(full);
    expect(world.stateAs("srv-a1", "server")).toMatchObject({
      biosVersion: "2.4.1",
      adminOn: true,
    });
    expect(world.stateAs("srv-a1", "server").fwFailed).toBeUndefined();
    expect(world.alarms().some((a) => a.code === "firmware_update_failed")).toBe(false);
  });

  test("a rollback to the old image works as the retry does", () => {
    const { world, physics, redfish } = failing(1);
    redfish.handle("srv-a1", update("http://repo/fw/bios-2.4.1.bin"));
    physics.run(full);
    redfish.handle("srv-a1", update("http://repo/fw/bios-1.0.0.bin"));
    physics.run(full);
    expect(world.stateAs("srv-a1", "server")).toMatchObject({
      biosVersion: "1.0.0",
      rebooting: false,
    });
    expect(world.alarms().some((a) => a.code === "firmware_update_failed")).toBe(false);
  });

  test("it fails as many times as the fault says", () => {
    const { world, physics, redfish } = failing(2);
    for (let i = 0; i < 2; i++) {
      redfish.handle("srv-a1", update("http://repo/fw/bios-2.4.1.bin"));
      physics.run(full);
      expect(world.stateAs("srv-a1", "server").biosVersion).toBe("1.0.0");
    }
    redfish.handle("srv-a1", update("http://repo/fw/bios-2.4.1.bin"));
    physics.run(full);
    expect(world.stateAs("srv-a1", "server").biosVersion).toBe("2.4.1");
  });
});

describe("two servers of a rack down together are counted [REQ-002]", () => {
  test("the rack remembers the most servers that were rebooting at once", () => {
    const { world, physics, redfish } = boot();
    expect(world.stateAs("rack-a", "rack").rebootPeak).toBe(0);
    redfish.handle("srv-a1", update("http://repo/fw/bios-2.4.1.bin"));
    physics.run(STAGE_SECONDS + REBOOT_SECONDS.bios + 20);
    expect(world.stateAs("rack-a", "rack").rebootPeak).toBe(1);
    redfish.handle("srv-a1", update("http://repo/fw/bios-2.5.0.bin"));
    redfish.handle("srv-a2", update("http://repo/fw/bios-2.5.0.bin"));
    physics.run(STAGE_SECONDS + 20);
    expect(world.stateAs("rack-a", "rack").rebootPeak).toBe(2);
  });
});

describe("the update resources conform to the DMTF schemas [REQ-002]", () => {
  test("service, inventory, a running task and a finished task", () => {
    const { physics, redfish } = boot();
    const sent = redfish.handle("srv-a1", update("http://repo/fw/bios-2.4.1.bin"));
    const taskPath = (sent.body as { "@odata.id": string })["@odata.id"];
    for (const stage of ["running", "done"]) {
      const result = crawl((path) => {
        const r = redfish.handle("srv-a1", req("GET", path));
        return { status: r.status, body: r.body };
      });
      expect(result.invalid, stage).toEqual({});
      expect(result.broken, stage).toEqual({});
      expect(result.visited).toContain(`${BASE}/UpdateService`);
      expect(result.visited).toContain(`${BASE}/TaskService/Tasks`);
      expect(schemaErrors(redfish.handle("srv-a1", req("GET", taskPath)).body)).toEqual([]);
      physics.run(STAGE_SECONDS + REBOOT_SECONDS.bios + 20);
    }
  });
});
