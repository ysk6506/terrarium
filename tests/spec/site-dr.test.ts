/**
 * The site and DR layer (REQ-106, ADR-0129): a second site that is kept switched off, half-sized, mirrored, or at work
 * beside the first. What each does when the first site loses its power, how long it takes, how much it loses, and what the
 * agent has to do and say. Numbers come from the modes: cold 4 hours and a day's writes, warm 15 minutes and seconds of
 * writes, hot about 90 seconds and none, active-active about 30 seconds and none.
 */
import { drTargets, linkMsOf } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { siteLab } from "./site-lab";
import { siteBlueprint } from "./site-support";

const kinds = (kind: Parameters<typeof siteBlueprint>[0]) =>
  siteBlueprint(kind).entities.reduce<Record<string, number>>((n, e) => {
    n[e.kind] = (n[e.kind] ?? 0) + 1;
    return n;
  }, {});

describe("the generator builds the second site [REQ-106]", () => {
  test.each(["cold", "warm", "hot", "active"] as const)(
    "%s: two sites, a line, a plan and the copies",
    (kind) => {
      const n = kinds(kind);
      expect(n.dr_site).toBe(2);
      expect(n.site_link).toBe(1);
      expect(n.dr_plan).toBe(1);
      expect(n.replication_stream).toBeGreaterThanOrEqual(2);
    },
  );

  test("a warm site holds half the nodes; a hot one all of them; an active pair runs at both", () => {
    const standby = (kind: Parameters<typeof siteBlueprint>[0]) =>
      siteBlueprint(kind).links.filter(
        (l) => l.kind === "service_on" && l.props.role === "standby" && l.from === "svc-iap",
      ).length;
    expect(standby("warm")).toBeLessThan(standby("hot"));
    expect(standby("active")).toBe(0);
    const placed = (kind: Parameters<typeof siteBlueprint>[0]) =>
      siteBlueprint(kind).links.filter((l) => l.kind === "service_on" && l.from === "svc-iap")
        .length;
    expect(placed("active")).toBeGreaterThan(placed("warm") - 5);
  });

  test("a world without a second site has none of it, and cold, warm, hot and active promise less and less", () => {
    expect(kinds("raft").dr_site).toBeUndefined();
    const t = (m: "cold" | "warm" | "hot" | "active") => drTargets(m, linkMsOf(100));
    expect(t("cold").rtoS).toBeGreaterThan(t("warm").rtoS);
    expect(t("warm").rtoS).toBeGreaterThan(t("hot").rtoS);
    expect(t("hot").rtoS).toBeGreaterThan(t("active").rtoS);
    expect(t("hot").rpoS).toBe(0);
    expect(t("active").auto).toBe(true);
  });
});

describe("a site loses its power [REQ-106]", () => {
  test("a cold site is switched on and rebuilt by hand: four hours, a day's writes lost", () => {
    const lab = siteLab("cold");
    lab.inject("site_power_loss", "site-a");
    lab.physics.run(120);
    expect(lab.status("svc-iap")).toBe("down");
    const r = lab.call("dr_failover", { site: "site-b" }) as { data: { etaSeconds: number } };
    expect(r.data.etaSeconds).toBe(4 * 3600);
    expect(lab.healthyAfter(3 * 3600)).toBeUndefined();
    expect(lab.healthyAfter(2 * 3600)).toBeDefined();
    expect(lab.plan().serving).toBe("site-b");
    expect(lab.plan().lostS).toBeGreaterThan(3600);
  });

  test("a warm site moves when told to: fifteen minutes, then it serves with what it lost counted in seconds", () => {
    const lab = siteLab("warm");
    lab.inject("site_power_loss", "site-a");
    lab.physics.run(60);
    expect(lab.status("svc-iap")).toBe("down");
    lab.call("dr_failover", { site: "site-b" });
    lab.physics.run(850);
    expect(lab.status("svc-iap")).toBe("down");
    lab.physics.run(120);
    expect(lab.plan().serving).toBe("site-b");
    expect(lab.status("svc-iap")).toBe("healthy");
    expect(lab.plan().lostS).toBeLessThanOrEqual(drTargets("warm", linkMsOf(100)).rpoS);
  });

  test("a hot site moves by itself in about a minute and a half, losing nothing, and says it was the cluster", () => {
    const lab = siteLab("hot");
    lab.inject("site_power_loss", "site-a");
    lab.physics.run(10);
    const back = lab.healthyAfter(300);
    expect(back).toBeGreaterThan(30);
    expect(back).toBeLessThanOrEqual(drTargets("hot", 1).rtoS + 40);
    expect(lab.plan().lostS).toBe(0);
    expect(lab.plan().serving).toBe("site-b");
    expect(lab.causesOf("dr.failover")).toEqual(["cluster"]);
  });

  test("an operator who moves a service to its standby places first is not undone when the plan moves it too", () => {
    const lab = siteLab("hot");
    lab.inject("site_power_loss", "site-a");
    lab.physics.run(10);
    lab.call("failover_service", { service: "svc-iap" });
    const back = lab.healthyAfter(300);
    expect(back).toBeDefined();
    expect(lab.plan().serving).toBe("site-b");
    lab.physics.run(300);
    expect(lab.status("svc-iap")).toBe("healthy");
  });

  test("an active-active pair loses nothing: the balancer drops the dead site and no move happens", () => {
    const lab = siteLab("active");
    lab.inject("site_power_loss", "site-a");
    lab.physics.run(10);
    const back = lab.healthyAfter(300);
    expect(back).toBeLessThanOrEqual(90);
    lab.physics.run(120);
    expect(lab.plan().drained).toEqual(["site-a"]);
    expect(lab.plan().failovers).toBe(0);
    expect(lab.causesOf("note").includes("cluster")).toBe(true);
  });

  test("failing over because nobody waited for the power is wrong: the move is refused while the other site is dark", () => {
    const lab = siteLab("warm");
    lab.inject("site_power_loss", "site-b");
    lab.physics.run(10);
    expect((lab.call("dr_failover", { site: "site-b" }) as { ok: boolean }).ok).toBe(false);
    expect((lab.call("dr_failover", { site: "nowhere" }) as { ok: boolean }).ok).toBe(false);
  });

  test("when the power returns the services come back to where they were, and a failback goes the other way", () => {
    const lab = siteLab("warm");
    lab.inject("site_power_loss", "site-a");
    lab.physics.run(60);
    lab.call("dr_failover", { site: "site-b" });
    lab.healthyAfter(1_800);
    lab.clear("site_power_loss");
    lab.physics.run(600);
    const r = lab.call("dr_failback") as { ok: boolean };
    expect(r.ok).toBe(true);
    lab.physics.run(2_400);
    expect(lab.plan().serving).toBe("site-a");
    expect(lab.healthyAfter(900)).toBeDefined();
  });

  test("a drill moves nothing and tells the time and the loss it would have", () => {
    const lab = siteLab("warm");
    const r = lab.call("dr_drill") as { ok: boolean; data: Record<string, number> };
    expect(r.ok).toBe(true);
    expect(lab.plan().serving).toBe("site-a");
    expect(lab.plan().lastDrill).toBeDefined();
    expect(lab.status("svc-iap")).toBe("healthy");
  });
});

