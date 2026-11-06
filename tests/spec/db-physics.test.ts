/**
 * The database and storage-HA layers (REQ-095, ADR-0107 item 6): what each fault does to the instances, the cluster,
 * the pool and the services that lean on them, and what the tools and the cluster itself do about it.
 */
import { Catalog } from "@terrarium/core/catalog";
import type { Facades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { TOOL_NAMES, Toolbox } from "@terrarium/core/tools";
import { type FaultType, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { type DbLabOptions, dbLab } from "../../packages/core/src/world/test-support/db-lab";

const MINUTE = 60;

function lab(options: DbLabOptions) {
  const world = World.fromBlueprint(dbLab(options), new Catalog());
  const physics = new Physics(world);
  physics.settle();
  physics.run(5 * MINUTE);
  const box = new Toolbox(TOOL_NAMES);
  const ctx = { world, facades: {} as Facades };
  const raw = (tool: string, args: Record<string, unknown>) => box.call(tool, args, ctx);
  const call = (tool: string, args: Record<string, unknown>) => {
    const r = raw(tool, args);
    expect(r.error, `${tool}: ${r.error}`).toBeUndefined();
    return r.data as any;
  };
  const inject = (type: FaultType, target: string, params: Record<string, number> = {}) =>
    world.apply(
      { type: "fault.add", fault: { id: `f-${type}-${target}`, type, target, params } },
      "scenario",
    );
  const status = (id: string) => world.stateAs(id, "service").status;
  const sh = (host: string, cmd: string) =>
    call("run_command", { host, cmd }) as { output: string; exitCode: number };
  return { world, physics, call, raw, inject, status, sh };
}

describe("a healthy database cluster [REQ-095]", () => {
  test("services that lean on it are healthy and the copies trail by a fraction of a second", () => {
    const { world, call, status } = lab({ shape: "replicated" });
    expect(status("svc-web")).toBe("healthy");
    expect(status("svc-license")).toBe("healthy");
    const s = call("db_status", { cluster: "db-main" });
    expect(s.primary).toBe("db-1");
    expect(s.instances.map((i: any) => i.role)).toEqual(["primary", "secondary"]);
    expect(s.instances[1].lagSeconds).toBeLessThan(1);
    expect(world.stateAs("db-main", "db_cluster").splitBrain).toBe(false);
  });
});

describe("the primary goes down, a person promotes [REQ-095]", () => {
  test("before the promotion a request service reads on (slow), a stateful one stops; db_promote brings both back", () => {
    const { physics, call, inject, status, world } = lab({ shape: "replicated" });
    inject("db_primary_down", "db-1");
    physics.run(MINUTE);
    expect(status("svc-web")).toBe("degraded");
    expect(status("svc-license")).toBe("down");
    expect(world.alarms().some((a) => a.code === "db_instance_down" && a.entityId === "db-1")).toBe(
      true,
    );
    const r = call("db_promote", { instance: "db-2" });
    expect(r.lostSeconds).toBeLessThan(1);
    physics.run(MINUTE);
    expect(status("svc-web")).toBe("healthy");
    expect(status("svc-license")).toBe("healthy");
    expect(call("db_status", { cluster: "db-main" }).primary).toBe("db-2");
  });

  test("a promotion loses the writes the copy was behind, and says so", () => {
    const { physics, call, inject } = lab({ shape: "replicated" });
    inject("db_replication_broken", "db-2", { lagPerMin: 600 });
    physics.run(3 * MINUTE);
    inject("db_primary_down", "db-1");
    physics.run(MINUTE);
    const r = call("db_promote", { instance: "db-2" });
    expect(r.lostSeconds).toBeGreaterThan(1500);
    expect(r.note).toContain("잃었어요");
    physics.run(MINUTE);
    expect(call("db_status", { cluster: "db-main" }).instances[0].dataLoss).toBeUndefined();
    expect(call("db_status", { cluster: "db-main" }).instances[1].dataLoss).toContain("잃었어요");
  });

  test("a restart does not bring a primary with broken data files back, and a single instance restores from a backup", () => {
    const { physics, call, inject, status, sh } = lab({ shape: "single" });
    inject("db_primary_down", "db-1");
    physics.run(MINUTE);
    expect(status("svc-web")).toBe("down");
    expect(sh("vm-db-1", "pg_isready").exitCode).toBe(2);
    const restart = call("run_command", { host: "vm-db-1", cmd: "systemctl restart postgresql" });
    expect(restart.exitCode).toBe(1);
    expect(call("db_status", { cluster: "db-1" }).instances[0].status).toBe("down");
    const r = call("db_restore", { instance: "db-1" });
    expect(r.note).toContain("멈춰요");
    physics.run(10 * MINUTE);
    expect(status("svc-web")).toBe("down");
    physics.run(15 * MINUTE);
    expect(status("svc-web")).toBe("healthy");
    expect(call("db_status", { cluster: "db-main" }).instances[0].dataLoss).toContain("잃었어요");
  });

  test("a damaged backup fails the restore after a few minutes; an older one works", () => {
    const { physics, call, inject, status } = lab({ shape: "single" });
    inject("db_backup_corrupt", "db-main");
    inject("db_primary_down", "db-1");
    physics.run(MINUTE);
    call("db_restore", { instance: "db-1", backup: "latest" });
    physics.run(6 * MINUTE);
    const failed = call("db_status", { cluster: "db-main" }).instances[0];
    expect(failed.lastRestoreError).toContain("깨져");
    expect(status("svc-web")).toBe("down");
    call("db_restore", { instance: "db-1", backup: "backup-2" });
    physics.run(25 * MINUTE);
    expect(status("svc-web")).toBe("healthy");
  });
});

describe("a cluster that fails over by itself [REQ-095]", () => {
  test("it waits the detection time, then promotes with the cause cluster; the agent did nothing", () => {
    const { world, physics, inject, status } = lab({ shape: "auto_failover", detectS: 30 });
    inject("db_primary_down", "db-1");
    physics.run(20);
    expect(status("svc-license")).toBe("down");
    physics.run(40);
    const promotion = world.events().find((e) => e.type === "db.promote");
    expect(promotion).toMatchObject({
      target: expect.stringMatching(/^db-[23]$/),
      cause: "cluster",
    });
    expect(promotion?.t).toBeGreaterThanOrEqual(world.time() - 60);
    expect(status("svc-license")).toBe("healthy");
    expect(world.stateAs("db-main", "db_cluster").failovers).toBe(1);
  });

  test("db_status tells how long until it promotes", () => {
    const { physics, call, inject } = lab({ shape: "auto_failover", detectS: 120 });
    inject("db_primary_down", "db-1");
    physics.run(30);
    const s = call("db_status", { cluster: "db-main" });
    expect(s.autoFailover.promotesInSeconds).toBeGreaterThan(60);
    expect(s.autoFailover.promotesInSeconds).toBeLessThanOrEqual(120);
  });

  test("an active-passive cluster is stopped a while longer: the standby has to start", () => {
    const { physics, inject, status, world } = lab({ shape: "active_passive", storage: "dual" });
    inject("db_primary_down", "db-1");
    physics.run(60);
    expect(status("svc-web")).toBe("down");
    physics.run(60);
    expect(world.stateAs("db-main", "db_cluster").primary).toBe("db-2");
    expect(status("svc-web")).toBe("down");
    physics.run(120);
    expect(status("svc-web")).toBe("healthy");
  });

  test("split brain: no promotion by itself, stateful services stop, and choosing one instance ends it", () => {
    const { physics, call, inject, status, world, raw } = lab({ shape: "auto_failover" });
    inject("db_split_brain", "db-main");
    physics.run(2 * MINUTE);
    expect(world.stateAs("db-main", "db_cluster").splitBrain).toBe(true);
    expect(status("svc-license")).toBe("down");
    expect(status("svc-web")).toBe("degraded");
    expect(raw("db_failover", { cluster: "db-main" }).ok).toBe(false);
    const roles = call("db_status", { cluster: "db-main" }).instances.map((i: any) => i.role);
    expect(roles.filter((r: string) => r === "primary")).toHaveLength(2);
    const r = call("db_promote", { instance: "db-1" });
    expect(r.discardedSeconds).toBeGreaterThan(100);
    physics.run(MINUTE);
    expect(status("svc-license")).toBe("healthy");
    expect(world.faults()).toEqual([]);
    expect(world.stateAs("db-main", "db_cluster").primary).toBe("db-1");
  });
});

describe("replication breaks [REQ-095]", () => {
  test("the lag climbs past the limit, the service slows; restarting the instance heals it", () => {
    const { physics, call, inject, status, sh, world } = lab({ shape: "replicated" });
    inject("db_replication_broken", "db-2", { lagPerMin: 20 });
    physics.run(MINUTE);
    expect(status("svc-web")).toBe("healthy");
    physics.run(3 * MINUTE);
    expect(status("svc-web")).toBe("degraded");
    expect(world.alarms().some((a) => a.code === "db_replication_lag")).toBe(true);
    expect(sh("vm-db-2", 'psql -c "select pg_is_in_recovery()"').output).toContain(" t");
    expect(
      sh("vm-db-2", 'psql -c "select now() - pg_last_xact_replay_timestamp()"').output,
    ).toMatch(/00:0[1-9]:\d\d/);
    expect(sh("vm-db-1", 'psql -c "select pg_is_in_recovery()"').output).toContain(" f");
    sh("vm-db-2", "systemctl restart postgresql");
    physics.run(3 * MINUTE);
    expect(status("svc-web")).toBe("healthy");
    expect(call("db_status", { cluster: "db-main" }).instances[1].lagSeconds).toBeLessThan(1);
  });

  test("a secondary that is down does not stop the service; restarting brings it back", () => {
    const { physics, inject, status, sh, world } = lab({ shape: "replicated" });
    inject("db_secondary_down", "db-2");
    physics.run(MINUTE);
    expect(status("svc-web")).toBe("healthy");
    expect(status("svc-license")).toBe("healthy");
    sh("vm-db-2", "systemctl restart postgresql");
    expect(world.faults()).toEqual([]);
  });
});

describe("a full disk on the database host [REQ-095]", () => {
  test("the primary cannot write: a request service is slow, a stateful one stops", () => {
    const { physics, inject, status } = lab({ shape: "replicated" });
    inject("disk_full", "vm-db-1");
    physics.run(MINUTE);
    expect(status("svc-web")).toBe("degraded");
    expect(status("svc-license")).toBe("down");
  });
});

describe("shared disk [REQ-095]", () => {
  test("an active-active node down is slow; the shared disk gone stops everything", () => {
    const { physics, inject, status } = lab({ shape: "shared_aa", storage: "dual" });
    inject("db_secondary_down", "db-2");
    physics.run(MINUTE);
    expect(status("svc-web")).toBe("degraded");
    inject("storage_controller_failure", "ctl-a");
    physics.run(MINUTE);
    expect(status("svc-web")).toBe("down");
    expect(status("svc-license")).toBe("down");
  });

  test("a cut path without multipath stops the pool until someone switches the path", () => {
    const { physics, call, inject, status, raw } = lab({ shape: "shared_aa", storage: "dual" });
    inject("storage_path_cut", "ctl-a");
    physics.run(MINUTE);
    expect(status("svc-license")).toBe("down");
    expect(call("storage_status", { id: "pool-db" })).toMatchObject({
      status: "down",
      multipath: false,
      activePath: "ctl-a",
    });
    expect(raw("storage_path_switch", { controller: "ctl-a" }).ok).toBe(false);
    call("storage_path_switch", { controller: "ctl-b" });
    physics.run(MINUTE);
    expect(status("svc-license")).toBe("healthy");
    expect(call("storage_status", { id: "ctl-b" }).pool.activePath).toBe("ctl-b");
  });

  test("with multipath a dead controller only slows: the hosts switch by themselves", () => {
    const { physics, inject, status, call, sh } = lab({
      shape: "replicated",
      storage: "multipath",
    });
    expect(sh("vm-db-1", "multipath -ll").output).toContain("status=active");
    inject("storage_controller_failure", "ctl-a");
    physics.run(5);
    expect(status("svc-web")).not.toBe("down");
    physics.run(MINUTE);
    expect(status("svc-web")).toBe("degraded");
    expect(status("svc-license")).toBe("degraded");
    expect(call("storage_status", { id: "pool-db" })).toMatchObject({
      status: "degraded",
      activePath: "ctl-b",
    });
    expect(sh("vm-db-1", "multipath -ll").output).toContain("failed faulty running");
  });
});

describe("a distributed pool [REQ-095]", () => {
  test("a lost node makes the pool slow while the copy is made again, then it is whole", () => {
    const { physics, call, inject, status, world } = lab({
      shape: "replicated",
      storage: "distributed",
    });
    expect(call("storage_status", { id: "pool-db" })).toMatchObject({
      copies: 3,
      wanted: 3,
      status: "ok",
    });
    inject("storage_node_lost", "stor-c1");
    physics.run(60);
    expect(call("storage_status", { id: "pool-db" })).toMatchObject({
      copies: 2,
      status: "degraded",
    });
    expect(status("svc-web")).toBe("degraded");
    expect(world.alarms().some((a) => a.code === "storage_node_lost")).toBe(true);
    physics.run(10 * MINUTE);
    expect(status("svc-web")).toBe("degraded");
    physics.run(10 * MINUTE);
    expect(call("storage_status", { id: "pool-db" })).toMatchObject({ copies: 3, status: "ok" });
    expect(status("svc-web")).toBe("healthy");
  });

  test("a second node lost before the copy is made stops writes; all copies gone is lost data", () => {
    const { physics, call, inject, status } = lab({ shape: "replicated", storage: "distributed" });
    inject("storage_node_lost", "stor-c1");
    physics.run(5 * MINUTE);
    world2(inject);
    physics.run(60);
    const s = call("storage_status", { id: "pool-db" });
    expect(s).toMatchObject({ copies: 1, status: "down", dataLoss: false });
    expect(status("svc-license")).toBe("down");
    inject("storage_node_lost", "stor-b");
    physics.run(60);
    expect(call("storage_status", { id: "pool-db" })).toMatchObject({ dataLoss: true });
  });
});

function world2(inject: (t: FaultType, target: string) => unknown): void {
  inject("storage_node_lost" as FaultType, "stor-c2");
}
