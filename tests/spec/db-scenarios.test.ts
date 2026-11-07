/**
 * The six "데이터베이스·스토리지 HA" sheets tell a careful operator from a careless one (REQ-095). Scripted agents that
 * need no model work the way an operator does: promote, restart a secondary, switch a path, restore from an older backup
 * or watch what heals by itself. The sheet must pay the right move nearly in full, pay the same move less when it comes
 * late, take points back from the move that loses data, and give nothing to an agent that does nothing, guesses, or only
 * knows what to report. Where the cluster heals by itself, its recovery is not the agent's.
 */
import { analyzeRecovery, serviceHarms } from "@terrarium/core/oracle";
import {
  ALL_SCENARIO_TEMPLATES,
  DB_TEMPLATES,
  type ScenarioDoc,
  validateScenario,
} from "@terrarium/core/scenario";
import { calibrate, Session } from "@terrarium/core/session";
import { TOOL_NAMES } from "@terrarium/core/tools";
import { type Blueprint, BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { type DbLabOptions, dbLab } from "../../packages/core/src/world/test-support/db-lab";

type Run = Session;

const CASES: ReadonlyArray<readonly [string, DbLabOptions]> = [
  ["db-primary-down", { shape: "replicated" }],
  ["db-replication-broken", { shape: "replicated" }],
  ["db-split-brain", { shape: "auto_failover" }],
  ["db-shared-path-cut", { shape: "shared_aa", storage: "dual" }],
  ["storage-node-lost", { shape: "replicated", storage: "distributed" }],
  ["db-restore-corrupt-backup", { shape: "single" }],
];

function sheet(id: string, options: DbLabOptions) {
  const blueprint = dbLab(options);
  const index = new BlueprintIndex(blueprint);
  const t = DB_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`no template ${id}`);
  return { scenario: t.build(index, "lab"), index, blueprint };
}

function open(scenario: ScenarioDoc, blueprint: Blueprint): Run {
  const session = Session.create({ blueprint, scenario, tools: TOOL_NAMES, seed: 1 });
  session.start();
  return session;
}

const answer = (scenario: ScenarioDoc) => {
  const d = scenario.expectations.find((e) => e.kind === "diagnosis") as unknown as {
    rootCause: string[];
    faultType: string[];
  };
  return { rootCause: d.rootCause[0] as string, faultType: d.faultType[0] as string };
};
const report = (run: Run, scenario: ScenarioDoc) =>
  run.call("submit_diagnosis", { ...answer(scenario), summary: "원인과 조치 보고" });
const score = (run: Run) => run.finish().score;
const sh = (run: Run, host: string, cmd: string) =>
  run.call("run_command", { host, cmd }) as unknown as { data: { output: string } };

/** The look an operator takes before touching anything. */
function lookAround(run: Run): void {
  run.call("list_alarms", {});
  run.call("list_services", {});
  run.call("db_status", { cluster: "db-main" });
}

/** What fixes each sheet, as the operator does it. */
function fix(run: Run, id: string): void {
  switch (id) {
    case "db-primary-down":
      run.call("db_promote", { instance: "db-2" });
      return;
    case "db-replication-broken":
      sh(run, "vm-db-2", "systemctl restart postgresql");
      return;
    case "db-split-brain":
      run.call("db_promote", { instance: "db-1" });
      return;
    case "db-shared-path-cut":
      run.call("storage_path_switch", { controller: "ctl-b" });
      return;
    case "db-restore-corrupt-backup":
      run.call("db_restore", { instance: "db-1", backup: "backup-2" });
      return;
    default:
  }
}

