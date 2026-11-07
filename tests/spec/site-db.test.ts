/**
 * Geo-replicated volumes, the consensus database and the managed multi-AZ database (REQ-106, ADR-0129): what each fault does
 * to the service, what the system does by itself (and says so with the cause `cluster`), and what the agent does about it.
 */
import { ELECTION_S, EXTEND_DELAY_S } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { siteLab } from "./site-lab";

const ring = (lab: ReturnType<typeof siteLab>, service = "svc-iap") =>
  lab.world.index
    .outgoing(service, "depends_on")
    .map((l) => l.to)
    .filter((id) => lab.world.index.entity(id).kind === "db_node" && !id.endsWith("-nw"));
/** The notes the system wrote by itself (cause `cluster`) that say something. */
const notes = (lab: ReturnType<typeof siteLab>, part: string) =>
  lab.world
    .events()
    .filter(
      (e) =>
        e.type === "note" &&
        e.cause === "cluster" &&
        String((e as { text?: string }).text).includes(part),
    );
const node = (lab: ReturnType<typeof siteLab>, id: string) => lab.world.stateAs(id, "db_node");

describe("geo-replicated volumes [REQ-106]", () => {
  test("the writable copy stays at home until it is promoted at the other site", () => {
    const lab = siteLab("warm");
    const vol = lab.world.stateAs("vol-svc-svc2", "volume");
    expect(vol.primary).toBe("site-a");
    expect(
      (lab.call("volume_promote", { volume: "vol-svc-svc2", site: "site-b" }) as { ok: boolean })
        .ok,
    ).toBe(true);
    expect(lab.world.stateAs("vol-svc-svc2", "volume").primary).toBe("site-b");
  });

  test("a lagging copy loses what it lags; a broken copy cannot be promoted", () => {
    const lag = siteLab("warm");
    lag.inject("geo_replication_lag", "vol-svc-svc2", { lagS: 900 });
    lag.physics.run(120);
    expect(lag.world.stateAs("vol-svc-svc2", "volume").lagS).toBeGreaterThanOrEqual(900);
    expect(lag.status("svc-svc2")).toBe("healthy");
    const broken = siteLab("warm");
    broken.inject("geo_replica_broken", "vol-svc-svc2");
    broken.physics.run(30);
    expect(broken.world.stateAs("rep-vol-svc-svc2", "replication_stream").status).toBe("broken");
    const promote = broken.call("volume_promote", { volume: "vol-svc-svc2", site: "site-b" }) as {
      ok: boolean;
    };
    expect(promote.ok).toBe(false);
    expect(broken.world.stateAs("vol-svc-svc2", "volume").primary).toBe("site-a");
  });

  test("the status tool shows which site holds the writable copy and how far the other trails", () => {
    const lab = siteLab("warm");
    const r = lab.call("volume_replication_status", {}) as { ok: boolean; data: unknown };
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r.data)).toContain("vol-svc-svc2");
  });
});

