import { describe, expect, test } from "vitest";
import { gapCount, gapLine } from "./emulation-gaps";

describe("실험장 한계 in the words of a result [REQ-098]", () => {
  test("the header counts the gaps of all calls and says nothing when there were none", () => {
    const calls = [
      { gaps: [{ tool: "awk", feature: "function:gensub" }] },
      {},
      {
        gaps: [
          { tool: "ps", feature: "flag:-Z" },
          { tool: "vim", feature: "command" },
        ],
      },
    ];
    expect(gapCount(calls)).toBe(3);
    expect(gapLine(calls)).toBe("실험장 한계 3번");
    expect(gapLine([{}, {}])).toBeUndefined();
    expect(gapLine(undefined)).toBeUndefined();
  });
});