describe("every database sheet is valid and cannot be passed by not knowing [REQ-095]", () => {
  for (const [id, options] of CASES) {
    test(`${id}: valid, idle and guess earn nothing, knowing the answer is not enough`, () => {
      const s = sheet(id, options);
      expect(
        validateScenario(s.scenario, { index: s.index, catalog: undefined as never }).filter(
          (i) => i.severity === "error",
        ),
      ).toEqual([]);
      const c = calibrate({ blueprint: s.blueprint, scenario: s.scenario });
      const total = (r: string) => c.runs.find((x) => x.id === r)?.total ?? -1;
      expect(total("idle")).toBe(0);
      expect(total("guess")).toBe(0);
      expect(c.runs.some((r) => r.id !== "knows" && r.passed)).toBe(false);
      expect(c.diagnosisOnly).toBeLessThan(60);
      expect(c.diagnosisOnly - c.floor).toBeGreaterThanOrEqual(30);
      expect(c.commonReach?.reached).toBe(true);
    });
  }

  test("the six are in the list of all templates, and a world without a database says why", () => {
    for (const t of DB_TEMPLATES) expect(ALL_SCENARIO_TEMPLATES).toContain(t);
    expect(DB_TEMPLATES).toHaveLength(6);
    const none = new BlueprintIndex({ ...dbLab({ shape: "single" }), entities: [], links: [] });
    for (const t of DB_TEMPLATES) expect(t.unavailable(none)).toBeTruthy();
  });

  test("a sheet is only offered where the world has what it needs", () => {
    const single = new BlueprintIndex(dbLab({ shape: "single" }));
    const byId = (id: string) =>
      DB_TEMPLATES.find((t) => t.id === id) as (typeof DB_TEMPLATES)[number];
    expect(byId("db-primary-down").unavailable(single)).toMatch(/승격/);
    expect(byId("db-split-brain").unavailable(single)).toMatch(/자동 페일오버/);
    expect(byId("storage-node-lost").unavailable(single)).toMatch(/분산 스토리지/);
    expect(byId("db-restore-corrupt-backup").unavailable(single)).toBeUndefined();
    const multipath = new BlueprintIndex(dbLab({ shape: "replicated", storage: "multipath" }));
    expect(byId("db-shared-path-cut").unavailable(multipath)).toMatch(/경로를 사람이 바꾸는/);
  });
});

describe("recovery first beats cause first beats doing nothing [REQ-095] [REQ-088]", () => {
  for (const id of [
    "db-primary-down",
    "db-replication-broken",
    "db-split-brain",
    "db-shared-path-cut",
    "db-restore-corrupt-backup",
  ]) {
    const options = CASES.find(([x]) => x === id)?.[1] as DbLabOptions;
    test(`${id}: the fix at once > the same fix after a long look > nothing`, () => {
      const s = sheet(id, options);
      const early = open(s.scenario, s.blueprint);
      lookAround(early);
      fix(early, id);
      early.call("wait", { seconds: id === "db-restore-corrupt-backup" ? 1500 : 120 });
      if (id === "db-restore-corrupt-backup") {
        // the newest backup is damaged: the restore fails and the older one is tried
      }
      report(early, s.scenario);
      const late = open(s.scenario, s.blueprint);
      for (let i = 0; i < 3; i++) lookAround(late);
      late.call("wait", { seconds: 420 });
      fix(late, id);
      late.call("wait", { seconds: id === "db-restore-corrupt-backup" ? 1500 : 120 });
      report(late, s.scenario);
      const none = open(s.scenario, s.blueprint);
      none.call("wait", { seconds: 600 });
      const [a, b, c] = [score(early), score(late), score(none)];
      const [early_, late_, none_] = [a.total ?? 0, b.total ?? 0, c.total ?? 0];
      expect(early_, `${id}: early`).toBeGreaterThan(late_);
      expect(late_, `${id}: late`).toBeGreaterThan(none_);
      expect(none_).toBe(0);
      // a restore takes twenty minutes whatever the agent does, so it cannot earn the points for time
      expect(early_).toBeGreaterThanOrEqual(id === "db-restore-corrupt-backup" ? 60 : 80);
    });
  }
});

describe("a restore that picks the damaged backup fails and the older one works [REQ-095]", () => {
  test("restoring the newest backup first costs time but the older backup still recovers", () => {
    const s = sheet("db-restore-corrupt-backup", { shape: "single" });
    const run = open(s.scenario, s.blueprint);
    run.call("db_restore", { instance: "db-1", backup: "latest" });
    run.call("wait", { seconds: 400 });
    const status = run.call("db_status", { cluster: "db-main" }).data as {
      instances: Array<{ lastRestoreError?: string }>;
    };
    expect(status.instances[0]?.lastRestoreError).toContain("깨져");
    run.call("db_restore", { instance: "db-1", backup: "backup-2" });
    run.call("wait", { seconds: 1500 });
    report(run, s.scenario);
    expect(score(run).total).toBeGreaterThan(50);
  });
});

