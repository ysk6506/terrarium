/**
 * The time window of the recovery score follows what the world's shape allows (REQ-108, ADR-0131): full points up to the
 * expected recovery, none from four times it on. A cold site is expected back in four hours, a warm one in fifteen
 * minutes, a restore takes twenty; every other sheet keeps the five minutes and twenty it always had, so no ordinary
 * number moves.
 */

import { ScenarioDocSchema } from "@terrarium/core/contract";
import {
  FULL_RECOVERY_S,
  type RecoveryReport,
  recoveryAxes,
  recoveryWindow,
  ZERO_RECOVERY_S,
} from "@terrarium/core/oracle";
import {
  ALL_SCENARIO_TEMPLATES,
  OS_TEMPLATES,
  type ScenarioDoc,
  scenarioDigest,
  validateScenario,
} from "@terrarium/core/scenario";
import { calibrate } from "@terrarium/core/session";
import { type Blueprint, BlueprintIndex } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { siteBlueprint } from "./site-support";
import { playBuiltin, sheetOf } from "./test-support/baseline-agents";
import { LAYER_ROWS, OTHER_ROWS } from "./test-support/baseline-worlds";

const report = (agentSeconds: number): RecoveryReport => ({
  services: ["svc"],
  impairedAt: 0,
  recoveredAt: agentSeconds,
  endAt: agentSeconds,
  recovered: true,
  byAgent: true,
  seconds: agentSeconds,
  agentSeconds,
  fixAfterSeconds: 60,
  worsened: [],
  acts: 1,
  costKrw: 0,
  delayHours: 0,
});
const timePoints = (s: number, expected?: number) =>
  recoveryAxes(report(s), true, (id) => id, expected)[0]?.points ?? -1;

describe("the window of the time axis [REQ-108]", () => {
  test("without an expected recovery it is the five minutes and twenty it always was", () => {
    expect(recoveryWindow()).toEqual({ full: FULL_RECOVERY_S, zero: ZERO_RECOVERY_S });
    expect(recoveryWindow(300)).toEqual({ full: 300, zero: 1200 });
    for (const s of [0, 120, 300, 600, 900, 1200, 4000])
      expect(timePoints(s, undefined), `${s}s`).toBe(timePoints(s, 300));
  });

  test("with one, full points up to it and none from four times it, a straight line between", () => {
    expect(recoveryWindow(900)).toEqual({ full: 900, zero: 3600 });
    expect(timePoints(900, 900)).toBe(35);
    expect(timePoints(3600, 900)).toBe(0);
    expect(timePoints(2250, 900)).toBeCloseTo(17.5, 1);
    // the same eleven minutes is a late recovery of a hot site and a quick one of a warm site
    expect(timePoints(660, 300)).toBeLessThan(timePoints(660, 900));
    expect(timePoints(660, 900)).toBe(35);
  });

  test("the sheet says the window in words", () => {
    const detail = recoveryAxes(report(660), true, (id) => id, 900)[0]?.detail ?? "";
    expect(detail).toContain("15분 안이면 만점");
    expect(detail).toContain("1시간 넘으면 0점");
  });
});

