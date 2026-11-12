import { describe, expect, test } from "vitest";
import { END_REASON_LABELS, endReasonLabel, hoursText } from ".";

describe("how an operation says it ended [REQ-090]", () => {
  const op = { hours: 8, maxToolCalls: 5000 };

  test("the hours used up, a person's stop and the call limit are told in an operation's own words", () => {
    expect(endReasonLabel("time_limit", op)).toBe("운영 시간 끝(8시간)");
    expect(endReasonLabel("cancelled", op)).toBe("멈춤(사람)");
    expect(endReasonLabel("tool_budget", op)).toBe("호출 상한(5,000번)");
    expect(endReasonLabel("tool_budget", { hours: 1, maxToolCalls: 120 })).toBe("호출 상한(120번)");
  });

  test("a run that is not an operation keeps the old words, and the other reasons stay as they were", () => {
    expect(endReasonLabel("time_limit")).toBe(END_REASON_LABELS.time_limit);
    expect(endReasonLabel("cancelled")).toBe("멈춤");
    expect(endReasonLabel("agent_error", op)).toBe(END_REASON_LABELS.agent_error);
    expect(endReasonLabel("agent_finished", op)).toBe(END_REASON_LABELS.agent_finished);
  });

  test("the hours read the way a person says them", () => {
    expect(hoursText(48)).toBe("48시간");
    expect(hoursText(1.5)).toBe("1.5시간");
    expect(hoursText(0.15)).toBe("9분");
    expect(hoursText(0.001)).toBe("1분");
  });
});
