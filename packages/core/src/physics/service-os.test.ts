import { Catalog } from "@terrarium/core/catalog";
import { type FaultType, serviceHealth, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { serviceLab } from "../world/test-support/service-lab";
import { Physics } from ".";

const catalog = new Catalog();
const MINUTE = 60;

function boot(): { world: World; physics: Physics } {
  const world = World.fromBlueprint(serviceLab(), catalog);
  const physics = new Physics(world);
  physics.settle();
  physics.run(10 * MINUTE);
  return { world, physics };
}

const inject = (
  world: World,
  type: FaultType,
  target: string,
  params: Record<string, number> = {},
) =>
  world.apply(
    { type: "fault.add", fault: { id: `f-${type}-${target}`, type, target, params } },
    "scenario",
  );

const status = (world: World, id: string) => world.stateAs(id, "service").status;

describe("a service is as healthy as what it runs on [REQ-086]", () => {
  test("a healthy hall has healthy services and no alarms", () => {
    const { world } = boot();
    for (const id of ["svc-web", "svc-license", "svc-queue"])
      expect(status(world, id)).toBe("healthy");
    expect(world.alarms()).toEqual([]);
  });

  test("switching off the server a stateful service runs on stops it, and an alarm of kind service says so", () => {
    const { world, physics } = boot();
    world.apply({ type: "power.set", target: "srv-a2", on: false }, "scenario");
    physics.run(MINUTE);
    expect(status(world, "svc-license")).toBe("down");
    const alarm = world.alarms().find((a) => a.entityId === "svc-license");
    expect(alarm).toMatchObject({ code: "service_down", severity: "critical", kind: "service" });
    expect(world.stateAs("svc-license", "service").reasons[0]).toContain("꺼져 있어요");
  });

  test("a request service on a VM follows its host: server off, VM off, service down", () => {
    const { world, physics } = boot();
    world.apply({ type: "power.set", target: "srv-a1", on: false }, "scenario");
    physics.run(MINUTE);
    expect(status(world, "svc-web")).toBe("down");
  });

  test("failing over runs the service on its standby and brings it back", () => {
    const { world, physics } = boot();
    world.apply({ type: "power.set", target: "srv-a2", on: false }, "scenario");
    physics.run(MINUTE);
    world.apply({ type: "service.failover", target: "svc-license" }, "tool:failover_service");
    physics.run(MINUTE);
    const state = world.stateAs("svc-license", "service");
    expect(state.runsOn).toEqual(["srv-b1"]);
    expect(state.standby).toEqual(["srv-a2"]);
    expect(state.status).toBe("healthy");
    expect(state.failovers).toBe(1);
  });

  test("the cost of a stopped service adds up as money, and a batch service piles up work", () => {
    const { world, physics } = boot();
    world.apply({ type: "power.set", target: "srv-a2", on: false }, "scenario");
    world.apply({ type: "power.set", target: "srv-a2", on: false }, "scenario");
    physics.run(30 * MINUTE);
    expect(world.stateAs("svc-license", "service").lostKrw).toBeGreaterThan(20_000_000);
    world.apply({ type: "power.set", target: "srv-a1", on: false }, "scenario");
    physics.run(30 * MINUTE);
    expect(world.stateAs("svc-queue", "service").backlog).toBeGreaterThan(100);
  });

  test("a switch on the path that is gone stops the service, however well its hosts are", () => {
    const { world, physics } = boot();
    world.apply(
      {
        type: "fault.add",
        fault: { id: "sw", type: "switch_failure", target: "tor-a", params: {} },
      },
      "scenario",
    );
    physics.run(MINUTE);
    expect(serviceHealth(world, "svc-web").status).toBe("down");
  });

  test("a hot server slows a service that runs on it", () => {
    const { world } = boot();
    world.patch("srv-a2", "server", { inletC: 33 });
    expect(serviceHealth(world, "svc-license").status).toBe("degraded");
  });

  test("migrating a VM moves where it runs, and the service follows the new host", () => {
    const { world, physics } = boot();
    world.apply({ type: "vm.migrate", target: "vm-web", host: "srv-b1" }, "tool:migrate_vm");
    physics.run(MINUTE);
    world.apply({ type: "power.set", target: "srv-a1", on: false }, "scenario");
    physics.run(MINUTE);
    expect(world.stateAs("vm-web", "vm").running).toBe(true);
    expect(status(world, "svc-web")).toBe("healthy");
    expect(() =>
      world.apply({ type: "vm.migrate", target: "vm-web", host: "srv-b1" }, "x"),
    ).toThrow();
  });
});

/** type, the service, what it becomes, how long to wait (minutes), and the fault's settings. */
const OS_CASES: ReadonlyArray<
  [FaultType, string, "degraded" | "down", number, Record<string, number>]
> = [
  ["disk_full", "svc-license", "down", 10, {}],
  ["log_flood", "svc-license", "down", 10, { pctPerMin: 20 }],
  ["memory_leak", "svc-license", "degraded", 7.5, { pctPerMin: 10 }],
  ["process_crashloop", "svc-license", "down", 10, {}],
  ["zombie_pileup", "svc-license", "degraded", 4, { perMin: 100 }],
  ["fs_readonly", "svc-license", "down", 10, {}],
  ["ntp_drift", "svc-web", "down", 10, {}],
  ["dns_failure", "svc-web", "down", 10, {}],
  ["kernel_panic", "svc-license", "down", 1, {}],
  ["cert_expired", "svc-web", "down", 10, {}],
];

describe("ten faults of the operating system, and what each does to a service [REQ-087]", () => {
  test.each(OS_CASES)(
    "%s on the host of %s makes it %s",
    (type, service, expected, minutes, params) => {
      const { world, physics } = boot();
      const host = world.stateAs(service, "service").runsOn[0] as string;
      inject(world, type, host, params);
      physics.run(minutes * MINUTE);
      expect(status(world, service)).toBe(expected);
      expect(world.alarms().some((a) => a.kind === "os" || a.kind === "service")).toBe(true);
    },
  );

  test("the clock drifts a little each minute and breaks logins past five minutes", () => {
    const { world, physics } = boot();
    inject(world, "ntp_drift", "vm-web");
    physics.run(MINUTE);
    expect(status(world, "svc-web")).toBe("healthy");
    expect(Math.round(world.stateAs("vm-web", "vm").os?.ntpOffsetS ?? 0)).toBe(90);
    physics.run(5 * MINUTE);
    expect(status(world, "svc-web")).toBe("down");
    expect(world.alarms().map((a) => a.code)).toContain("os_ntp_drift");
  });

  test("a memory leak climbs by the minute, slows the service, and ends in an out-of-memory kill", () => {
    const { world, physics } = boot();
    inject(world, "memory_leak", "srv-a2", { pctPerMin: 4 });
    physics.run(10 * MINUTE);
    const os = world.stateAs("srv-a2", "server").os;
    expect(os?.memPct).toBeGreaterThan(50);
    physics.run(15 * MINUTE);
    const after = world.stateAs("srv-a2", "server").os;
    expect(after?.processes.find((p) => p.name === "licd")?.restarts).toBeGreaterThanOrEqual(1);
    expect(after?.log.some((l) => l.msg.includes("Out of memory"))).toBe(true);
  });

  test("zombies pile up by the minute and a restart of the parent clears them and the fault", () => {
    const { world, physics } = boot();
    inject(world, "zombie_pileup", "srv-a2", { perMin: 100 });
    physics.run(5 * MINUTE);
    expect(world.stateAs("srv-a2", "server").os?.zombies).toBeGreaterThan(400);
    world.apply(
      { type: "host.act", target: "srv-a2", action: "restart", arg: "licd" },
      "tool:run_command",
    );
    physics.run(MINUTE);
    expect(world.stateAs("srv-a2", "server").os?.zombies).toBe(0);
    expect(world.faultsOn("srv-a2")).toHaveLength(0);
    expect(status(world, "svc-license")).toBe("healthy");
  });

  test("a crash loop survives a restart; moving the service to its standby is what helps", () => {
    const { world, physics } = boot();
    inject(world, "process_crashloop", "srv-a2");
    physics.run(3 * MINUTE);
    world.apply(
      { type: "host.act", target: "srv-a2", action: "restart", arg: "licd" },
      "tool:run_command",
    );
    physics.run(3 * MINUTE);
    expect(status(world, "svc-license")).toBe("down");
    expect(
      world.stateAs("srv-a2", "server").os?.processes.find((p) => p.name === "licd")?.restarts,
    ).toBeGreaterThan(5);
    world.apply({ type: "service.failover", target: "svc-license" }, "tool:failover_service");
    physics.run(MINUTE);
    expect(status(world, "svc-license")).toBe("healthy");
  });

  test("a full disk is emptied by removing logs; a flood fills it again until its process is restarted", () => {
    const { world, physics } = boot();
    inject(world, "log_flood", "srv-a2", { pctPerMin: 10 });
    physics.run(8 * MINUTE);
    expect(world.stateAs("srv-a2", "server").os?.diskPct).toBe(100);
    expect(status(world, "svc-license")).toBe("down");
    world.apply(
      { type: "host.act", target: "srv-a2", action: "free_disk", arg: "/var/log/licd" },
      "tool:run_command",
    );
    physics.run(2 * MINUTE);
    expect(world.stateAs("srv-a2", "server").os?.diskPct).toBeGreaterThan(70);
    world.apply(
      { type: "host.act", target: "srv-a2", action: "restart", arg: "licd" },
      "tool:run_command",
    );
    world.apply(
      { type: "host.act", target: "srv-a2", action: "free_disk", arg: "/var/log/licd" },
      "tool:run_command",
    );
    physics.run(10 * MINUTE);
    expect(world.stateAs("srv-a2", "server").os?.diskPct).toBeLessThan(70);
    expect(status(world, "svc-license")).toBe("healthy");
  });

  test("a read-only file system is made writable again by remounting", () => {
    const { world, physics } = boot();
    inject(world, "fs_readonly", "srv-a2");
    physics.run(MINUTE);
    expect(world.alarms().map((a) => a.code)).toContain("os_fs_readonly");
    world.apply({ type: "host.act", target: "srv-a2", action: "remount_rw" }, "tool:run_command");
    physics.run(MINUTE);
    expect(world.stateAs("srv-a2", "server").os?.fs).toBe("rw");
    expect(status(world, "svc-license")).toBe("healthy");
  });

  test("a kernel panic reboots the host by itself: down for a while, then up with a fresh uptime", () => {
    const { world, physics } = boot();
    inject(world, "kernel_panic", "srv-a2", { downSeconds: 120 });
    physics.run(MINUTE);
    expect(status(world, "svc-license")).toBe("down");
    physics.run(3 * MINUTE);
    const os = world.stateAs("srv-a2", "server").os;
    expect(os?.up).toBe(true);
    expect(os?.uptimeS).toBeLessThan(5 * MINUTE);
    expect(world.faultsOn("srv-a2")).toHaveLength(0);
    expect(status(world, "svc-license")).toBe("healthy");
  });

  test("a reboot takes the host's services down for two minutes", () => {
    const { world, physics } = boot();
    world.apply({ type: "host.act", target: "srv-a2", action: "reboot" }, "tool:run_command");
    physics.run(30);
    expect(status(world, "svc-license")).toBe("down");
    physics.run(3 * MINUTE);
    expect(status(world, "svc-license")).toBe("healthy");
  });

  test("a fault ended by someone else leaves a healthy host behind", () => {
    const { world, physics } = boot();
    for (const type of ["dns_failure", "cert_expired", "fs_readonly", "ntp_drift"] as const)
      inject(world, type, "srv-a2");
    physics.run(10 * MINUTE);
    expect(status(world, "svc-license")).toBe("down");
    for (const fault of world.faults())
      world.apply({ type: "fault.remove", faultId: fault.id }, "technician");
    physics.run(MINUTE);
    expect(status(world, "svc-license")).toBe("healthy");
  });

  test("replaying the same events gives the same hosts", () => {
    const run = () => {
      const { world, physics } = boot();
      inject(world, "memory_leak", "srv-a2", { pctPerMin: 3 });
      physics.run(20 * MINUTE);
      return JSON.stringify(world.snapshot().state);
    };
    expect(run()).toBe(run());
  });
});
