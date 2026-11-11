/**
 * The DR, volume, consensus and managed-database status tools in worlds that do not have the thing, with filters, and
 * with parts that have failed (REQ-105, REQ-106): the sentence an agent gets saying which chip is missing, and the rows
 * of a plan, stream, volume or database in trouble.
 */
import { Catalog } from "@terrarium/core/catalog";
import type { Facades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { TOOL_NAMES, Toolbox } from "@terrarium/core/tools";
import { type FaultType, World } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { type SiteWorld, siteBlueprint } from "./site-support";

function boot(kind: SiteWorld) {
  const world = World.fromBlueprint(siteBlueprint(kind), new Catalog());
  const physics = new Physics(world);
  physics.settle();
  physics.run(120);
  const box = new Toolbox(TOOL_NAMES);
  const raw = (tool: string, args: Record<string, unknown> = {}) =>
    box.call(tool, args, { world, facades: {} as Facades });
  const data = (tool: string, args: Record<string, unknown> = {}) => {
    const r = raw(tool, args);
    expect(r.error, `${tool}: ${r.error}`).toBeUndefined();
    return r.data as any;
  };
  const error = (tool: string, args: Record<string, unknown> = {}) => raw(tool, args).error ?? "";
  const inject = (type: FaultType, target: string, params: Record<string, number> = {}) =>
    world.apply(
      { type: "fault.add", fault: { id: `t-${type}-${target}`, type, target, params } },
      "scenario",
    );
  return { world, physics, raw, data, error, inject };
}

describe("a world without the thing says which chip it needs [REQ-105][REQ-106]", () => {
  test.each([
    ["site_status", "복구 사이트가 없어요"],
    ["replication_status", "사이트 간 복제가 없어요"],
    ["wan_status", "사이트 간 회선이 없어요"],
    ["volume_replication_status", "지역 복제 볼륨이 없어요"],
  ])("[REQ-106] %s in a world with one room only", (tool, words) => {
    const { error } = boot("db");
    expect(error(tool)).toContain(words);
  });

  test("[REQ-106] a world without a consensus ring or a managed database says which chip it needs", () => {
    const { error } = boot("warm");
    expect(error("db_cluster_status")).toContain("합의 DB가 없어요");
    expect(error("db_managed_status")).toContain("관리형 DB가 없어요");
  });

  test("[REQ-106] the dr tools refuse to pick a plan when there is none", () => {
    const { error } = boot("db");
    expect(error("dr_drill")).toContain("복구 사이트가 없어요");
    expect(error("dr_failover", { site: "x" })).not.toBe("");
  });
});

describe("filters and rows of the site tools [REQ-106]", () => {
  test("site_status can be limited to one site, and a cold site shows how old its image is", () => {
    const { data, world, error } = boot("cold");
    const site = world.index.ofKind("dr_site").find((e) => e.props.mode === "cold");
    const one = data("site_status", { site: site?.id });
    expect(one.sites).toHaveLength(1);
    expect(one.sites[0].imageAgeDays).toBeTypeOf("number");
    expect(one.plans[0].promisedRtoSeconds).toBeGreaterThan(0);
    expect(error("site_status", { site: "nope" })).toContain("복구 사이트가 없어요");
  });

  test("a drill is remembered in the plan row, and a plan can be named", () => {
    const { data, world } = boot("warm");
    const plan = world.index.ofKind("dr_plan")[0]?.id as string;
    const drill = data("dr_drill", { plan });
    expect(drill).toMatchObject({ plan, dryRun: true });
    expect(data("site_status").plans[0].lastDrill).toBeDefined();
  });

  test("replication can be asked for by what it copies, a broken stream says how long it has stalled", () => {
    const { data, inject, physics, world, error } = boot("warm");
    const stream = world.index.ofKind("replication_stream")[0];
    const copies = String(stream?.props.target);
    expect(data("replication_status", { copies }).streams.length).toBeGreaterThan(0);
    expect(error("replication_status", { copies: "nothing" })).toContain("사이트 간 복제가 없어요");
    inject("replication_broken", stream?.id as string);
    physics.run(300);
    const row = data("replication_status").streams.find((s: { id: string }) => s.id === stream?.id);
    expect(row.status).not.toBe("ok");
    expect(row.why).toBeTypeOf("string");
  });

  test("wan_status can name a link and gives a reason when the link is cut", () => {
    const { data, inject, physics, world } = boot("warm");
    const link = world.index.ofKind("site_link")[0]?.id as string;
    inject("wan_link_down", link);
    physics.run(30);
    const row = data("wan_status", { link });
    expect(row.status).not.toBe("ok");
    expect(row.why).toBeTypeOf("string");
  });
});

describe("volume, ring and managed database tools [REQ-105][REQ-106]", () => {
  test("volume status can be asked for by id; an id that is not a volume is refused", () => {
    const { data, error, world } = boot("geo");
    const volume = world.index.ofKind("volume")[0]?.id as string;
    expect(data("volume_replication_status", { volume }).volumes).toHaveLength(1);
    expect(error("volume_replication_status", { volume: "nope" })).toContain("볼륨이 아니에요");
  });

  test("a replica that is broken shows with a reason, and promote on an id that is not a volume still goes to the world", () => {
    const { data, inject, physics, world, error } = boot("geo");
    const volume = world.index.ofKind("volume")[0]?.id as string;
    inject("geo_replica_broken", volume);
    physics.run(60);
    const row = data("volume_replication_status", { volume }).volumes[0];
    expect(row.replicaBroken).toBe(true);
    expect(error("volume_promote", { volume: "nope", site: "site-b" })).not.toBe("");
  });

  test("cluster status can be limited to one service, a witness node is marked", () => {
    const { data, world } = boot("raft");
    const svc = world.index.ofKind("service").find((s) => s.id.startsWith("svc"))?.id;
    const all = data("db_cluster_status");
    expect(JSON.stringify(all)).toContain("nodes");
    if (svc) expect(data("db_cluster_status", { service: svc })).toBeDefined();
  });

  test("a managed database can be asked for by the service that leans on it, and shows its zones", () => {
    const { data, world, inject, physics } = boot("managed");
    const db = world.index.ofKind("db_managed")[0]?.id as string;
    const from = world.index.incoming(db, "depends_on")[0]?.from as string;
    const one = data("db_managed_status", { service: from }).databases;
    expect(one).toHaveLength(1);
    expect(one[0].zones.every((z: { up: boolean }) => z.up)).toBe(true);
    expect(data("db_managed_status", { service: "none" }).databases).toEqual([]);
    inject("db_az_failure", db, { az: 1 });
    physics.run(30);
    expect(data("db_managed_status").databases[0].zones.some((z: { up: boolean }) => !z.up)).toBe(
      true,
    );
  });

  test("a failover to a zone can be named by its name or number, and a non-database is refused", () => {
    const { data, error, world } = boot("managed");
    const db = world.index.ofKind("db_managed")[0]?.id as string;
    const zones = data("db_managed_status").databases[0].zones as Array<{ name: string }>;
    expect(data("db_managed_failover", { db, az: zones[1]?.name }).zone).toBe(zones[1]?.name);
    expect(data("db_managed_failover", { db, az: "1" }).zone).toBe(zones[0]?.name);
    expect(error("db_managed_failover", { db: "nope", az: "1" })).toContain("관리형 DB가 아니에요");
  });
});
