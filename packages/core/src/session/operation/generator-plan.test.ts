import { describe, expect, test } from "vitest";
import { DEFAULT_OPERATION, type OperationConfig } from "./config";
import { type Candidate, expectedPerHour, planFaults, sourcesOf, templatesOf } from "./generator";
import { MTBF_TABLE } from "./mtbf";

const candidates: Candidate[] = [...new Set(MTBF_TABLE.flatMap((r) => r.kinds))].flatMap((kind) => [
  { id: `${kind}-1`, kind },
  { id: `${kind}-2`, kind },
]);
const config = (over: Partial<OperationConfig> = {}): OperationConfig =>
  ({ ...DEFAULT_OPERATION, hours: 24, rateScale: 20, ...over }) as OperationConfig;

describe("the fault plan of an operation follows the seed, the world and the table [REQ-090]", () => {
  test("the same seed gives the same plan, in time order, numbered gen:1, gen:2 and so on, inside the hours", () => {
    const a = planFaults(candidates, config(), 7);
    const b = planFaults(candidates, config(), 7);
    expect(a.length).toBeGreaterThan(3);
    expect(b).toEqual(a);
    expect(a.map((f) => f.id)).toEqual(a.map((_, i) => `gen:${i + 1}`));
    expect(a.map((f) => f.at)).toEqual([...a.map((f) => f.at)].sort((x, y) => x - y));
    expect(a.every((f) => f.at >= 0 && f.at < 24 * 3600)).toBe(true);
    expect(planFaults(candidates, config(), 8)).not.toEqual(a);
  });

  test("a chance of one makes a simultaneous and a cascading fault for every random one, close in time", () => {
    const plan = planFaults(candidates, config({ simultaneousChance: 1, cascadeChance: 1 }), 3);
    const why = (w: string) => plan.filter((f) => f.why === w).length;
    expect(why("random")).toBeGreaterThan(0);
    expect(why("simultaneous")).toBeGreaterThan(0);
    expect(why("cascade")).toBeGreaterThan(0);
    const none = planFaults(candidates, config({ simultaneousChance: 0, cascadeChance: 0 }), 3);
    expect(none.every((f) => f.why === "random")).toBe(true);
  });

  test("a world with nothing the table can break, or a rate scale of nothing, has no faults", () => {
    expect(planFaults([], config(), 1)).toEqual([]);
    expect(planFaults(candidates, config(), 1, { rateScale: 0 })).toEqual([]);
  });

  test("a world's hazard changes the hours of one kind of fault and the rate of all of them", () => {
    const row = MTBF_TABLE[0];
    if (!row) throw new Error("no table");
    const base = sourcesOf(candidates).filter((s) => s.type === row.type);
    const fast = sourcesOf(candidates, { [`mtbf.${row.type}`]: row.hours / 10 }).filter(
      (s) => s.type === row.type,
    );
    expect(fast[0]?.rate).toBeCloseTo((base[0]?.rate ?? 0) * 10, 9);
    const doubled = sourcesOf(candidates, { rateScale: 2 }).filter((s) => s.type === row.type);
    expect(doubled[0]?.rate).toBeCloseTo((base[0]?.rate ?? 0) * 2, 9);
    expect(expectedPerHour(candidates, 2)).toBeCloseTo(2 * expectedPerHour(candidates, 1), 9);
  });

  test("a set of faults is played once each, in random order, between the quiet first and last stretches", () => {
    const faults = [
      { type: "cooling_unit_failure", target: "crah-1" },
      { type: "ups_battery_degraded", target: "ups-a", params: { health: 0.3 } },
      { type: "chiller_failure", target: "chiller-1" },
    ] as const;
    const plan = planFaults(
      [],
      config({ source: { kind: "set", faults } } as Partial<OperationConfig>),
      5,
    );
    expect(plan.map((f) => f.type).sort()).toEqual(faults.map((f) => f.type).sort());
    expect(plan.every((f) => f.why === "set")).toBe(true);
    expect(plan.every((f) => f.at >= 24 * 3600 * 0.05 && f.at <= 24 * 3600 * 0.85)).toBe(true);
    expect(plan.find((f) => f.type === "ups_battery_degraded")?.params).toEqual({ health: 0.3 });
    expect(plan.find((f) => f.type === "chiller_failure")).not.toHaveProperty("params");
  });

  test("inject blocks of a scenario become fault templates, and a block with no target or another kind does not", () => {
    expect(
      templatesOf([
        { type: "inject_fault", params: { faultType: "cooling_unit_failure", target: "crah-1" } },
        {
          type: "inject_fault",
          params: { faultType: "chiller_failure", target: "ch-1", faultParams: { a: 1 } },
        },
        { type: "inject_fault", params: { faultType: "x" } },
        { type: "wait", params: { faultType: "y", target: "z" } },
        { type: "inject_fault", params: { target: "t" } },
      ]),
    ).toEqual([
      { type: "cooling_unit_failure", target: "crah-1" },
      { type: "chiller_failure", target: "ch-1", params: { a: 1 } },
    ]);
  });
});
