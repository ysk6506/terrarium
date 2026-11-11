/**
 * What `pg_isready`, `psql` and `multipath` print on a database host (REQ-095, REQ-098): made from the state of the
 * instance and its storage, in the shape of the real tools, and in the tool's own words when the query is one the fake
 * does not answer.
 */
import { Catalog } from "@terrarium/core/catalog";
import type { Facades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { TOOL_NAMES, Toolbox } from "@terrarium/core/tools";
import { type FaultType, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { type DbLabOptions, dbLab } from "../../packages/core/src/world/test-support/db-lab";

function lab(options: DbLabOptions) {
  const world = World.fromBlueprint(dbLab(options), new Catalog());
  const physics = new Physics(world);
  physics.settle();
  physics.run(300);
  const box = new Toolbox(TOOL_NAMES);
  const sh = (host: string, cmd: string) => {
    const r = box.call("run_command", { host, cmd }, { world, facades: {} as Facades });
    return r.data as { output: string; exitCode: number; outside: string[] };
  };
  const inject = (type: FaultType, target: string) =>
    world.apply(
      { type: "fault.add", fault: { id: `f-${type}-${target}`, type, target, params: {} } },
      "scenario",
    );
  return { world, physics, sh, inject };
}

describe("pg_isready answers for the instance on the host [REQ-095]", () => {
  test("a running instance is accepting connections and a down one gives no response", () => {
    const { sh, inject, physics } = lab({ shape: "replicated" });
    expect(sh("vm-db-1", "pg_isready")).toMatchObject({
      output: "/var/run/postgresql:5432 - accepting connections",
      exitCode: 0,
    });
    inject("db_primary_down", "db-1");
    physics.run(60);
    expect(sh("vm-db-1", "pg_isready")).toMatchObject({
      output: "/var/run/postgresql:5432 - no response",
      exitCode: 2,
    });
    expect(sh("vm-db-2", "pg_isready").exitCode).toBe(0);
  });

  test("on a host with no database there is no such command", () => {
    const { sh } = lab({ shape: "replicated" });
    for (const cmd of ["pg_isready", "psql -c 'select 1'", "multipath -ll"]) {
      expect(sh("srv-a1", cmd), cmd).toMatchObject({ exitCode: 127 });
      expect(sh("srv-a1", cmd).output).toContain("command not found");
    }
  });
});

describe("psql answers the few queries a person asks to see the state [REQ-095] [REQ-098]", () => {
  test("a primary is not in recovery and a standby is, and the standby's lag is an interval", () => {
    const { sh } = lab({ shape: "replicated" });
    expect(sh("vm-db-1", 'psql -c "select pg_is_in_recovery()"').output).toBe(
      " pg_is_in_recovery \n-------------------\n f\n(1 row)",
    );
    expect(sh("vm-db-2", 'psql -tAc "select pg_is_in_recovery()"').output).toBe("t");
    expect(sh("vm-db-1", "psql -tAc 'select now() - pg_last_xact_replay_timestamp()'").output).toBe(
      "",
    );
    expect(
      sh("vm-db-2", "psql -tAc 'select now() - pg_last_xact_replay_timestamp()'").output,
    ).toMatch(/\d/);
  });

  test("select 1 and select version() are answered, in a table or bare with -t, and the case and the semicolon do not matter", () => {
    const { sh } = lab({ shape: "replicated" });
    expect(sh("vm-db-1", "psql -c 'SELECT 1;'").output).toContain("(1 row)");
    expect(sh("vm-db-1", "psql -tAc 'select   1'").output).toBe("1");
    expect(sh("vm-db-1", "psql -tAc 'select version()'").output).toBe(
      "PostgreSQL 16.2 on x86_64-pc-linux-gnu",
    );
  });

  test("a query the fake does not answer says which ones it does, and a session without -c is outside it", () => {
    const { sh } = lab({ shape: "replicated" });
    const r = sh("vm-db-1", "psql -c 'select 2'");
    expect(r.exitCode).toBe(2);
    expect(r.output).toContain("이 질의는 아직 못 해요: select 2");
    expect(r.output).toContain("되는 질의: select pg_is_in_recovery()");
    expect(r.outside).toEqual(['psql 질의 "select 2"']);
    const interactive = sh("vm-db-1", "psql");
    expect(interactive.exitCode).toBe(2);
    expect(interactive.outside).toEqual(["psql 대화형 접속과 -f"]);
  });

  test("when the instance is down psql cannot connect", () => {
    const { sh, inject, physics } = lab({ shape: "replicated" });
    inject("db_primary_down", "db-1");
    physics.run(60);
    const r = sh("vm-db-1", "psql -c 'select 1'");
    expect(r.exitCode).toBe(2);
    expect(r.output).toContain("connection");
  });
});

describe("multipath -ll lists the paths of a host to its storage [REQ-095]", () => {
  test("without dual controllers and multipath the driver is not loaded", () => {
    const { sh } = lab({ shape: "replicated" });
    expect(sh("vm-db-1", "multipath -ll")).toMatchObject({
      output: "Nov 06 12:00:00 | DM multipath kernel driver not loaded",
      exitCode: 1,
    });
  });

  test("with both controllers up each path is active or enabled, and a dead controller's path is failed", () => {
    const { sh, inject, physics } = lab({ shape: "replicated", storage: "multipath" });
    const healthy = sh("vm-db-1", "multipath -ll").output.split("\n");
    expect(healthy[0]).toMatch(/^mpatha \(.+\) dm-2 TERRA,ARRAY C-Mode$/);
    expect(healthy.filter((l) => l.includes("status=active"))).toHaveLength(1);
    expect(healthy.filter((l) => l.includes("status=enabled"))).toHaveLength(1);
    expect(healthy.filter((l) => l.includes("active ready running"))).toHaveLength(2);
    inject("storage_controller_failure", "ctl-a");
    physics.run(60);
    const hurt = sh("vm-db-1", "multipath -ll").output;
    expect(hurt).toContain("failed faulty running");
    expect(hurt).toContain("active ready running");
  });

  test("a cut path is offline, not running", () => {
    const { sh, inject, physics } = lab({ shape: "replicated", storage: "multipath" });
    inject("storage_path_cut", "ctl-a");
    physics.run(60);
    expect(sh("vm-db-1", "multipath -ll").output).toContain("failed faulty offline");
  });
});
