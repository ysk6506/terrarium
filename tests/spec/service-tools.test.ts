import { Catalog } from "@terrarium/core/catalog";
import type { Facades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { callEffect, TOOL_NAMES, TOOL_SPECS, Toolbox } from "@terrarium/core/tools";
import { type FaultType, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { serviceLab } from "../../packages/core/src/world/test-support/service-lab";

const MINUTE = 60;

function setup() {
  const world = World.fromBlueprint(serviceLab(), new Catalog());
  const physics = new Physics(world);
  physics.settle();
  physics.run(10 * MINUTE);
  const box = new Toolbox(TOOL_NAMES);
  const ctx = { world, facades: {} as Facades };
  const call = (tool: string, args: Record<string, unknown>) => {
    const r = box.call(tool, args, ctx);
    expect(r.error).toBeUndefined();
    return r.data as any;
  };
  const sh = (host: string, cmd: string): string => call("run_command", { host, cmd }).output;
  const inject = (type: FaultType, target: string, params: Record<string, number> = {}) =>
    world.apply(
      { type: "fault.add", fault: { id: `f-${type}`, type, target, params } },
      "scenario",
    );
  return { world, physics, call, sh, inject };
}

describe("every tool is described in the standard order and tagged with how real it is [REQ-080] [REQ-086]", () => {
  test("a summary, when to use and not, an example, access and cost; realism on all of them", () => {
    for (const spec of TOOL_SPECS) {
      for (const part of ["Use when:", "Don't use when:", "Example:", "Access:", "Cost:"])
        expect(spec.description, `${spec.name} ${part}`).toContain(part);
      expect(["common", "rare", "ideal"], spec.name).toContain(spec.realism);
      expect(spec.description.includes("Access: read-only"), spec.name).toBe(!spec.mutating);
    }
    const realism = (n: string) => TOOL_SPECS.find((t) => t.name === n)?.realism;
    expect(realism("get_topology")).toBe("rare");
    expect(realism("get_impact")).toBe("ideal");
    expect(realism("list_alarms")).toBe("common");
    expect(realism("service_status")).toBe("common");
    expect(TOOL_SPECS).toHaveLength(66);
  });
});

describe("the service tools [REQ-086]", () => {
  test("list_services and service_status say what runs where and why it is not healthy", () => {
    const { call, world, physics } = setup();
    expect(call("list_services", {}).map((s: any) => s.id)).toEqual([
      "svc-license",
      "svc-queue",
      "svc-web",
    ]);
    world.apply({ type: "power.set", target: "srv-a2", on: false }, "scenario");
    physics.run(MINUTE);
    expect(call("list_services", { status: "down" })).toHaveLength(2);
    const detail = call("service_status", { service: "svc-license" });
    expect(detail).toMatchObject({
      status: "down",
      places: [{ id: "srv-a2", state: "dead" }],
      standbyPlaces: [{ id: "srv-b1", state: "ok" }],
    });
    expect(detail.cost.estimate).toBe(true);
    expect(call("list_alarms", { kind: "service" })[0]).toMatchObject({
      code: "service_down",
      kind: "service",
    });
  });

  test("failover_service, restart_service and migrate_vm change the world and are recorded as events", () => {
    const { call, world, physics } = setup();
    call("failover_service", { service: "svc-license" });
    call("restart_service", { service: "svc-web" });
    call("migrate_vm", { vm: "vm-db", host: "srv-b1" });
    physics.run(MINUTE);
    expect(world.events().map((e) => e.type)).toEqual(
      expect.arrayContaining(["service.failover", "service.restart", "vm.migrate"]),
    );
    expect(world.stateAs("svc-license", "service").runsOn).toEqual(["srv-b1"]);
    expect(world.stateAs("svc-web", "service").status).toBe("healthy");
  });
});

describe("the fake shell prints what the state says, in the shape of Linux [REQ-087]", () => {
  test("df -h shows the disk filling up, and free -m and top show the leak and who holds it", () => {
    const { sh, inject, physics } = setup();
    expect(sh("srv-a2", "df -h")).toMatch(/^Filesystem +Size +Used Avail Use% Mounted on/);
    inject("memory_leak", "srv-a2", { pctPerMin: 5 });
    physics.run(10 * MINUTE);
    expect(sh("srv-a2", "free -m")).toMatch(
      /^ +total +used +free +shared +buff\/cache +available\nMem:/,
    );
    const top = sh("srv-a2", "top -bn1");
    expect(top).toContain("PID USER");
    const first = top.split("\n").find((l) => /\b(licd|systemd-journald)\b/.test(l)) as string;
    expect(first).toContain("licd");
  });

  test("a crash loop shows in systemctl status and in journalctl", () => {
    const { sh, inject, physics } = setup();
    inject("process_crashloop", "srv-a2");
    physics.run(3 * MINUTE);
    expect(sh("srv-a2", "systemctl status licd")).toContain("activating (auto-restart)");
    const log = sh("srv-a2", "journalctl -n 50 -u licd");
    expect(log).toMatch(
      /Jan 01 \d\d:\d\d:\d\d srv-a2 systemd\[1\]: licd.service: Main process exited, code=exited, status=1\/FAILURE/,
    );
    expect(sh("srv-a2", "journalctl -n 50 | grep -c Scheduled")).toMatch(/^\d+$/);
  });

  test("writes change the world: rm frees the disk, a restart ends a flood, a remount fixes a read-only disk", () => {
    const { sh, inject, physics, world } = setup();
    inject("disk_full", "srv-a2");
    physics.run(MINUTE);
    expect(sh("srv-a2", "df -h")).toContain("100%");
    expect(sh("srv-a2", "rm -f /etc/passwd")).toContain("Operation not permitted");
    sh("srv-a2", "rm -f /var/log/licd/*.log");
    physics.run(MINUTE);
    expect(world.stateAs("srv-a2", "server").os?.diskPct).toBeLessThan(70);
    expect(world.stateAs("svc-license", "service").status).toBe("healthy");
    inject("fs_readonly", "srv-a1");
    physics.run(MINUTE);
    expect(sh("srv-a1", "rm /var/log/messages")).toContain("Read-only file system");
    expect(sh("srv-a1", "mount | grep sda2")).toContain("(ro,");
    sh("srv-a1", "mount -o remount,rw /");
    physics.run(MINUTE);
    expect(sh("srv-a1", "mount | grep sda2")).toContain("(rw,");
    expect(world.events().filter((e) => e.type === "host.act")).toHaveLength(2);
  });

  test("the clock drift is visible in date and chronyc, and restarting chronyd ends it", () => {
    const { sh, inject, physics } = setup();
    inject("ntp_drift", "vm-web", { secPerMin: 120 });
    physics.run(4 * MINUTE);
    expect(sh("vm-web", "chronyc tracking")).toMatch(/System time +: 4\d\d\.\d+ seconds fast/);
    expect(sh("vm-web", "curl -I https://portal.dc.local/")).toContain("401 Unauthorized");
    sh("vm-web", "systemctl restart chronyd");
    physics.run(MINUTE);
    expect(sh("vm-web", "curl -I https://portal.dc.local/")).toContain("200 OK");
  });

  test("ping and curl tell a dead host from a dead process, and name lookup fails when DNS does", () => {
    const { sh, inject, physics, world } = setup();
    expect(sh("srv-a1", "ping -c 2 srv-b1")).toContain("2 packets transmitted, 2 received");
    world.apply({ type: "power.set", target: "srv-b1", on: false }, "scenario");
    physics.run(MINUTE);
    expect(sh("srv-a1", "ping -c 2 srv-b1")).toContain("100% packet loss");
    inject("dns_failure", "srv-a1");
    physics.run(MINUTE);
    expect(sh("srv-a1", "ping srv-a2")).toContain("Name or service not known");
    expect(sh("srv-a1", "curl -I https://licd.dc.local/")).toContain("Could not resolve host");
  });

  test("a command outside the list is an answer, not an error; a host that is down cannot be logged in to", () => {
    const { call, sh, world, physics } = setup();
    const out = call("run_command", { host: "srv-a1", cmd: "vim /etc/hosts" });
    expect(out).toMatchObject({ exitCode: 127, outside: ["vim"] });
    expect(out.output).toBe("bash: vim: command not found");
    expect(sh("srv-a1", "ps aux | grep sshd")).toContain("sshd");
    world.apply({ type: "power.set", target: "srv-a1", on: false }, "scenario");
    physics.run(MINUTE);
    expect(sh("srv-a1", "uptime")).toContain("Connection timed out");
  });

  test("callEffect knows which commands change the world", () => {
    expect(callEffect("run_command", { host: "a", cmd: "df -h" })).toBe("observe");
    expect(callEffect("run_command", { host: "a", cmd: "systemctl restart x" })).toBe("act");
    expect(callEffect("run_command", { host: "a", cmd: "systemctl status x" })).toBe("observe");
  });
});
