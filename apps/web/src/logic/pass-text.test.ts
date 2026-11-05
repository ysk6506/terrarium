import { PASS_MARK } from "@terrarium/core/oracle";
import { describe, expect, test } from "vitest";
import { PASS_RULE_TEXT, PASS_SHARE_TEXT } from "./format";

describe("what a pass takes reads the same as the scoring [REQ-037]", () => {
  test("the pass mark on screen is the core's constant, and a correct diagnosis is part of the rule", () => {
    expect(PASS_RULE_TEXT).toContain(`${PASS_MARK}점`);
    expect(PASS_SHARE_TEXT).toContain(`${PASS_MARK}점`);
    expect(PASS_RULE_TEXT).toContain("진단을 맞히고");
    expect(`${PASS_RULE_TEXT}${PASS_SHARE_TEXT}`).not.toContain("70");
  });
});
