import { DEFAULT_TOOLSET, TOOL_DOCS, TOOL_NAMES } from "@terrarium/core/tools";
import { describe, expect, test } from "vitest";
import { PICK_SITUATIONS, toolPickCheck } from "./tool-pick";

describe("the tool-pick check reads the descriptions [REQ-080]", () => {
  test("for each situation the reference agent reaches for a tool a person would accept", () => {
    const check = toolPickCheck(TOOL_NAMES);
    expect(check.rows).toHaveLength(PICK_SITUATIONS.length);
    for (const row of check.rows) {
      expect(row.picked.length, row.situation.id).toBeGreaterThan(0);
      expect(row.hit, `${row.situation.id}: ${row.picked.join(", ")}`).toBe(true);
    }
  });

  test("the tools we give are told apart: no pair is left that the descriptions cannot separate", () => {
    expect(toolPickCheck(TOOL_NAMES).ambiguous).toEqual([]);
    expect(toolPickCheck(DEFAULT_TOOLSET).warnings).toEqual([]);
  });

  test("two tools that claim the same situation and do not point at each other are an ambiguous pair", () => {
    const real = TOOL_DOCS.reset_breaker;
    if (!real) throw new Error("reset_breaker");
    try {
      (TOOL_DOCS as Record<string, unknown>).reset_breaker = {
        ...real,
        notUse: "the load is still over capacity (it trips again; shed load first).",
      };
      const check = toolPickCheck(TOOL_NAMES);
      expect(check.ambiguous).toEqual([
        { a: "facility_status", b: "reset_breaker", situations: ["power_dark"] },
      ]);
      expect(check.warnings[0]).toContain("`facility_status`와 `reset_breaker`");
      expect(check.warnings[0]).toContain("전원이 끊겼어요");
    } finally {
      (TOOL_DOCS as Record<string, unknown>).reset_breaker = real;
    }
  });

  test("a situation whose best tool was not given is not blamed on the descriptions", () => {
    const check = toolPickCheck(["wait", "submit_diagnosis"]);
    expect(check.warnings).toEqual([]);
  });

  test("tools without a description are left out", () => {
    expect(toolPickCheck(["list_alarms", "not_a_tool"]).tools).toEqual(["list_alarms"]);
  });
});
