/**
 * The six "SDN·클라우드 네이티브 네트워크" sheets tell a careful operator from a careless one (REQ-097). Scripted agents that
 * need no model work the way an operator does: watch a standby take over, push a switch's configuration again, put a policy
 * back, restart an ingress or a plug-in, or hand a cut tunnel to the network team. The sheet must pay the right move nearly
 * in full, pay the same move less when it comes late, and give nothing to an agent that does nothing, guesses, or only knows
 * what to report. Where the system heals itself, its recovery is not the agent's.
 */
import {
  ALL_SCENARIO_TEMPLATES,
  type ScenarioDoc,
  SDN_TEMPLATES,
  validateScenario,
} from "@terrarium/core/scenario";
import { calibrate, Session } from "@terrarium/core/session";
import { TOOL_NAMES } from "@terrarium/core/tools";
import { type Blueprint, BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { type SdnLabOptions, sdnLab } from "../../packages/core/src/world/test-support/sdn-lab";

type Run = Session;

const CASES: ReadonlyArray<readonly [string, SdnLabOptions]> = [
  ["sdn-controller-down", { controllers: 2 }],
  ["sdn-controller-down", { controllers: 1 }],
  ["sdn-sync-failed", {}],
  ["sdn-tunnel-down", {}],
  ["netpolicy-wrong-deploy", { cloudNative: true }],
  ["ingress-down", { cloudNative: true }],
  ["cni-plugin-failure", { cloudNative: true }],
];

const label = (id: string, o: SdnLabOptions) => (o.controllers === 1 ? `${id} (single)` : id);

function sheet(id: string, options: SdnLabOptions) {
  const blueprint = sdnLab(options);
  const index = new BlueprintIndex(blueprint);
  const t = SDN_TEMPLATES.find((x) => x.id === id);
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
  run.call("sdn_status", {});
}

/** What fixes each sheet, as the operator does it. */
function fix(run: Run, id: string, options: SdnLabOptions): void {
  switch (id) {
    case "sdn-controller-down":
      if (options.controllers === 1) run.call("escalate", { domain: "network" });
      return;
    case "sdn-sync-failed":
      run.call("sdn_sync", { switch: "tor-a" });
      return;
    case "sdn-tunnel-down":
      run.call("overlay_trace", { src: "svc-portal", dst: "srv-b1" });
      run.call("escalate", { domain: "network" });
      return;
    case "netpolicy-wrong-deploy":
      run.call("policy_revert", { policy: "np-license" });
      return;
    case "ingress-down":
      run.call("ingress_restart", {});
      return;
    case "cni-plugin-failure":
      run.call("run_command", { host: "vm-web", cmd: "systemctl restart calico-node" });
      return;
    default:
  }
}

describe("every SDN sheet is valid and cannot be passed by not knowing [REQ-097]", () => {
  for (const [id, options] of CASES) {
    test(`${label(id, options)}: valid, idle and guess earn nothing, knowing the answer is not enough`, () => {
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
      if (options.controllers === 2) expect(c.diagnosisOnly).toBe(100);
      else {
        expect(c.diagnosisOnly).toBeLessThan(60);
        expect(c.diagnosisOnly - c.floor).toBeGreaterThanOrEqual(30);
      }
      expect(c.commonReach?.reached).toBe(true);
    });
  }

  test("the six are in the list of all templates, and a world without the layer says why", () => {
    for (const t of SDN_TEMPLATES) expect(ALL_SCENARIO_TEMPLATES).toContain(t);
    expect(SDN_TEMPLATES).toHaveLength(6);
    const none = new BlueprintIndex({ ...sdnLab(), entities: [], links: [] });
    for (const t of SDN_TEMPLATES) expect(t.unavailable(none)).toBeTruthy();
    const noCloud = new BlueprintIndex(sdnLab());
    for (const id of ["netpolicy-wrong-deploy", "ingress-down", "cni-plugin-failure"])
      expect(
        (SDN_TEMPLATES.find((t) => t.id === id) as (typeof SDN_TEMPLATES)[number]).unavailable(
          noCloud,
        ),
      ).toMatch(/클라우드 네이티브/);
  });
});

describe("recovery first beats cause first beats doing nothing [REQ-097] [REQ-088]", () => {
  for (const [id, options] of CASES.filter(
    ([x, o]) => x !== "sdn-tunnel-down" && x !== "sdn-controller-down" && o !== undefined,
  )) {
    test(`${label(id, options)}: the fix at once > the same fix after a long look > nothing`, () => {
      const s = sheet(id, options);
      const early = open(s.scenario, s.blueprint);
      lookAround(early);
      fix(early, id, options);
      early.call("wait", { seconds: 120 });
      report(early, s.scenario);
      const late = open(s.scenario, s.blueprint);
      for (let i = 0; i < 3; i++) lookAround(late);
      late.call("wait", { seconds: 420 });
      fix(late, id, options);
      late.call("wait", { seconds: 120 });
      report(late, s.scenario);
      const none = open(s.scenario, s.blueprint);
      none.call("wait", { seconds: 600 });
      const [a, b, c] = [score(early).total ?? 0, score(late).total ?? 0, score(none).total ?? 0];
      expect(a, `${id}: early`).toBeGreaterThan(b);
      expect(b, `${id}: late`).toBeGreaterThan(c);
      expect(c).toBe(0);
    });
  }
});

describe("what heals by itself is not the agent's recovery [REQ-097] [REQ-088]", () => {
  test("a controller pair: watching and reporting earns the report, and the result says the system did it", () => {
    const s = sheet("sdn-controller-down", { controllers: 2 });
    const run = open(s.scenario, s.blueprint);
    lookAround(run);
    run.call("wait", { seconds: 120 });
    report(run, s.scenario);
    const result = run.finish();
    expect(result.score.recovery?.recovered).toBe(true);
    expect(result.score.recovery?.byCluster).toBe(true);
    expect(result.score.recovery?.byAgent).toBe(false);
    expect(result.score.total).toBe(100);
    const takeover = run.world.events().find((e) => e.type === "sdn.failover");
    expect(takeover?.cause).toBe("cluster");
  });

  test("a single controller never heals: the services stay in trouble until the network team is told", () => {
    const s = sheet("sdn-controller-down", { controllers: 1 });
    const run = open(s.scenario, s.blueprint);
    run.call("wait", { seconds: 3600 });
    const services = run.call("list_services", {}).data as Array<{ status: string }>;
    expect(services.some((x) => x.status !== "healthy")).toBe(true);
  });
});

describe("each sheet has a way back that is the layer's own or the team's [REQ-097] [REQ-088]", () => {
  const WAYS: Readonly<Record<string, string>> = {
    "sdn-sync-failed": "sdn_sync",
    "netpolicy-wrong-deploy": "policy_revert",
    "ingress-down": "ingress_restart",
    "cni-plugin-failure": "cni_restart",
  };
  for (const [id, how] of Object.entries(WAYS)) {
    test(`${id}: ${how}`, () => {
      const options = CASES.find(([x]) => x === id)?.[1] as SdnLabOptions;
      const s = sheet(id, options);
      const c = calibrate({ blueprint: s.blueprint, scenario: s.scenario });
      expect(c.recoveryPath, id).toMatchObject({ applicable: true, ok: true, how });
    });
  }

  test("a cut tunnel and a single controller can only be handed to the network team", () => {
    for (const [id, options] of [
      ["sdn-tunnel-down", {}],
      ["sdn-controller-down", { controllers: 1 }],
    ] as const) {
      const s = sheet(id, options);
      const c = calibrate({ blueprint: s.blueprint, scenario: s.scenario });
      expect(c.recoveryPath, id).toMatchObject({ applicable: true, ok: true });
    }
  });
});