describe("the faults between and inside the sites [REQ-106]", () => {
  test("a move that stops half-way is finished by pressing it again, and waiting does not finish it", () => {
    const wait = siteLab("warm");
    wait.inject("site_power_loss", "site-a");
    wait.inject("dr_failover_stuck", "dr-plan");
    wait.physics.run(60);
    wait.call("dr_failover", { site: "site-b" });
    wait.physics.run(4 * 3600);
    expect(wait.plan().phase).toBe("stuck");
    expect(wait.status("svc-iap")).toBe("down");
    wait.call("dr_failover", { site: "site-b" });
    expect(wait.healthyAfter(3_000)).toBeDefined();
    expect(wait.plan().serving).toBe("site-b");
  });

  test("a cut line leaves a warm site's service alone and makes the copy trail; a hot one stalls then falls back", () => {
    const warm = siteLab("warm");
    warm.inject("wan_link_down", "wan-ab");
    warm.physics.run(300);
    expect(warm.status("svc-iap")).toBe("healthy");
    expect(warm.world.stateAs("rep-svc-iap", "replication_stream").lagS).toBeGreaterThan(200);
    const hot = siteLab("hot");
    hot.inject("wan_link_down", "wan-ab");
    hot.physics.run(10);
    expect(hot.status("svc-svc2")).toBe("down");
    hot.physics.run(120);
    expect(hot.world.stateAs("rep-svc-svc2", "replication_stream").mode).toBe("async");
    expect(hot.status("svc-svc2")).toBe("healthy");
    expect(hot.causesOf("note").includes("cluster")).toBe(true);
  });

  test("a slow line makes a copy trail more and a synchronous one slows the writes", () => {
    const warm = siteLab("warm");
    const before = warm.world.stateAs("rep-svc-iap", "replication_stream").lagS;
    warm.inject("wan_degraded", "wan-ab", { factor: 30 });
    warm.physics.run(120);
    expect(warm.world.stateAs("rep-svc-iap", "replication_stream").lagS).toBeGreaterThan(
      before * 10,
    );
    const hot = siteLab("hot");
    hot.inject("wan_degraded", "wan-ab", { factor: 100 });
    hot.physics.run(60);
    expect(hot.status("svc-svc2")).toBe("degraded");
  });

  test("a broken copy trails more every minute and restarting the copy agent on its host brings it back", () => {
    const lab = siteLab("warm");
    const host = lab.world.index.outgoing("rep-svc-iap", "hosted_on")[0]?.to as string;
    lab.inject("replication_broken", "rep-svc-iap");
    lab.physics.run(300);
    const s = () => lab.world.stateAs("rep-svc-iap", "replication_stream");
    expect(s().status).toBe("broken");
    expect(lab.status("svc-iap")).toBe("healthy");
    lab.call("run_command", { host, cmd: "systemctl restart replicad" });
    lab.physics.run(600);
    expect(s().status).toBe("ok");
  });

  test("two sites that both led are a split brain: the writes of the site not kept are thrown away", () => {
    const lab = siteLab("split");
    lab.inject("split_brain", "dr-plan");
    lab.physics.run(30);
    expect(lab.plan().split).toBe(true);
    expect(lab.status("svc-svc2")).toBe("down");
    expect((lab.call("dr_failover", { site: "site-a" }) as { ok: boolean }).ok).toBe(true);
    lab.physics.run(300);
    expect(lab.plan().split).toBe(false);
    expect(lab.status("svc-svc2")).toBe("healthy");
  });

  test("a cold site with old images takes two hours more to start", () => {
    const fresh = siteLab("cold");
    const stale = siteLab("cold");
    stale.inject("dr_site_stale", "site-b", { staleDays: 120 });
    stale.physics.run(10);
    const eta = (l: typeof fresh) =>
      (l.call("dr_failover", { site: "site-b" }) as { data: { etaSeconds: number } }).data
        .etaSeconds;
    fresh.inject("site_power_loss", "site-a");
    stale.inject("site_power_loss", "site-a");
    expect(eta(stale) - eta(fresh)).toBe(2 * 3600);
  });
});
