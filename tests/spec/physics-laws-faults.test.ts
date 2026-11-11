/**
 * [REQ-113] The physics laws on days with faults (ADR-0142, follow-up of ADR-0137): every kind of fault in the registry that
 * touches heat or electricity is put into a world, held long enough for its consequences (trips, thermal shutdowns, battery
 * drain), removed, and the world runs on to recover, with the law monitor checking every step. What v1 breaks is a finding:
 * it is named in `KNOWN_V1_EXCEPTIONS` (fault, law, numbers, cause) and left for the v2 physics, never hidden by changing the
 * physics here (`physics-golden.test.ts` stays as it is).
 */
import { KNOWN_V1_EXCEPTIONS } from "@terrarium/core/physics";
import { describe, expect, test } from "vitest";
import { PLANS, physicsFaultTypes } from "./test-support/fault-law-plans";
import { baselineFingerprint, runPlan, runsOf } from "./test-support/fault-law-run";

const types = physicsFaultTypes();
const baselines = new Map<string, string>();
/** Which exceptions of `KNOWN_V1_EXCEPTIONS` the runs of this file met. */
const found = new Set<number>();

describe("every fault kind that touches physics is exercised under the laws [REQ-113]", () => {
  test("each physics fault kind of the registry has a plan, and every plan is for a fault of the registry", () => {
    expect(types.filter((t) => !PLANS[t])).toEqual([]);
    expect(Object.keys(PLANS).filter((t) => !(types as string[]).includes(t))).toEqual([]);
  });

  const cases = types.flatMap((type) =>
    runsOf(type, PLANS[type] as NonNullable<(typeof PLANS)[typeof type]>).map(
      (r) => [type, r.lab, r.severity] as const,
    ),
  );
  test.each(cases)(
    "%s in the %s world, %s severity: no law is broken but the known v1 cases",
    (type, lab, severity) => {
      const plan = PLANS[type];
      if (!plan) throw new Error(`no plan for ${type}`);
      const run = runPlan(type, plan, lab, severity);
      expect([...new Set(run.hit.map((h) => h.type))]).toEqual(plan.hits.map((h) => h.type));
      // A parameter at the end of its range can lie outside the hardware (PSU number 5 of 2) or below what the world already
      // does (a runaway to 50 % on a server asked for 90 %), so only the default severity must show an effect.
      if (severity === "default") {
        const key = `${lab}/${plan.holdS}`;
        const baseline = baselines.get(key) ?? baselineFingerprint(plan, lab, severity);
        baselines.set(key, baseline);
        expect(run.fingerprint, "the fault changed nothing in the world").not.toBe(baseline);
      }
      expect(run.report.steps).toBe((plan.holdS + plan.recoverS) / 10);
      for (const v of run.report.known)
        KNOWN_V1_EXCEPTIONS.forEach((k, i) => {
          if (k.fault === type && k.law === v.law && v.where.includes(k.where)) found.add(i);
        });
      expect(run.report.failures.map((v) => `${v.law} ${v.where} ${v.message}`)).toEqual([]);
    },
    300_000,
  );

  test("each exception of v1 on a fault day names the fault, the law, the numbers and the cause, and every one is still found", () => {
    KNOWN_V1_EXCEPTIONS.forEach((k, i) => {
      if (k.fault === undefined) return;
      expect(types as string[]).toContain(k.fault);
      expect(k.measured?.length ?? 0).toBeGreaterThan(10);
      expect(k.reason.length).toBeGreaterThan(10);
      expect(found.has(i), `${k.fault} ${k.law} ${k.where} is no longer found: remove it`).toBe(
        true,
      );
    });
  });
});