describe("what heals by itself is not the agent's recovery [REQ-095] [REQ-088]", () => {
  test("auto failover: watching and reporting earns the report, and the result says the cluster did it", () => {
    const s = sheet("db-primary-down", { shape: "auto_failover" });
    const run = open(s.scenario, s.blueprint);
    lookAround(run);
    run.call("wait", { seconds: 120 });
    report(run, s.scenario);
    const result = run.finish();
    const recovery = result.score.recovery;
    expect(recovery?.recovered).toBe(true);
    expect(recovery?.byCluster).toBe(true);
    expect(recovery?.byAgent).toBe(false);
    expect(result.score.total).toBe(100);
    const axes = result.score.items.filter((i) => i.id.startsWith("recovery"));
    expect(axes.find((i) => i.id === "recovery_time")?.detail).toContain("클러스터가 알아서");
  });

  test("auto failover: by the time the agent is told the cluster has promoted, so there is nothing left to fix", () => {
    const s = sheet("db-primary-down", { shape: "auto_failover" });
    const run = open(s.scenario, s.blueprint);
    const services = run.call("list_services", {}).data as Array<{ status: string }>;
    expect(services.every((x) => x.status === "healthy")).toBe(true);
    const again = run.call("db_promote", { instance: "db-2" });
    expect(again.ok).toBe(false);
    expect(again.error).toContain("이미 프라이머리");
    const status = run.call("db_status", { cluster: "db-main" }).data as { failovers: number };
    expect(status.failovers).toBe(1);
  });

  test("the cluster's promotion is a world event of the cluster, not an action of the agent", () => {
    const s = sheet("db-primary-down", { shape: "auto_failover" });
    const run = open(s.scenario, s.blueprint);
    run.call("wait", { seconds: 120 });
    const promotion = run.world.events().find((e) => e.type === "db.promote");
    expect(promotion?.cause).toBe("cluster");
    const result = run.finish();
    const harms = serviceHarms(s.index);
    expect(analyzeRecovery(result.events ?? [], harms).byAgent).toBe(false);
  });

  test("a distributed node lost: the pool heals by itself and the report is what the agent earns", () => {
    const s = sheet("storage-node-lost", { shape: "replicated", storage: "distributed" });
    const run = open(s.scenario, s.blueprint);
    lookAround(run);
    run.call("storage_status", { id: "pool-db" });
    run.call("wait", { seconds: 1200 });
    report(run, s.scenario);
    const result = run.finish();
    expect(result.score.recovery?.recovered).toBe(true);
    expect(result.score.recovery?.byAgent).toBe(false);
    expect(result.score.total).toBe(100);
    const meddler = open(s.scenario, s.blueprint);
    meddler.call("db_failover", { cluster: "db-main" });
    meddler.call("wait", { seconds: 1200 });
    report(meddler, s.scenario);
    expect(score(meddler).total ?? 0).toBeLessThan(100);
  });
});

describe("the database tools are reached by the tools a real team has [REQ-095] [REQ-080]", () => {
  test("every template's cause is reached from the alarms and the service list with common tools", () => {
    for (const [id, options] of CASES) {
      const s = sheet(id, options);
      const c = calibrate({ blueprint: s.blueprint, scenario: s.scenario });
      expect(c.commonReach?.reached, id).toBe(true);
    }
  });
});

describe("each sheet has a way back that needs no repair of the machine [REQ-095] [REQ-088]", () => {
  const WAYS: Readonly<Record<string, string>> = {
    "db-primary-down": "db_failover",
    "db-replication-broken": "db_failover",
    "db-split-brain": "db_promote",
    "db-shared-path-cut": "storage_path_switch",
    "db-restore-corrupt-backup": "db_restore",
  };
  for (const [id, how] of Object.entries(WAYS)) {
    test(`${id}: ${how}`, () => {
      const options = CASES.find(([x]) => x === id)?.[1] as DbLabOptions;
      const s = sheet(id, options);
      const c = calibrate({ blueprint: s.blueprint, scenario: s.scenario });
      expect(c.recoveryPath, id).toMatchObject({ applicable: true, ok: true, how });
    });
  }

  test("storage-node-lost heals by itself, which the check says in words", () => {
    const s = sheet("storage-node-lost", { shape: "replicated", storage: "distributed" });
    const c = calibrate({ blueprint: s.blueprint, scenario: s.scenario });
    expect(c.recoveryPath?.applicable).toBe(true);
  });
});
