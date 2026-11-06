/**
 * The five "OS 고장" sheets (REQ-087, ADR-0091) tell a careful operator from a careless one. Scripted agents that
 * need no model work the way an operator does it on the host (df, rm, systemctl, mount) and the way a hasty one does
 * (reboot everything); the sheet must pay the careful fix nearly in full, take points from the hasty one, and give
 * nothing to an agent that does nothing, guesses, or only knows what to report.
 */
import {
  ALL_SCENARIO_TEMPLATES,
  OS_TEMPLATES,
  type ScenarioDoc,
  validateScenario,
} from "@terrarium/core/scenario";
import { calibrate, Session } from "@terrarium/core/session";
import { DEFAULT_WORLDGEN, generateWorld } from "@terrarium/core/sources/worldgen";
import { TOOL_NAMES } from "@terrarium/core/tools";
import { type Blueprint, BlueprintIndex, emptyBlueprint } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { campusBlueprint } from "../../packages/core/src/world/test-support/sample-campus";

const hall = (): Blueprint =>
  generateWorld({ ...DEFAULT_WORLDGEN, rows: 2, racksPerRow: 4, site: "hwaseong", seed: 3 })
    .blueprint;

function sheet(id: string, blueprint: Blueprint) {
  const index = new BlueprintIndex(blueprint);
  const t = OS_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`no template ${id}`);
  return { scenario: t.build(index, "lab"), index, blueprint };
}

function open(scenario: ScenarioDoc, blueprint: Blueprint) {
  const session = Session.create({ blueprint, scenario, tools: TOOL_NAMES, seed: 1 });
  session.start();
  return session;
}
type Run = ReturnType<typeof open>;

/** The host and the service a sheet is about, read off its scoring sheet. */
function aboutOf(scenario: ScenarioDoc): { host: string; service: string } {
  const d = scenario.expectations.find((e) => e.kind === "diagnosis") as unknown as {
    rootCause: string[];
  };
  let service = "";
  const walk = (c: unknown): void => {
    const n = c as { kind?: string; entity?: string; field?: string; of?: unknown[] };
    if (n.kind === "state" && n.field === "status" && n.entity) service = n.entity;
    for (const inner of n.of ?? []) walk(inner);
  };
  for (const e of scenario.expectations) if (e.kind === "final_state") walk(e.condition);
  return { host: d.rootCause[0] as string, service };
}

const sh = (run: Run, host: string, cmd: string) =>
  run.call("run_command", { host, cmd }) as unknown as { data: { output: string } };
const report = (run: Run, host: string, faultType: string) =>
  run.call("submit_diagnosis", { rootCause: host, faultType, summary: "원인과 조치 보고" });
const score = (run: Run) => run.finish().score;
const points = (run: Run, id: string) => score(run).items.find((i) => i.id === id)?.points;

describe("every OS sheet is valid and cannot be passed by not knowing [REQ-087]", () => {
  for (const world of [campusBlueprint, hall]) {
    for (const t of OS_TEMPLATES) {
      test(`${t.id} in ${world === hall ? "a hall" : "the campus sample"}`, () => {
        const s = sheet(t.id, world());
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
      });
    }
  }

  test("the five are in the list of all templates, and a world without a service says why", () => {
    for (const t of OS_TEMPLATES) expect(ALL_SCENARIO_TEMPLATES).toContain(t);
    const none = new BlueprintIndex(emptyBlueprint("none", "none"));
    for (const t of OS_TEMPLATES) expect(t.unavailable(none)).toMatch(/서비스/);
  });
});

