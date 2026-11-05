import type { AgentCensus } from "@terrarium/core/contract";
import { describe, expect, test } from "vitest";
import { censusText, hiddenWarning, reasonPhrase } from "./agent-census";

const census = (extra: Partial<AgentCensus> = {}): AgentCensus => ({
  shown: 1,
  total: 37,
  hidden: [{ reason: "status inactive", count: 36 }],
  includesHidden: false,
  notes: [],
  ...extra,
});

describe("the agent list says how many there are and why some are not shown [REQ-079]", () => {
  test("37 agents, 1 shown: the other 36 are named by their state, with 모두 보기", () => {
    expect(censusText(census())).toEqual({
      headline: "에이전트 37개 중 1개가 보여요.",
      lines: ["36개는 쉬는 중('inactive')라 숨겼어요."],
      action: "모두 보기",
    });
  });

  test("showing everything says the same reasons as a fact, and offers to put them away", () => {
    const text = censusText(census({ includesHidden: true }));
    expect(text.headline).toBe("에이전트 37개를 모두 보여 줘요.");
    expect(text.lines).toEqual(["36개는 쉬는 중('inactive')라 평소에는 숨겨요."]);
    expect(text.action).toBe("다시 숨기기");
    expect(censusText(census(), true).action).toBe("다시 숨기기");
  });

  test("when every agent is left out the headline says so instead of '0개 중'", () => {
    expect(
      censusText(census({ shown: 0, total: 3, hidden: [{ reason: "status inactive", count: 3 }] }))
        .headline,
    ).toBe("에이전트 3개가 모두 숨겨져 있어요.");
  });

  test("no agents says what the answer looked like, as it came", () => {
    expect(
      censusText(
        census({ shown: 0, total: 0, hidden: [], empty: "응답의 agents 배열이 비어 있어요" }),
      ),
    ).toEqual({ headline: "에이전트가 없어요 — 응답의 agents 배열이 비어 있어요.", lines: [] });
    expect(censusText(census({ shown: 0, total: 0, hidden: [] })).headline).toBe(
      "에이전트가 없어요.",
    );
  });

  test("nothing left out is a plain count with no button; notes follow the reasons", () => {
    expect(censusText(census({ shown: 5, total: 5, hidden: [] }))).toEqual({
      headline: "에이전트 5개가 있어요.",
      lines: [],
    });
    expect(censusText(census({ notes: ["사용자 ID를 봐 주세요."] })).lines.at(-1)).toBe(
      "사용자 ID를 봐 주세요.",
    );
  });

  test("a state the screen has no word for is shown as the harness wrote it", () => {
    expect(reasonPhrase("status archived")).toBe("상태가 'archived'");
    expect(reasonPhrase("mode subagent")).toBe("다른 에이전트가 부르는 서브에이전트('subagent')");
    expect(reasonPhrase("뭔가")).toBe("'뭔가'");
  });

  test("an agent used though it was left out gets one warning line; a listed one gets none", () => {
    expect(hiddenWarning({ hidden: "status inactive" })).toBe(
      "쉬는 중('inactive')인 에이전트는 실험에서 답하지 않을 수 있어요.",
    );
    expect(hiddenWarning({})).toBeUndefined();
    expect(hiddenWarning(undefined)).toBeUndefined();
  });
});
