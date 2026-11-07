/**
 * The nine sheets of the site and DR layer, geo storage and the two new databases (REQ-106): each is valid, pays nothing for
 * not knowing, pays the right move nearly in full and the same move less when it comes late, charges the wrong big move (a
 * failover for a cut line), and has a way back that is the layer's own. A world without the layer says why.
 */
import {
  ALL_SCENARIO_TEMPLATES,
  type ScenarioDoc,
  SITE_TEMPLATES,
  TEMPLATE_GROUPS,
  validateScenario,
} from "@terrarium/core/scenario";
import { calibrate, Session } from "@terrarium/core/session";
import { TOOL_NAMES } from "@terrarium/core/tools";
import { type Blueprint, BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { type SiteWorld, siteBlueprint } from "./site-support";

const CASES: ReadonlyArray<readonly [string, SiteWorld]> = [
  ["site-power-loss", "warm"],
  ["dr-failover-stuck", "warm"],
  ["wan-link-cut", "warm"],
  ["replication-broken", "warm"],
  ["split-brain", "split"],
  ["db-quorum-lost", "raft"],
  ["db-managed-flapping", "managed"],
  ["db-managed-storage-full", "managed"],
  ["geo-replica-broken", "warm"],
];

function sheet(id: string, kind: SiteWorld) {
  const blueprint = siteBlueprint(kind);
  const index = new BlueprintIndex(blueprint);
  const t = SITE_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`no template ${id}`);
  return { scenario: t.build(index, "lab"), index, blueprint };
}

const open = (scenario: ScenarioDoc, blueprint: Blueprint): Session => {
  const s = Session.create({ blueprint, scenario, tools: TOOL_NAMES, seed: 1 });
  s.start();
  return s;
};

const answer = (scenario: ScenarioDoc) => {
  const d = scenario.expectations.find((e) => e.kind === "diagnosis") as unknown as {
    rootCause: string[];
    faultType: string[];
  };
  return { rootCause: d.rootCause[0] as string, faultType: d.faultType[0] as string };
};
const report = (run: Session, scenario: ScenarioDoc) =>
  run.call("submit_diagnosis", { ...answer(scenario), summary: "원인과 조치 보고" });

const replicatorHost = (bp: Blueprint) =>
  bp.links.find((l) => l.kind === "hosted_on" && l.from === "rep-svc-iap")?.to ?? "";

/** What fixes each sheet, as an operator does it; the ones that are only handed over do nothing. */
function fix(run: Session, id: string, bp: Blueprint): void {
  const managed = "svc-iap-managed";
  switch (id) {
    case "site-power-loss":
      run.call("dr_failover", { site: "site-b" });
      return;
    case "dr-failover-stuck":
      run.call("dr_failover", { site: "site-b" });
      run.call("wait", { seconds: 600 });
      run.call("dr_failover", { site: "site-b" });
      return;
    case "replication-broken":
      run.call("run_command", { host: replicatorHost(bp), cmd: "systemctl restart replicad" });
      return;
    case "split-brain":
      run.call("dr_failover", { site: "site-a" });
      return;
    case "db-quorum-lost":
      for (const e of bp.entities.filter((x) => x.kind === "db_node"))
        run.call("db_node_restart", { node: e.id });
      return;
    case "db-managed-flapping":
      run.call("db_managed_failover", { db: managed, az: "2" });
      return;
    case "db-managed-storage-full":
      run.call("db_managed_scale_storage", { db: managed });
      return;
    default:
  }
}

const WRONG: Readonly<Record<string, [string, Record<string, unknown>]>> = {
  "wan-link-cut": ["dr_failover", { site: "site-b" }],
  "replication-broken": ["dr_failover", { site: "site-b" }],
  "geo-replica-broken": ["dr_failover", { site: "site-b" }],
};