describe("a sheet carries the recovery its world allows [REQ-108]", () => {
  const expected = (template: string, blueprint: Blueprint) =>
    sheetOf(template, blueprint).expectedRecoveryS;

  test("site chips: cold four hours, warm fifteen minutes, hot and active the usual five", () => {
    expect(expected("site-power-loss", siteBlueprint("cold"))).toBe(14_400);
    expect(expected("site-power-loss", siteBlueprint("warm"))).toBe(900);
    expect(expected("dr-failover-stuck", siteBlueprint("warm"))).toBe(900);
    expect(expected("site-power-loss", siteBlueprint("hot"))).toBeUndefined();
    expect(expected("site-power-loss", siteBlueprint("active"))).toBeUndefined();
    expect(expected("split-brain", siteBlueprint("split"))).toBeUndefined();
  });

  test("a restore takes twenty minutes, a grown managed storage ten, whatever the agent does", () => {
    const rows = [...LAYER_ROWS, ...OTHER_ROWS];
    const of = (t: string) => rows.find((r) => r.template === t);
    const restore = of("db-restore-corrupt-backup");
    const full = of("db-managed-storage-full");
    if (!restore || !full) throw new Error("rows");
    expect(expected(restore.template, restore.make())).toBe(1_200);
    expect(expected(full.template, full.make())).toBe(600);
  });

  test("every other sheet has none, so its score and its digest are what they were", () => {
    const withOne = new Set([
      "site-power-loss",
      "dr-failover-stuck",
      "db-restore-corrupt-backup",
      "db-managed-storage-full",
    ]);
    for (const r of [...LAYER_ROWS, ...OTHER_ROWS].filter((x) => !withOne.has(x.template)))
      expect(expected(r.template, r.make()), `${r.template} in ${r.world}`).toBeUndefined();
    const hall = new BlueprintIndex((LAYER_ROWS[0] as (typeof LAYER_ROWS)[number]).make());
    for (const t of OS_TEMPLATES) {
      if (t.unavailable(hall)) continue;
      expect(t.build(hall, "lab").expectedRecoveryS, t.id).toBeUndefined();
    }
    expect(ALL_SCENARIO_TEMPLATES.length).toBeGreaterThan(50);
  });

  test("a different expected recovery is a different sheet for the benchmark, and the editor may set it", () => {
    const blueprint = siteBlueprint("warm");
    const doc = sheetOf("site-power-loss", blueprint);
    const { expectedRecoveryS: _drop, ...bare } = doc;
    expect(scenarioDigest(doc)).not.toBe(scenarioDigest(bare as ScenarioDoc));
    expect(scenarioDigest({ ...doc, expectedRecoveryS: 1800 })).not.toBe(scenarioDigest(doc));
    expect(ScenarioDocSchema.safeParse(doc).success).toBe(true);
    expect(ScenarioDocSchema.safeParse({ ...doc, expectedRecoveryS: 5 }).success).toBe(false);
    expect(ScenarioDocSchema.safeParse({ ...doc, expectedRecoveryS: 7200.5 }).success).toBe(false);
    expect(
      validateScenario(doc, {
        index: new BlueprintIndex(blueprint),
        catalog: undefined as never,
      }).filter((i) => i.severity === "error"),
    ).toEqual([]);
  });
});

describe("the cold and warm sites can now score high, and the discriminability check reads the same window [REQ-108]", () => {
  test("the same baseline run is scored against the old five minutes and against the shape", async () => {
    const rows: Array<[string, "cold" | "warm", number]> = [
      ["site-power-loss", "cold", 30],
      ["site-power-loss", "warm", 25],
      ["dr-failover-stuck", "warm", 15],
    ];
    for (const [template, kind, gain] of rows) {
      const blueprint = siteBlueprint(kind);
      const doc = sheetOf(template, blueprint);
      const { expectedRecoveryS: _drop, ...bare } = doc;
      const now = await playBuiltin("operator", blueprint, doc);
      const before = await playBuiltin("operator", blueprint, bare as ScenarioDoc);
      expect(now.result.score.expectedRecoveryS).toBe(doc.expectedRecoveryS);
      expect(before.result.score.expectedRecoveryS).toBe(300);
      expect(now.result.score.total, `${template} ${kind}`).toBeGreaterThanOrEqual(
        template === "dr-failover-stuck" ? 80 : 90,
      );
      expect(
        (now.result.score.total ?? 0) - (before.result.score.total ?? 0),
        template,
      ).toBeGreaterThanOrEqual(gain);
    }
  });

  test("a baseline that waits an hour is late for a warm site and for a cold one it is not", async () => {
    // knowing the answer and doing nothing earns the report (30) only, on every shape
    for (const kind of ["cold", "warm"] as const) {
      const blueprint = siteBlueprint(kind);
      const c = calibrate({ blueprint, scenario: sheetOf("site-power-loss", blueprint) });
      expect(c.diagnosisOnly, kind).toBe(30);
      expect(c.floor, kind).toBe(0);
      expect(c.recoveryPath, kind).toMatchObject({ applicable: true });
    }
  });

  test("an ordinary sheet scores exactly what it did: the window is the five minutes", async () => {
    for (const r of OTHER_ROWS.slice(0, 6)) {
      const blueprint = r.make();
      const doc = sheetOf(r.template, blueprint);
      const { result } = await playBuiltin("triage", blueprint, doc);
      if (result.score.scoring === "recovery" && !doc.expectedRecoveryS)
        expect(result.score.expectedRecoveryS, r.template).toBe(300);
    }
  });
});
