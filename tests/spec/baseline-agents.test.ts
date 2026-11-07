/**
 * The built-in reference agents know the layers above the servers and keep their hands off a cluster that heals itself
 * (REQ-108, ADR-0131): `operator` and `triage` get the site, DR, GPU, power and cooling sheets right with one look and
 * one action, none of them touches a service while the system is bringing it back, no sheet of a layer below scores
 * less than it did, and `guess` and `idle` stay as dumb as they were.
 */
import { toolSpec } from "@terrarium/core/tools";
import { describe, expect, test } from "vitest";
import { siteBlueprint } from "./site-support";
import { type Builtin, playBuiltin, sheetOf } from "./test-support/baseline-agents";
import { LAYER_ROWS, OTHER_ROWS, type Row } from "./test-support/baseline-worlds";

const label = (r: Row) => `${r.template} in the ${r.world} world`;
const row = (template: string, world: string): Row => {
  const found = [...LAYER_ROWS, ...OTHER_ROWS].find(
    (r) => r.template === template && r.world === world,
  );
  if (!found) throw new Error(`no row ${template} ${world}`);
  return found;
};
async function play(agent: Builtin, r: Row) {
  const blueprint = r.make();
  return playBuiltin(agent, blueprint, sheetOf(r.template, blueprint));
}
const total = async (agent: Builtin, r: Row) => (await play(agent, r)).result.score.total ?? 0;

/** Tools that change the world, whatever else they are: every `act` tool but `wait`. */
const changes = (name: string) => toolSpec(name)?.category === "act" && name !== "wait";

describe("operator and triage know the site and DR layer [REQ-108]", () => {
  test("a warm site is failed over by hand and a cold one is handed to the facility team and failed over too", async () => {
    for (const world of ["warm", "cold"]) {
      const r = row("site-power-loss", world);
      for (const agent of ["operator", "triage"] as const) {
        const { result, calls } = await play(agent, r);
        expect(
          calls.filter((c) => c.name === "dr_failover"),
          `${agent} ${world}`,
        ).toHaveLength(1);
        expect(result.score.total, `${agent} ${world}`).toBeGreaterThanOrEqual(90);
        expect(result.score.recovery).toMatchObject({ recovered: true, byAgent: true });
        expect(result.score.recovery?.worsened).toEqual([]);
        expect(result.diagnosis).toMatchObject({
          rootCause: "site-a",
          faultType: "site_power_loss",
        });
      }
    }
    const cold = await play("operator", row("site-power-loss", "cold"));
    expect(cold.calls.find((c) => c.name === "escalate")?.args).toMatchObject({
      domain: "facility",
    });
  });

  test("a failover that stops halfway is pressed once more and named for what it was", async () => {
    const { result, calls } = await play("operator", row("dr-failover-stuck", "warm"));
    expect(calls.filter((c) => c.name === "dr_failover")).toHaveLength(2);
    expect(result.score.total).toBeGreaterThanOrEqual(80);
    expect(result.diagnosis).toMatchObject({ faultType: "dr_failover_stuck" });
  });

  test("two sites that are both the owner: the primary is kept", async () => {
    for (const agent of ["operator", "triage"] as const) {
      const { result, calls } = await play(agent, row("split-brain", "split"));
      expect(calls.find((c) => c.name === "dr_failover")?.args).toEqual({ site: "site-a" });
      expect(result.score.total, agent).toBeGreaterThanOrEqual(90);
    }
  });

  test("a cut line is handed to the network team and nothing is failed over; a broken volume copy to storage", async () => {
    for (const [template, world, domain] of [
      ["wan-link-cut", "warm", "network"],
      ["geo-replica-broken", "warm", "storage"],
    ] as const) {
      const { result, calls } = await play("operator", row(template, world));
      expect(calls.find((c) => c.name === "escalate")?.args).toMatchObject({ domain });
      expect(calls.some((c) => c.name === "dr_failover" || c.name === "failover_service")).toBe(
        false,
      );
      expect(result.score.total).toBe(100);
    }
  });

  test("a stopped replicator is restarted on its host, and a lost quorum gets its nodes restarted", async () => {
    const rep = await play("operator", row("replication-broken", "warm"));
    expect(rep.calls.find((c) => c.name === "run_command")?.args).toMatchObject({
      cmd: "systemctl restart replicad",
    });
    expect(rep.result.score.total).toBe(100);
    const ring = await play("operator", row("db-quorum-lost", "raft"));
    expect(ring.calls.some((c) => c.name === "db_node_restart")).toBe(true);
    expect(ring.result.score.total).toBeGreaterThanOrEqual(95);
  });
});

