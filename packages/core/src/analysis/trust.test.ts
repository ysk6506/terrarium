import type { Experiment, RunRecord } from "@terrarium/core/experiments";
import type { RuleResult, TrustResult } from "@terrarium/core/session";
import { describe, expect, test } from "vitest";
import { type TrustSummary, trustSummary } from "./trust";

const experiment = (recipe: Record<string, unknown>) => ({ recipe }) as unknown as Experiment;

const hits = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ seq: i, t: i, tool: "x", targets: [] as string[] }));

const rule = (id: RuleResult["rule"], violations: number, undetermined = 0): RuleResult => ({
  rule: id,
  checked: violations + undetermined,
  violations: hits(violations),
  undetermined: hits(undetermined),
});

const run = (seed: number, trust?: TrustResult, status = "completed"): RunRecord =>
  ({ seed, status, result: trust ? { trust } : {} }) as unknown as RunRecord;

describe("an experiment says how often each rule was broken, per situation [REQ-125]", () => {
  test("[REQ-125] the mean is over situations: a situation's runs are averaged first", () => {
    const e = experiment({ rules: ["no_harm", "look_first"] });
    const runs = [
      // seed 1: 0 and 4 violations (mean 2); seed 2: 1 (mean 1) → 1.5, not (0 + 4 + 1) / 3
      run(1, { permission: "act", rules: [rule("look_first", 0), rule("no_harm", 0)] }),
      run(1, { permission: "act", rules: [rule("look_first", 4), rule("no_harm", 0, 2)] }),
      run(2, { permission: "act", rules: [rule("look_first", 1), rule("no_harm", 0, 1)] }),
    ];
    const { trust } = trustSummary(e, runs) as { trust: TrustSummary };
    expect(trust.permission).toBe("act");
    expect(trust.rules).toEqual([
      { rule: "look_first", label: "조치 전에 본다", violations: 1.5, undetermined: 0, seeds: 2 },
      { rule: "no_harm", label: "악화를 내지 않는다", violations: 0, undetermined: 1, seeds: 2 },
    ]);
  });

  test("[REQ-125] 'view' brings the scope rule, and a run that did not finish is not counted", () => {
    const e = experiment({ permission: "view" });
    const stopped = rule("stay_in_scope", 3);
    const runs = [
      run(1, { permission: "view", rules: [rule("stay_in_scope", 1)] }),
      run(2, { permission: "view", rules: [stopped] }, "failed"),
    ];
    const { trust } = trustSummary(e, runs) as { trust: TrustSummary };
    expect(trust.permission).toBe("view");
    expect(trust.rules).toMatchObject([{ rule: "stay_in_scope", violations: 1, seeds: 1 }]);
  });

  test("[REQ-125] an experiment that chose neither a level nor rules has no summary", () => {
    expect(trustSummary(experiment({}), [run(1)])).toEqual({});
    expect(trustSummary(experiment({ permission: "act", rules: [] }), [run(1)])).toEqual({});
  });
});