describe("the consensus database [REQ-106]", () => {
  test("a ring of three or more nodes has a leader and a term", () => {
    const lab = siteLab("raft");
    const nodes = ring(lab);
    expect(nodes.length).toBeGreaterThanOrEqual(3);
    expect(nodes.filter((n) => node(lab, n).role === "leader")).toHaveLength(1);
  });

  test("losing the leader stops writes for the length of an election, then a new leader with a bigger term", () => {
    const lab = siteLab("raft");
    const [leader] = ring(lab).filter((n) => node(lab, n).role === "leader") as [string];
    const term = node(lab, leader).term;
    lab.inject("db_leader_lost", leader);
    lab.physics.run(2);
    expect(lab.status("svc-iap")).toBe("degraded");
    lab.physics.run(ELECTION_S + 10);
    const leaders = ring(lab).filter((n) => node(lab, n).role === "leader" && n !== leader);
    expect(leaders).toHaveLength(1);
    expect(node(lab, leaders[0] as string).term).toBeGreaterThan(term);
    expect(lab.status("svc-iap")).toBe("healthy");
    expect(lab.causesOf("note").includes("cluster")).toBe(true);
  });

  test("losing the majority stops the service and no election happens until nodes are restarted", () => {
    const lab = siteLab("raft");
    const nodes = ring(lab);
    lab.inject("db_quorum_lost", nodes[0] as string, { down: 2 });
    lab.physics.run(120);
    expect(lab.status("svc-iap")).toBe("down");
    expect(ring(lab).some((n) => node(lab, n).status === "down")).toBe(true);
    for (const n of nodes) lab.call("db_node_restart", { node: n });
    lab.physics.run(120);
    expect(lab.status("svc-iap")).toBe("healthy");
  });

  test("a lagging node slows reads; restarting it or handing the lead elsewhere is the cure", () => {
    const lab = siteLab("raft");
    const follower = ring(lab).find((n) => node(lab, n).role !== "leader") as string;
    lab.inject("db_node_lagging", follower, { lagS: 120 });
    lab.physics.run(30);
    expect(lab.status("svc-iap")).toBe("degraded");
    lab.call("db_node_restart", { node: follower });
    lab.physics.run(60);
    expect(lab.status("svc-iap")).toBe("healthy");
  });

  test("the lead goes to a healthy node on request and not to a node that is down", () => {
    const lab = siteLab("raft");
    const follower = ring(lab).find((n) => node(lab, n).role !== "leader") as string;
    expect((lab.call("db_transfer_leader", { node: follower }) as { ok: boolean }).ok).toBe(true);
    lab.physics.run(30);
    expect(node(lab, follower).role).toBe("leader");
    const other = ring(lab).find((n) => n !== follower) as string;
    lab.inject("db_node_lagging", other, { lagS: 300 });
    lab.physics.run(10);
    expect((lab.call("db_transfer_leader", { node: other }) as { ok: boolean }).ok).toBe(false);
  });
});

describe("the managed multi-AZ database [REQ-106]", () => {
  const db = (lab: ReturnType<typeof siteLab>) =>
    lab.world.index.outgoing("svc-svc2", "depends_on").find((l) => l.to.endsWith("-managed"))
      ?.to as string;

  test("a zone that fails is left by itself after half a minute, writes stalling for about a minute", () => {
    const lab = siteLab("managed");
    lab.inject("db_az_failure", db(lab), { az: 1 });
    lab.physics.run(10);
    expect(lab.world.stateAs(db(lab), "db_managed").activeAz).toBe(0);
    lab.physics.run(40);
    expect(lab.world.stateAs(db(lab), "db_managed").activeAz).toBe(1);
    expect(lab.status("svc-svc2")).toBe("down");
    lab.physics.run(120);
    expect(lab.status("svc-svc2")).toBe("healthy");
    expect(notes(lab, "넘어가요")).toHaveLength(1);
  });

  test("a flapping failover switches again and again until a zone is picked and held", () => {
    const lab = siteLab("managed");
    lab.inject("db_failover_flapping", db(lab));
    lab.physics.run(1_000);
    const switches = notes(lab, "넘어가요").length;
    expect(switches).toBeGreaterThanOrEqual(3);
    expect((lab.call("db_managed_failover", { db: db(lab), az: "2" }) as { ok: boolean }).ok).toBe(
      true,
    );
    lab.physics.run(1_000);
    expect(notes(lab, "넘어가요")).toHaveLength(switches);
    expect(lab.world.stateAs(db(lab), "db_managed").pinned).toBe(true);
  });

  test("a full storage stops writes; it grows by itself after ten minutes or at once when told", () => {
    const waits = siteLab("managed");
    waits.inject("db_storage_full", db(waits));
    waits.physics.run(EXTEND_DELAY_S - 60);
    expect(waits.status("svc-svc2")).toBe("down");
    waits.physics.run(120);
    expect(waits.status("svc-svc2")).toBe("healthy");
    expect(waits.causesOf("fault.remove").includes("cluster")).toBe(true);
    const acts = siteLab("managed");
    acts.inject("db_storage_full", db(acts));
    acts.physics.run(30);
    expect((acts.call("db_managed_scale_storage", { db: db(acts) }) as { ok: boolean }).ok).toBe(
      true,
    );
    acts.physics.run(30);
    expect(acts.status("svc-svc2")).toBe("healthy");
  });
});
