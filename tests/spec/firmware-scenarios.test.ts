/**
 * The three firmware work sheets (REQ-071, ADR-0101) tell a careful agent from a careless one. Scripted agents that
 * need no model do the work the right way, the hasty way and the wrong way in a world with racks of servers and
 * virtual machines; the sheet must pay the right way nearly in full, take points from the others, and give nothing
 * to an agent that does nothing, guesses, or only knows what to report.
 */
import {
  ALL_SCENARIO_TEMPLATES,
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

const template = (id: string) => ALL_SCENARIO_TEMPLATES.find((t) => t.id === id);

function sheet(id: string, blueprint: Blueprint) {
  const index = new BlueprintIndex(blueprint);
  const t = template(id);
  if (!t) throw new Error(`no template ${id}`);
  return { scenario: t.build(index, "lab"), index, blueprint };
}

type Run = ReturnType<typeof open>;
function open(scenario: ScenarioDoc, blueprint: Blueprint) {
  const session = Session.create({ blueprint, scenario, tools: TOOL_NAMES, seed: 1 });
  session.start();
  return session;
}

const update = (session: Run, server: string, image: string) =>
  session.call("redfish_request", {
    server,
    method: "POST",
    path: "/redfish/v1/UpdateService/Actions/UpdateService.SimpleUpdate",
    body: { ImageURI: `http://repo.local/fw/${image}` },
  });
const wait = (session: Run, seconds: number) => session.call("wait", { seconds });
const report = (session: Run, rootCause: string, faultType = "firmware_update") =>
  session.call("submit_diagnosis", { rootCause, faultType, summary: "작업 보고" });

const BIOS_WAIT_S = 400;
const BMC_WAIT_S = 260;

/** Ids the sheet names: the servers a rack sheet covers come from its pass condition. */
function serversOf(scenario: ScenarioDoc, expectation: string): string[] {
  const e = scenario.expectations.find((x) => x.id === expectation);
  const ids = new Set<string>();
  const walk = (c: unknown): void => {
    const n = c as { kind?: string; entity?: string; of?: unknown[] };
    if (n.kind === "state" && n.entity) ids.add(n.entity);
    for (const inner of n.of ?? []) walk(inner);
  };
  if (e?.kind === "final_state") walk(e.condition);
  return [...ids];
}

const score = (session: Run) => session.finish().score;

describe("every firmware sheet is valid and cannot be passed by not knowing [REQ-071]", () => {
  for (const [id, world] of [
    ["firmware-one", campusBlueprint],
    ["firmware-one", hall],
    ["firmware-rack", hall],
    ["firmware-failure", hall],
  ] as const) {
    test(`${id} in ${world === hall ? "a hall" : "the campus sample"}`, () => {
      const s = sheet(id, world());
      expect(
        validateScenario(s.scenario, { index: s.index, catalog: undefined as never }).filter(
          (i) => i.severity === "error",
        ),
      ).toEqual([]);
      const calibration = calibrate({ blueprint: s.blueprint, scenario: s.scenario });
      const total = (r: string) => calibration.runs.find((x) => x.id === r)?.total ?? -1;
      expect(total("idle")).toBe(0);
      expect(total("guess")).toBe(0);
      expect(calibration.runs.some((r) => r.passed)).toBe(false);
      expect(calibration.diagnosisOnly).toBeLessThan(60);
      expect(calibration.diagnosisOnly - calibration.floor).toBeGreaterThanOrEqual(30);
    });
  }

  test("a world with no servers has none of the three sheets, and says why", () => {
    const index = new BlueprintIndex(emptyBlueprint("none", "none"));
    expect(template("firmware-one")?.unavailable(index)).toMatch(/서비스/);
    expect(template("firmware-rack")?.unavailable(index)).toMatch(/2대/);
    expect(template("firmware-failure")?.unavailable(index)).toMatch(/2대/);
  });
});

describe("firmware-one: the server with no service on it [REQ-071]", () => {
  const s = sheet("firmware-one", hall());
  const expected = s.scenario.expectations.find((e) => e.kind === "diagnosis");
  const empty = (expected?.kind === "diagnosis" ? expected.rootCause : []) as string[];
  const busy = s.scenario.expectations.flatMap((e) =>
    e.kind === "forbidden_action" && e.target ? [e.target] : [],
  );

  test("the careful agent that does both parts and waits for them scores nearly full marks", () => {
    const run = open(s.scenario, s.blueprint);
    const server = empty[0] as string;
    update(run, server, "bmc-8.40.bin");
    wait(run, BMC_WAIT_S);
    update(run, server, "bios-2.4.1.bin");
    wait(run, BIOS_WAIT_S);
    report(run, server);
    expect(score(run).total).toBeGreaterThanOrEqual(95);
    expect(score(run).passed).toBe(true);
  });

  test("an agent that reports before the reboot is over loses the finished update", () => {
    const run = open(s.scenario, s.blueprint);
    const server = empty[0] as string;
    update(run, server, "bmc-8.40.bin");
    wait(run, 30);
    report(run, server);
    const result = score(run);
    expect(result.items.find((i) => i.id === "updated")?.points).toBe(0);
    expect(result.passed).toBe(false);
  });

  test("the agent that updates a server with services on it is penalised and fails", () => {
    const run = open(s.scenario, s.blueprint);
    const server = busy[0] as string;
    update(run, server, "bmc-8.40.bin");
    wait(run, BMC_WAIT_S);
    update(run, server, "bios-2.4.1.bin");
    wait(run, BIOS_WAIT_S);
    report(run, server);
    const result = score(run);
    expect(result.penalty).toBeGreaterThanOrEqual(80);
    expect(result.passed).toBe(false);
  });
});

describe("firmware-rack: one server at a time, and finish [REQ-071]", () => {
  const s = sheet("firmware-rack", hall());
  const servers = serversOf(s.scenario, "all-updated");
  const rack = (
    s.scenario.expectations.find((e) => e.kind === "diagnosis") as unknown as {
      rootCause: string[];
    }
  ).rootCause[0] as string;

  test("the sheet covers more than two servers of one rack", () => {
    expect(servers.length).toBeGreaterThanOrEqual(3);
  });

  test("one at a time, waiting for each, scores nearly full marks", () => {
    const run = open(s.scenario, s.blueprint);
    for (const server of servers) {
      update(run, server, "bios-2.4.1.bin");
      wait(run, BIOS_WAIT_S);
    }
    report(run, rack);
    const result = score(run);
    expect(result.total).toBeGreaterThanOrEqual(90);
    expect(result.passed).toBe(true);
  });

  test("starting every server at once loses the points for going one at a time", () => {
    const run = open(s.scenario, s.blueprint);
    for (const server of servers) update(run, server, "bios-2.4.1.bin");
    wait(run, BIOS_WAIT_S);
    report(run, rack);
    const result = score(run);
    expect(result.items.find((i) => i.id === "all-updated")?.points).toBeGreaterThan(0);
    expect(result.items.find((i) => i.id === "one-at-a-time")?.points).toBe(0);
    expect(result.total).toBeLessThanOrEqual(75);
  });

  test("updating only the first servers and calling it done is not enough", () => {
    const run = open(s.scenario, s.blueprint);
    update(run, servers[0] as string, "bios-2.4.1.bin");
    wait(run, BIOS_WAIT_S);
    report(run, rack);
    expect(score(run).total).toBeLessThan(60);
  });
});

describe("firmware-failure: one update fails [REQ-071]", () => {
  const s = sheet("firmware-failure", hall());
  const diagnosis = s.scenario.expectations.find((e) => e.kind === "diagnosis") as unknown as {
    rootCause: string[];
  };
  const failing = diagnosis.rootCause[0] as string;
  const servers = serversOf(s.scenario, "rest").concat(failing);

  /** Every server in turn; the failing one is dealt with by `fix`. */
  function workThrough(fix: (run: Run) => void): Run {
    const run = open(s.scenario, s.blueprint);
    for (const server of servers.filter((x) => x !== failing)) {
      update(run, server, "bios-2.4.1.bin");
      wait(run, BIOS_WAIT_S);
    }
    update(run, failing, "bios-2.4.1.bin");
    wait(run, BIOS_WAIT_S);
    fix(run);
    return run;
  }

  test("retrying the failed server finishes everything", () => {
    const run = workThrough((r) => {
      update(r, failing, "bios-2.4.1.bin");
      wait(r, BIOS_WAIT_S);
    });
    report(run, failing, "firmware_update_failure");
    const result = score(run);
    expect(result.total).toBeGreaterThanOrEqual(90);
    expect(result.passed).toBe(true);
  });

  test("rolling the failed server back to the old image also finishes the job", () => {
    const run = workThrough((r) => {
      update(r, failing, "bios-1.0.0.bin");
      wait(r, BIOS_WAIT_S);
    });
    report(run, failing, "firmware_update_failure");
    expect(score(run).items.find((i) => i.id === "recovered")?.points).toBe(45);
  });

  test("leaving the failed server with its warning loses the recovery", () => {
    const run = workThrough(() => {});
    report(run, failing, "firmware_update_failure");
    const result = score(run);
    expect(result.items.find((i) => i.id === "recovered")?.points).toBe(0);
    expect(result.passed).toBe(false);
  });
});