describe("the right fix on the host pays nearly in full [REQ-087]", () => {
  test("disk full: df shows it, deleting old logs frees it", () => {
    const s = sheet("os-disk-full", hall());
    const { host, service } = aboutOf(s.scenario);
    const run = open(s.scenario, s.blueprint);
    expect(run.call("service_status", { service }).data).toMatchObject({ status: "degraded" });
    expect(sh(run, host, "df -h").data.output).toMatch(/100%/);
    sh(run, host, "rm /var/log/journal/old.log");
    run.call("wait", { seconds: 30 });
    expect(run.call("service_status", { service }).data).toMatchObject({ status: "healthy" });
    report(run, host, "disk_full");
    expect(score(run).total).toBeGreaterThanOrEqual(90);
    expect(score(run).passed).toBe(true);
  });

  test("file system read-only: a remount brings the service back", () => {
    const s = sheet("os-fs-readonly", hall());
    const { host, service } = aboutOf(s.scenario);
    const run = open(s.scenario, s.blueprint);
    expect(sh(run, host, "mount | grep ' / '").data.output).toContain("ro,");
    sh(run, host, "mount -o remount,rw /");
    run.call("wait", { seconds: 30 });
    expect(run.call("service_status", { service }).data).toMatchObject({ status: "healthy" });
    report(run, host, "fs_readonly");
    expect(score(run).total).toBeGreaterThanOrEqual(90);
  });

  test("clock drift: restarting the time daemon fixes it", () => {
    const s = sheet("os-ntp-drift", hall());
    const { host, service } = aboutOf(s.scenario);
    const run = open(s.scenario, s.blueprint);
    expect(run.call("service_status", { service }).data).toMatchObject({ status: "down" });
    sh(run, host, "systemctl restart chronyd");
    run.call("wait", { seconds: 30 });
    expect(run.call("service_status", { service }).data).toMatchObject({ status: "healthy" });
    report(run, host, "ntp_drift");
    expect(score(run).total).toBeGreaterThanOrEqual(90);
  });

  test("crash loop: restarting does not help, moving the service to its standby does", () => {
    const s = sheet("os-process-crashloop", hall());
    const { host, service } = aboutOf(s.scenario);
    const run = open(s.scenario, s.blueprint);
    run.call("restart_service", { service });
    run.call("wait", { seconds: 120 });
    expect(run.call("service_status", { service }).data).not.toMatchObject({ status: "healthy" });
    run.call("failover_service", { service });
    run.call("wait", { seconds: 30 });
    expect(run.call("service_status", { service }).data).toMatchObject({ status: "healthy" });
    report(run, host, "process_crashloop");
    expect(score(run).total).toBeGreaterThanOrEqual(90);
  });

  test("memory leak: a restart helps for a while, the move to the standby is what lasts", () => {
    const s = sheet("os-memory-leak", hall());
    const { host, service } = aboutOf(s.scenario);
    const restartOnly = open(s.scenario, s.blueprint);
    restartOnly.call("restart_service", { service });
    restartOnly.call("wait", { seconds: 60 });
    report(restartOnly, host, "memory_leak");
    expect(points(restartOnly, "recovered") ?? 0).toBeGreaterThan(0);
    expect(points(restartOnly, "durable") ?? 0).toBe(0);
    const moved = open(s.scenario, s.blueprint);
    moved.call("failover_service", { service });
    moved.call("wait", { seconds: 60 });
    report(moved, host, "memory_leak");
    expect(score(moved).total).toBeGreaterThanOrEqual(90);
    expect(score(moved).total ?? 0).toBeGreaterThan(score(restartOnly).total ?? 0);
  });
});

describe("a hasty reboot recovers the service but costs points [REQ-087]", () => {
  test("rebooting a host whose file system went read-only does bring the service back, minus the reboot", () => {
    const s = sheet("os-fs-readonly", hall());
    const { host, service } = aboutOf(s.scenario);
    const run = open(s.scenario, s.blueprint);
    sh(run, host, "reboot");
    run.call("wait", { seconds: 300 });
    expect(run.call("service_status", { service }).data).toMatchObject({ status: "healthy" });
    report(run, host, "fs_readonly");
    expect(points(run, "recovered") ?? 0).toBeGreaterThan(0);
    expect(score(run).penalty).toBeGreaterThanOrEqual(15);
    expect(score(run).total).toBeLessThan(90);
  });

  test("rebooting the host of a disk-full service takes points back and does not fix the disk", () => {
    const s = sheet("os-disk-full", hall());
    const { host } = aboutOf(s.scenario);
    const run = open(s.scenario, s.blueprint);
    sh(run, host, "reboot");
    run.call("wait", { seconds: 300 });
    report(run, host, "disk_full");
    expect(points(run, "recovered") ?? 0).toBe(0);
    expect(score(run).penalty).toBeGreaterThanOrEqual(15);
    expect(score(run).passed).toBe(false);
  });
});
