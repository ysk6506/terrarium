/**
 * The seven "애플리케이션 층" sheets tell a careful operator from a careless one (REQ-100). Scripted agents that need no model
 * work the way an operator does: take a backend out of the balancer, restart the session store, the sidecar or the control
 * plane, close a breaker, roll the mesh configuration back, send the traffic to a healthy region. The sheet must pay the
 * right move nearly in full, pay the same move less when it comes late, and give nothing to an agent that does nothing,
 * guesses, or only knows what to report.
 */
import {
  ALL_SCENARIO_TEMPLATES,
  APP_TEMPLATES,
  type ScenarioDoc,
  validateScenario,
} from "@terrarium/core/scenario";
import { calibrate, Session } from "@terrarium/core/session";
import { TOOL_NAMES } from "@terrarium/core/tools";
import { type Blueprint, BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { type AppLabOptions, appLab } from "../../packages/core/src/world/test-support/app-lab";

type Run = Session;

const CASES: ReadonlyArray<readonly [string, AppLabOptions]> = [
  ["lb-backend-flapping", { level: "lb" }],
  ["session-store-down", { level: "stateless" }],
  ["breaker-stuck-open", { level: "microservices" }],
  ["retry-storm", { level: "mesh" }],
  ["sidecar-crash", { level: "mesh" }],
  ["mesh-control-stuck", { level: "mesh" }],
  ["region-down", { level: "multiregion" }],
];

function sheet(id: string, options: AppLabOptions) {
  const blueprint = appLab(options);
  const index = new BlueprintIndex(blueprint);
  const t = APP_TEMPLATES.find((x) => x.id === id);
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

/** The look an operator takes before touching anything. */
function lookAround(run: Run): void {
  run.call("list_alarms", {});
  run.call("list_services", {});
}

/** What fixes each sheet, as the operator does it. */
function fix(run: Run, id: string): void {
  switch (id) {
    case "lb-backend-flapping":
      run.call("lb_drain", { backend: "app-portal-4" });
      return;
    case "session-store-down":
      run.call("run_command", { host: "vm-web3", cmd: "systemctl restart redis-server" });
      return;
    case "breaker-stuck-open":
      run.call("breaker_reset", { link: "call-portal-license" });
      return;
    case "retry-storm":
      run.call("mesh_rollback", {});
      return;
    case "sidecar-crash":
      for (const host of ["vm-web", "vm-web2", "vm-web3", "vm-web4"])
        run.call("run_command", { host, cmd: "systemctl restart envoy" });
      return;
    case "mesh-control-stuck":
      run.call("run_command", { host: "vm-web3", cmd: "systemctl restart istiod" });
      run.call("wait", { seconds: 30 });
      run.call("mesh_rollback", {});
      return;
    case "region-down":
      run.call("region_failover", { region: "region-b" });
      return;
    default:
  }
}

describe("every application sheet is valid and cannot be passed by not knowing [REQ-100]", () => {
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

  test("the seven are in the list of all templates, and a world without the layer says why", () => {
    for (const t of APP_TEMPLATES) expect(ALL_SCENARIO_TEMPLATES).toContain(t);
    expect(APP_TEMPLATES).toHaveLength(7);
    const none = new BlueprintIndex({ ...appLab(), entities: [], links: [] });
    for (const t of APP_TEMPLATES) expect(t.unavailable(none)).toBeTruthy();
    const plain = new BlueprintIndex(appLab({ level: "lb" }));
    for (const id of ["breaker-stuck-open", "retry-storm", "sidecar-crash", "region-down"])
      expect(
        (APP_TEMPLATES.find((t) => t.id === id) as (typeof APP_TEMPLATES)[number]).unavailable(
          plain,
        ),
        id,
      ).toMatch(/애플리케이션 칩/);
  });
});

describe("recovery first beats cause first beats doing nothing [REQ-100] [REQ-088]", () => {
  for (const [id, options] of CASES) {
    test(`${id}: the fix at once > the same fix after a long look > nothing`, () => {
      const s = sheet(id, options);
      const early = open(s.scenario, s.blueprint);
      lookAround(early);
      fix(early, id);
      early.call("wait", { seconds: 240 });
      report(early, s.scenario);
      const late = open(s.scenario, s.blueprint);
      for (let i = 0; i < 3; i++) lookAround(late);
      late.call("wait", { seconds: 900 });
      fix(late, id);
      late.call("wait", { seconds: 240 });
      report(late, s.scenario);
      const none = open(s.scenario, s.blueprint);
      none.call("wait", { seconds: 1200 });
      const [a, b, c] = [score(early).total ?? 0, score(late).total ?? 0, score(none).total ?? 0];
      expect(a, `${id}: early`).toBeGreaterThan(b);
      expect(b, `${id}: late`).toBeGreaterThan(c);
      expect(c).toBe(0);
    });
  }
});

describe("each sheet has a way back that is the layer's own [REQ-100] [REQ-088]", () => {
  const WAYS: Readonly<Record<string, string>> = {
    "lb-backend-flapping": "lb_drain",
    "breaker-stuck-open": "breaker_reset",
    "retry-storm": "mesh_rollback",
  };
  for (const [id, how] of Object.entries(WAYS)) {
    test(`${id}: ${how}`, () => {
      const options = CASES.find(([x]) => x === id)?.[1] as AppLabOptions;
      const s = sheet(id, options);
      const c = calibrate({ blueprint: s.blueprint, scenario: s.scenario });
      expect(c.recoveryPath, id).toMatchObject({ applicable: true, ok: true, how });
    });
  }
});
