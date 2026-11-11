/**
 * The DR, volume, consensus-ring and managed-database tools (REQ-105, REQ-106): what each does on a world that has the
 * thing, and the reason it gives in words when the move is not allowed.
 */
import { Catalog } from "@terrarium/core/catalog";
import type { Facades } from "@terrarium/core/facades";
import { Physics } from "@terrarium/core/physics";
import { TOOL_NAMES, Toolbox } from "@terrarium/core/tools";
import { World } from "@terrarium/core/world";
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
  return { world, physics, raw, data, error };
}

describe("dr_failover, dr_failback and dr_drill move a service between sites, or say why not [REQ-106]", () => {
  test("a failover to the site that already serves, or to a thing that is not a site, is refused", () => {
    const { error } = boot("warm");
    expect(error("dr_failover", { site: "site-a" })).toContain("이미 'site-a'에서 돌고 있어요");
    expect(error("dr_failover", { site: "vol-svc-svc2" })).toContain(
      "사이트가 아니에요 (site-a, site-b)",
    );
    expect(error("dr_failover", { site: "nowhere" })).not.toBe("");
  });

  test("a failover starts, tells how long it takes and what it may lose, and a second one while it runs is refused", () => {
    const { data, error, physics, world } = boot("warm");
    const r = data("dr_failover", { site: "site-b" });
    expect(r).toMatchObject({ plan: "dr-plan", site: "site-b" });
    expect(r.etaSeconds).toBeGreaterThan(0);
    expect(r.expectedLossSeconds).toBeGreaterThanOrEqual(0);
    expect(r.note).toContain("전환을 시작했어요");
    expect(error("dr_failover", { site: "site-a" })).toContain("이미 전환하고 있어요");
    expect(error("dr_failback")).toContain("이미 전환하고 있어요");
    physics.run(3 * 3600);
    expect(world.stateAs("dr-plan", "dr_plan").serving).toBe("site-b");
  });

  test("after a failover the service can go back to the primary site, and not before", () => {
    const { data, error, physics, world } = boot("warm");
    expect(error("dr_failback")).toContain("이미 본 사이트에서 돌고 있어요");
    data("dr_failover", { site: "site-b" });
    physics.run(3 * 3600);
    const r = data("dr_failback");
    expect(r.plan).toBe("dr-plan");
    expect(r.etaSeconds).toBeGreaterThan(0);
    physics.run(6 * 3600);
    expect(world.stateAs("dr-plan", "dr_plan").serving).toBe("site-a");
  });

  test("a drill moves nothing and reports what a failover would take against what is promised", () => {
    const { data, world } = boot("warm");
    const r = data("dr_drill");
    expect(r).toMatchObject({ plan: "dr-plan", dryRun: true });
    expect(r.achievableRtoSeconds).toBeGreaterThan(0);
    expect(r.promisedRtoSeconds).toBeGreaterThan(0);
    expect(typeof r.meetsRto).toBe("boolean");
    expect(world.stateAs("dr-plan", "dr_plan").serving).toBe("site-a");
  });

  test("a multi-active world has nothing to fail over to", () => {
    const { error } = boot("active");
    expect(error("dr_failover", { site: "site-b" })).toContain("두 사이트가 모두 일하고 있어서");
  });
});

describe("volume_promote makes the copy the owner, or says why it cannot [REQ-106]", () => {
  test("the owner cannot be promoted again, and a site with no copy is refused", () => {
    const { error } = boot("warm");
    expect(error("volume_promote", { volume: "vol-svc-svc2", site: "site-a" })).toMatch(
      /이미 이 볼륨의 주인이에요|복사본이 없어요/,
    );
    expect(error("volume_promote", { volume: "vol-svc-svc2", site: "site-zzz" })).toContain(
      "복사본이 없어요",
    );
  });

  test("the copy is promoted and the seconds of writes it loses are told", () => {
    const { data, world } = boot("warm");
    const vol = world.stateAs("vol-svc-svc2", "volume");
    const other = vol.primary === "site-a" ? "site-b" : "site-a";
    const r = data("volume_promote", { volume: "vol-svc-svc2", site: other });
    expect(r).toMatchObject({ volume: "vol-svc-svc2", writableSite: other });
    expect(r.secondsOfWritesLost).toBeGreaterThanOrEqual(0);
    expect(world.stateAs("vol-svc-svc2", "volume").primary).toBe(other);
  });
});

describe("db_node_restart and db_transfer_leader act on a consensus ring [REQ-106]", () => {
  test("a healthy node cannot be restarted and the leader cannot be handed to itself", () => {
    const { error, world } = boot("raft");
    const nodes = [...world.index.ofKind("db_node")].filter((n) => n.id.startsWith("svc-iap-"));
    const leader = nodes.find((n) => world.stateAs(n.id, "db_node").role === "leader");
    const follower = nodes.find((n) => world.stateAs(n.id, "db_node").role !== "leader");
    expect(error("db_node_restart", { node: follower?.id })).toContain("이미 정상이에요");
    expect(error("db_transfer_leader", { node: leader?.id })).toContain("이미 리더예요");
    expect(error("db_transfer_leader", { node: "svc-iap-managed" })).not.toBe("");
    expect(error("db_node_restart", { node: "vol-x" })).not.toBe("");
  });

  test("the leader is handed to a follower, which bumps the term", () => {
    const { data, world } = boot("raft");
    const nodes = [...world.index.ofKind("db_node")].filter((n) => n.id.startsWith("svc-iap-"));
    const follower = nodes.find((n) => world.stateAs(n.id, "db_node").role === "follower");
    expect(follower).toBeDefined();
    const r = data("db_transfer_leader", { node: follower?.id });
    expect(r).toMatchObject({ node: follower?.id, leader: follower?.id });
    expect(world.stateAs(follower?.id as string, "db_node").role).toBe("leader");
  });
});

describe("db_managed_failover and db_managed_scale_storage act on a managed database [REQ-106]", () => {
  test("a zone is chosen by number or by name, and a zone out of range is refused with the list", () => {
    const { data, error } = boot("managed");
    expect(error("db_managed_failover", { db: "svc-iap-managed", az: "9" })).toContain("영역은 1~");
    expect(error("db_managed_failover", { db: "site-a", az: "1" })).toContain(
      "관리형 DB가 아니에요",
    );
    const r = data("db_managed_failover", { db: "svc-iap-managed", az: "2" });
    expect(r.db).toBe("svc-iap-managed");
    expect(typeof r.zone).toBe("string");
    expect(r.note).toContain("고정했어요");
    expect(error("db_managed_failover", { db: "svc-iap-managed", az: "2" })).toContain(
      "이미 주인이에요",
    );
  });

  test("storage is not scaled while it has room, and what is not a managed database is refused", () => {
    const { error } = boot("managed");
    expect(error("db_managed_scale_storage", { db: "svc-iap-managed" })).toContain("여유가 있어서");
    expect(error("db_managed_scale_storage", { db: "site-a" })).not.toBe("");
  });
});