describe("operator and triage know the GPU, power and cooling faults [REQ-108]", () => {
  test("a paused job is resumed, a stopped CDU pump is switched, with one look first", async () => {
    for (const agent of ["operator", "triage"] as const) {
      const job = await play(agent, row("job-stuck-checkpoint", "train"));
      expect(job.calls.filter((c) => changes(c.name)).map((c) => c.name)).toEqual(["job_resume"]);
      expect(job.result.score.total, agent).toBeGreaterThanOrEqual(95);
      const pump = await play(agent, row("cdu-pump-fail", "pod"));
      expect(pump.calls.some((c) => c.name === "cdu_pump_switch")).toBe(true);
      expect(pump.calls.findIndex((c) => c.name === "cdu_status")).toBeLessThan(
        pump.calls.findIndex((c) => c.name === "cdu_pump_switch"),
      );
      expect(pump.result.score.total, agent).toBeGreaterThanOrEqual(95);
    }
  });

  test("the substation is moved to the feed that has voltage", async () => {
    const { result, calls } = await play("operator", row("utility-feed-loss", "power"));
    expect(calls.filter((c) => c.name === "transfer_feed")).toHaveLength(1);
    expect(result.score.total).toBeGreaterThan(30);
  });
});

describe("nobody touches a cluster that is bringing the service back by itself [REQ-108]", () => {
  test("hot site: the agents wait for the switch-over, change nothing, and still earn the report", async () => {
    for (const world of ["hot", "active"]) {
      for (const agent of ["operator", "triage"] as const) {
        const r = row("site-power-loss", world);
        const { result, calls } = await play(agent, r);
        expect(
          calls.filter((c) => changes(c.name)),
          `${agent} ${world}`,
        ).toEqual([]);
        if (world === "hot") expect(calls.some((c) => c.name === "wait")).toBe(true);
        expect(result.score.total, `${agent} ${world}`).toBe(100);
        expect(result.score.recovery).toMatchObject({ byCluster: true, byAgent: false });
        expect(result.score.recovery?.worsened).toEqual([]);
      }
    }
  });

  test("hot site: the session says in events_since that the system moved the services by itself", async () => {
    const blueprint = siteBlueprint("hot");
    const { calls } = await play("operator", row("site-power-loss", "hot"));
    expect(calls.some((c) => c.name === "events_since")).toBe(true);
    const { Session } = await import("@terrarium/core/session");
    const { TOOL_NAMES } = await import("@terrarium/core/tools");
    const s = Session.create({
      blueprint,
      scenario: sheetOf("site-power-loss", blueprint),
      tools: TOOL_NAMES,
      seed: 1,
    });
    s.start();
    s.call("wait", { seconds: 300 });
    const news = s.call("events_since", { cursor: 0 }).data as { events: Array<{ type: string }> };
    expect(news.events.some((e) => e.type === "auto_recovery")).toBe(true);
  });

  test("a scheduler that restarts the failed job: the GPU under it is not reset, which would kill the job again", async () => {
    for (const agent of ["operator", "triage"] as const) {
      const { result, calls } = await play(agent, row("gpu-xid-error", "train"));
      expect(calls.some((c) => c.name === "gpu_reset" || c.name === "job_resume")).toBe(false);
      expect(result.score.recovery?.worsened).toEqual([]);
      expect(result.score.total).toBeGreaterThanOrEqual(30);
    }
  });

  test("a cut line on a hot pair is not a reason to move anything either", async () => {
    const { calls } = await play("operator", row("wan-link-cut", "hot"));
    expect(calls.filter((c) => changes(c.name) && c.name !== "escalate")).toEqual([]);
  });
});

describe("the other layers and the dumb baselines do not move [REQ-108]", () => {
  for (const r of [...LAYER_ROWS, ...OTHER_ROWS]) {
    test(`${label(r)}: guess scores what it did, idle nothing; operator and triage score no less and worsen nothing`, async () => {
      expect(await total("guess", r)).toBe(r.before.guess);
      expect(await total("idle", r)).toBe(0);
      for (const agent of ["operator", "triage"] as const) {
        const { result } = await play(agent, r);
        expect(result.score.total ?? 0, agent).toBeGreaterThanOrEqual(r.before[agent]);
        expect(result.score.recovery?.worsened ?? [], agent).toEqual([]);
      }
    });
  }
});
