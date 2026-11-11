import type { OperationMetrics } from "@terrarium/core/session";
import type { RunEvent } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import {
  harnessNotes,
  headlineFigures,
  limitNote,
  otherFigures,
  paceNote,
  resumeNotes,
} from "./operation";

const base: OperationMetrics = {
  seconds: 3600,
  incidents: 2,
  open: 1,
  alarms: 5,
  missed: 1,
  undetected: 0,
  worsened: 0,
  escalations: 0,
  calls: 10,
  quietCalls: 3,
};

describe("the operation screens word each measure by what is known of it [REQ-090]", () => {
  test("each kind of connection gets its own note, and an unknown kind gets the guide's", () => {
    expect(harnessNotes("scripted")[0]).toContain("'operator'");
    expect(harnessNotes("http")).toEqual(harnessNotes("a2a"));
    expect(harnessNotes("goclaw")).toEqual(harnessNotes("hermes"));
    expect(harnessNotes("goclaw")[0]).toContain("대화 길이 제한");
    expect(harnessNotes("mcp-agent")[0]).toContain("wait 호출");
    expect(harnessNotes(undefined)[0]).toContain("상주 루프 예");
    expect(harnessNotes("something-else")).toEqual(harnessNotes(undefined));
  });

  test("a world without a service says so instead of a percentage, and undetected incidents are counted as lasting to the end", () => {
    const none = headlineFigures({ ...base, undetected: 2 });
    expect(none[0]?.value).toBe("서비스 없음");
    expect(none[2]?.value).toBe("—");
    expect(none[2]?.hint).toContain("끝까지 확인 못 한 사건 2건");
    const some = headlineFigures({ ...base, availability: 0.9876, detectionDelayS: 90 });
    expect(some[0]?.value).toBe("98.76%");
    expect(some[1]).toMatchObject({ label: "놓친 알람", value: "1개" });
    expect(some[2]?.value).toBe("1분 30초");
    expect(some[2]?.hint).not.toContain("끝까지");
  });

  test("the other figures show the recovery spread when incidents ended and say none ended when they did not", () => {
    const ended = otherFigures({
      ...base,
      recovery: { min: 60, median: 120, max: 600 },
    } as OperationMetrics);
    expect(ended[0]?.value).toBe("2분");
    expect(ended[0]?.hint).toContain("최소 1분 · 최대 10분");
    expect(ended[0]?.hint).toContain("사건 2건 중 1건은 끝까지 안 풀렸어요");
    const open = otherFigures(base);
    expect(open[0]).toMatchObject({ value: "—" });
    expect(open[0]?.hint).toContain("끝난 사건이 없어요");
  });

  test("tokens and calls per incident appear only when the harness told them", () => {
    const without = otherFigures(base).map((f) => f.label);
    expect(without).not.toContain("사건당 토큰");
    expect(otherFigures(base).find((f) => f.label === "사건당 툴 호출")?.value).toBe("—");
    const withTokens = otherFigures({
      ...base,
      tokensPerIncident: 12345.6,
      callsPerIncident: 5,
      quietTokens: 2000,
      watchIntervalS: 300,
    });
    expect(withTokens.find((f) => f.label === "사건당 토큰")?.value).toBe("12,346");
    expect(withTokens.find((f) => f.label === "사건당 툴 호출")?.value).toBe("5.0회");
    expect(withTokens.find((f) => f.label === "조용할 때 쓴 호출")?.hint).toContain("약 2,000개");
    expect(withTokens.find((f) => f.label === "감시 주기")?.value).toBe("5분");
  });

  test("the pace note says whether the score is official, and a run stopped by the call limit says which limit", () => {
    expect(
      paceNote({ hours: 24, pace: { mode: "realtime" } } as Parameters<typeof paceNote>[0]),
    ).toContain("공식 점수");
    expect(
      paceNote({ hours: 24, pace: { mode: "realtime" } } as Parameters<typeof paceNote>[0]),
    ).not.toContain("아님");
    expect(
      paceNote({ hours: 24, pace: { mode: "fast", speed: 60 } } as Parameters<typeof paceNote>[0]),
    ).toContain("공식 점수 아님");
    expect(limitNote("tool_budget", { maxToolCalls: 300 })).toContain("300회 상한");
    expect(limitNote("tool_budget", undefined)).toBeUndefined();
    expect(limitNote("time_limit", { maxToolCalls: 300 })).toBeUndefined();
  });

  test("a server restart is told once each time, in seconds when short and in minutes when long", () => {
    const link = (gapSeconds?: number): RunEvent =>
      ({
        kind: "link",
        what: "resumed",
        t: 0,
        ...(gapSeconds === undefined ? {} : { gapSeconds }),
      }) as RunEvent;
    const notes = resumeNotes([
      link(30),
      link(0),
      link(300),
      { kind: "score", what: "agent_start", t: 0 } as RunEvent,
    ]);
    expect(notes).toHaveLength(3);
    expect(notes[0]).toContain("30초 뒤");
    expect(notes[1]).toContain("1초 뒤");
    expect(notes[2]).toContain("5분 뒤");
    expect(notes[2]).toContain("세계 시간은 흐르지 않았어요");
    expect(resumeNotes([link()])[0]).toContain("1초 뒤");
  });
});
