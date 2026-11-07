import type { Score } from "@terrarium/core/oracle";
import type { ScenarioDoc } from "@terrarium/core/scenario";
import { describe, expect, test } from "vitest";
import { expectedLine, recoveryFigures } from "./recovery";
import { setExpectedRecovery } from "./scenario";

const score = (expected: number | undefined, agentSeconds: number, recovered = true) =>
  ({
    scoring: "recovery",
    total: 90,
    expectedRecoveryS: expected,
    recovery: {
      impairedAt: 0,
      recovered,
      seconds: agentSeconds,
      agentSeconds,
      worsened: [],
      byAgent: true,
    },
  }) as unknown as Score;

describe("expected recovery in the result and in the editor [REQ-108]", () => {
  test("the result says what the shape allows next to what the agent took", () => {
    expect(expectedLine(score(900, 660))).toBe("기대 복구 15분 · 실제 11분");
    expect(expectedLine(score(900, 0, false))).toContain("복구 못 함");
    expect(expectedLine(score(undefined, 60))).toBeUndefined();
    const first = recoveryFigures(score(14_400, 11_000))[0];
    expect(first?.note).toContain("기대 복구 4시간");
    expect(first?.ask).toBeTruthy();
  });

  test("the editor sets it in minutes, and clearing it leaves the sheet as it was", () => {
    const doc = { id: "x", expectations: [] } as unknown as ScenarioDoc;
    expect(setExpectedRecovery(doc, 15).expectedRecoveryS).toBe(900);
    expect(setExpectedRecovery(doc, 100_000).expectedRecoveryS).toBe(2880 * 60);
    const set = setExpectedRecovery(doc, 15);
    expect("expectedRecoveryS" in setExpectedRecovery(set, undefined)).toBe(false);
  });
});