describe("every sheet is valid and cannot be passed by not knowing [REQ-106]", () => {
  for (const [id, kind] of CASES) {
    test(`${id}: valid, idle and guess earn nothing, and the way back is the layer's own`, () => {
      const s = sheet(id, kind);
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
      expect(c.commonReach?.reached, id).toBe(true);
      expect(c.warnings, id).toEqual([]);
    });
  }

  test("the nine are in the list of all templates and in a group of their own, and a bare world says why", () => {
    for (const t of SITE_TEMPLATES) expect(ALL_SCENARIO_TEMPLATES).toContain(t);
    expect(SITE_TEMPLATES).toHaveLength(9);
    expect(TEMPLATE_GROUPS.find((g) => g.id === "site")?.templates).toBe(SITE_TEMPLATES);
    const none = new BlueprintIndex({ ...siteBlueprint("raft"), entities: [], links: [] });
    for (const t of SITE_TEMPLATES) expect(t.unavailable(none)).toBeTruthy();
    const plain = new BlueprintIndex(siteBlueprint("raft"));
    for (const id of ["site-power-loss", "wan-link-cut", "split-brain", "geo-replica-broken"])
      expect(SITE_TEMPLATES.find((t) => t.id === id)?.unavailable(plain), id).toMatch(/칩/);
    const cold = new BlueprintIndex(siteBlueprint("cold"));
    expect(
      SITE_TEMPLATES.find((t) => t.id === "dr-failover-stuck")?.unavailable(cold),
    ).toBeUndefined();
    expect(SITE_TEMPLATES.find((t) => t.id === "split-brain")?.unavailable(cold)).toMatch(
      /액티브-액티브/,
    );
  });
});

describe("recovery first beats cause first beats doing nothing [REQ-106] [REQ-088]", () => {
  for (const [id, kind] of CASES.filter(([x]) => !(x in WRONG))) {
    test(`${id}: the fix at once > the same fix after a long look > nothing`, () => {
      const s = sheet(id, kind);
      const early = open(s.scenario, s.blueprint);
      early.call("list_alarms", {});
      fix(early, id, s.blueprint);
      early.call("wait", { seconds: 2_400 });
      report(early, s.scenario);
      const late = open(s.scenario, s.blueprint);
      for (let i = 0; i < 3; i++) late.call("list_alarms", {});
      late.call("wait", { seconds: 900 });
      fix(late, id, s.blueprint);
      late.call("wait", { seconds: 2_400 });
      report(late, s.scenario);
      const none = open(s.scenario, s.blueprint);
      none.call("wait", { seconds: 3_300 });
      const [a, b, c] = [early, late, none].map((r) => r.finish().score.total ?? 0) as [
        number,
        number,
        number,
      ];
      expect(a, `${id}: early`).toBeGreaterThan(b);
      expect(b, `${id}: late`).toBeGreaterThan(c);
      expect(c).toBe(0);
    });
  }

  for (const [id, [tool, args]] of Object.entries(WRONG)) {
    test(`${id}: saying what broke beats a ${tool} on a world whose first site is fine`, () => {
      const kind = CASES.find(([x]) => x === id)?.[1] as SiteWorld;
      const s = sheet(id, kind);
      const good = open(s.scenario, s.blueprint);
      good.call("list_alarms", {});
      report(good, s.scenario);
      const bad = open(s.scenario, s.blueprint);
      bad.call("list_alarms", {});
      bad.call(tool, args);
      report(bad, s.scenario);
      expect(good.finish().score.total ?? 0).toBeGreaterThan(bad.finish().score.total ?? 0);
    });
  }
});

describe("each sheet has a way back that is the layer's own [REQ-106] [REQ-088]", () => {
  const WAYS: Readonly<Record<string, string>> = {
    "site-power-loss": "dr_failover",
    "dr-failover-stuck": "dr_failover",
    "split-brain": "dr_failover",
    "db-quorum-lost": "db_node_restart",
    "db-managed-flapping": "db_managed_failover",
    "db-managed-storage-full": "db_managed_scale_storage",
  };
  for (const [id, how] of Object.entries(WAYS)) {
    test(`${id}: ${how}`, () => {
      const kind = CASES.find(([x]) => x === id)?.[1] as SiteWorld;
      const s = sheet(id, kind);
      const c = calibrate({ blueprint: s.blueprint, scenario: s.scenario });
      expect(c.recoveryPath, id).toMatchObject({ applicable: true, ok: true, how });
    });
  }

  test("a sheet about faults that harm no service has nothing to move", () => {
    for (const id of ["wan-link-cut", "replication-broken", "geo-replica-broken"]) {
      const kind = CASES.find(([x]) => x === id)?.[1] as SiteWorld;
      const s = sheet(id, kind);
      const c = calibrate({ blueprint: s.blueprint, scenario: s.scenario });
      expect(c.recoveryPath, id).toMatchObject({ applicable: false, ok: true });
    }
  });
});
