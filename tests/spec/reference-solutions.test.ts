/**
 * [REQ-110] The grader gives the right solution exactly 100 (ADR-0133). For every built-in scenario template (in each
 * mode of a site) and for every fault kind no template injects, the reference solver plays the canonical path of the
 * fault through the same tools an agent has, and every part of the score is full: no fault kind or sheet is left that
 * a perfect agent cannot finish with 100. A sheet that fails here is a sheet or a formula to fix, not a number to lower.
 */
import { describe, expect, test } from "vitest";
import { referenceCases } from "./test-support/reference-cases";
import { solve } from "./test-support/reference-solver";

describe("the reference solution scores exactly 100 on every sheet [REQ-110]", () => {
  for (const c of referenceCases()) {
    test(c.label, () => {
      const { result, calls } = solve(c.blueprint, c.doc());
      const score = result.score;
      const short = score.items
        .filter((i) => i.points < i.max)
        .map((i) => `${i.id} ${i.points}/${i.max}`);
      expect(short, `every part of the score is full (${calls.length} calls)`).toEqual([]);
      expect(Math.abs(score.penalty ?? 0)).toBe(0);
      expect(score.total).toBe(100);
      expect(score.passed).toBe(true);
      expect(score.recovery?.worsened ?? []).toEqual([]);
    }, 60_000);
  }

  test("there are as many sheets as templates, site modes and template-less fault kinds", () => {
    expect(referenceCases().length).toBeGreaterThanOrEqual(100);
  });
});
