/**
 * The site and DR layer reads what a blueprint leaves out the way its documentation says (REQ-106, ADR-0129): a site with
 * no distance is 100 km away, a plan with no promise promises what its mode can keep, a world with no line between the
 * sites has the ordinary 3 ms one. And a move is worked out from the plan alone when the pieces around it are missing.
 */
import { Catalog } from "@terrarium/core/catalog";
import {
  azNames,
  type Blueprint,
  BlueprintIndex,
  buildingOf,
  drillOf,
  drPlanDef,
  drSiteDef,
  drTargets,
  type Entity,
  type EntityKind,
  effectiveRtoS,
  linkState,
  ringDown,
  serversOfSite,
  siteOf,
  streamDef,
  WARM_FAILOVER_S,
  World,
} from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { siteLab } from "./site-lab";
import { siteBlueprint } from "./site-support";

const thing = (id: string, kind: EntityKind, props: Entity["props"] = {}, parentId?: string) =>
  ({ id, kind, name: id, props, ...(parentId ? { parentId } : {}) }) as Entity;
const indexOf = (entities: Entity[], links: Blueprint["links"] = []) =>
  new BlueprintIndex({ schemaVersion: 1, id: "b", name: "b", entities, links, meta: {} });

describe("what a site, a plan and a stream are when the blueprint says nothing [REQ-106]", () => {
  test("[REQ-106] a site is a primary one, warm, 100 km and 3 ms away, and the roles dr and active are kept", () => {
    expect(drSiteDef(thing("s", "dr_site"))).toEqual({
      role: "primary",
      mode: "warm",
      distanceKm: 100,
      linkMs: 3,
    });
    expect(
      drSiteDef(thing("s", "dr_site", { role: "dr", mode: "cold", distanceKm: 40, linkMs: 9 })),
    ).toEqual({
      role: "dr",
      mode: "cold",
      distanceKm: 40,
      linkMs: 9,
    });
    expect(drSiteDef(thing("s", "dr_site", { role: "active" })).role).toBe("active");
    expect(drSiteDef(thing("s", "dr_site", { role: "spare" })).role).toBe("primary");
  });

  test("[REQ-106] a plan with no promise promises the warm failover time and a minute of writes, and does not move by itself", () => {
    expect(drPlanDef(thing("p", "dr_plan"))).toEqual({
      mode: "warm",
      primary: "",
      dr: "",
      rtoS: WARM_FAILOVER_S,
      rpoS: 60,
      auto: false,
      share: 1,
    });
    expect(
      drPlanDef(
        thing("p", "dr_plan", {
          mode: "hot",
          primary: "a",
          dr: "b",
          rtoS: 120,
          rpoS: 0,
          auto: true,
          share: 0.5,
        }),
      ),
    ).toEqual({ mode: "hot", primary: "a", dr: "b", rtoS: 120, rpoS: 0, auto: true, share: 0.5 });
  });

  test("[REQ-106] a stream with no mode is asynchronous, and a managed database has two zones", () => {
    expect(streamDef(thing("x", "replication_stream"))).toEqual({
      target: "",
      mode: "async",
      link: "",
    });
    expect(
      streamDef(thing("x", "replication_stream", { mode: "sync", target: "v", link: "l" })),
    ).toEqual({
      target: "v",
      mode: "sync",
      link: "l",
    });
    expect(azNames(thing("m", "db_managed"))).toEqual(["az-a", "az-b"]);
    expect(azNames(thing("m", "db_managed", { azs: "z1,,z3" }))).toEqual(["z1", "z3"]);
  });
});

describe("where something stands, when the places are not all there [REQ-106]", () => {
  test("[REQ-106] a thing with no building, a VM on nothing, a cluster with no member and an unknown id have no site", () => {
    const index = indexOf([
      thing("hall", "room"),
      thing("srv", "server", {}, "hall"),
      thing("vm", "vm"),
      thing("cl", "db_cluster"),
    ]);
    expect(buildingOf(index, "srv")).toBeUndefined();
    expect(siteOf(index, "srv")).toBeUndefined();
    expect(siteOf(index, "vm")).toBeUndefined();
    expect(siteOf(index, "cl")).toBeUndefined();
    expect(siteOf(index, "nowhere")).toBeUndefined();
    expect(serversOfSite(index, "no-site")).toEqual([]);
  });

  test("[REQ-106] a server in a building with no site stands in none, one in a building with a site stands in it", () => {
    const index = indexOf([
      thing("bld-a", "building"),
      thing("bld-b", "building"),
      thing("site-a", "dr_site", { building: "bld-a" }),
      thing("s1", "server", {}, "bld-a"),
      thing("s2", "server", {}, "bld-b"),
    ]);
    expect(siteOf(index, "s1")).toBe("site-a");
    expect(siteOf(index, "s2")).toBeUndefined();
    expect(serversOfSite(index, "site-a")).toEqual(["s1"]);
  });
});

describe("a move is worked out from the plan when the pieces around it are missing [REQ-106]", () => {
  const without = (kinds: EntityKind[]): World => {
    const bp = siteBlueprint("warm");
    const gone = new Set(bp.entities.filter((e) => kinds.includes(e.kind)).map((e) => e.id));
    return World.fromBlueprint(
      {
        ...bp,
        entities: bp.entities.filter((e) => !gone.has(e.id)),
        links: bp.links.filter((l) => !gone.has(l.from) && !gone.has(l.to)),
      },
      new Catalog(),
    );
  };

  test("[REQ-106] with no line between the sites the plan counts on the ordinary 3 ms", () => {
    const world = without(["site_link"]);
    expect(linkState(world)).toBeUndefined();
    expect(effectiveRtoS(world, "dr-plan", true)).toBe(drTargets("warm", 3, false).rtoS);
    expect(drillOf(world, "dr-plan").rtoS).toBe(drTargets("warm", 3, false).rtoS);
  });

  test("[REQ-106] with the other site missing its images are not stale", () => {
    const world = without(["dr_site"]);
    expect(effectiveRtoS(world, "dr-plan", false)).toBe(drTargets("warm", 3, false).rtoS);
  });

  test("[REQ-106] a drill on a cold site loses what the cold mode loses, and one with a broken copy loses what the link lags", () => {
    const cold = siteLab("cold");
    const coldDrill = drillOf(cold.world, "dr-plan");
    expect(coldDrill.rpoS).toBe(drTargets("cold", 3, false).rpoS);
    const broken = siteLab("warm");
    const stream = [...broken.world.index.ofKind("replication_stream")][0]?.id as string;
    broken.inject("replication_broken", stream);
    broken.physics.run(600);
    const drill = drillOf(broken.world, "dr-plan");
    expect(drill.rpoS).toBeGreaterThanOrEqual(600);
    expect(drill.meetsRpo).toBe(false);
  });

  test("[REQ-106] a quorum fault with no number holds two nodes down, and one aimed at a node outside a ring holds none", () => {
    const lab = siteLab("raft");
    const nodes = [...lab.world.index.ofKind("db_node")]
      .filter((n) => n.id.startsWith("svc-iap-"))
      .map((n) => n.id);
    const fault = (target: string) => ({
      id: "f",
      type: "db_quorum_lost" as const,
      target,
      params: {},
      since: 0,
    });
    expect(ringDown(lab.world, fault(nodes[0] as string))).toEqual([nodes[0], nodes[1]]);
    expect(ringDown(lab.world, fault("svc-iap"))).toEqual([]);
  });
});
