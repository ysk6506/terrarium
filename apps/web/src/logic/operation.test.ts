import type { RunEvent } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { inline, parseMarkdown, titleOf } from "./mini-markdown";
import {
  checkCard,
  checkText,
  harnessNotes,
  headlineFigures,
  nextTeamDone,
  RECOMMENDED_LINES,
  recommendedInstruction,
  wakeReason,
} from "./operation";

const base = { seq: 0 } as const;
const events = (list: Record<string, unknown>[]): RunEvent[] =>
  list.map((e, seq) => ({ ...e, seq }) as unknown as RunEvent);

describe("the operation screens say what the measures mean [REQ-090]", () => {
  test("the three numbers come first, in the order of the decision", () => {
    const f = headlineFigures({
      seconds: 28_800,
      availability: 0.9875,
      incidents: 4,
      open: 0,
      alarms: 9,
      missed: 2,
      detectionDelayS: 240,
      undetected: 0,
      worsened: 0,
      escalations: 1,
      calls: 40,
      quietCalls: 30,
    });
    expect(f.map((x) => x.label)).toEqual(["서비스 가용률", "놓친 알람", "탐지 지연"]);
    expect(f.map((x) => x.value)).toEqual(["98.75%", "2개", "4분"]);
  });

  test("the recommended instruction has the five lines and a reason for each", () => {
    expect(RECOMMENDED_LINES).toHaveLength(5);
    expect(recommendedInstruction().split("\n")[0]).toContain("5분마다 events_since");
    for (const l of RECOMMENDED_LINES) expect(l.why.length).toBeGreaterThan(20);
    expect(harnessNotes("goclaw").join(" ")).toContain("가이드");
  });

  test("waking on every alarm is grey, with the reason, when the connection cannot take it", () => {
    expect(wakeReason(false)).toMatch(/직접 확인/);
    expect(wakeReason(true)).toBeUndefined();
  });

  test("the check-in card counts open incidents, missed alarms and the next team's finish", () => {
    const list = events([
      { ...base, kind: "score", what: "agent_start", t: 0, scenarioStart: 0 },
      {
        kind: "world",
        t: 3600,
        cause: "generator",
        command: {
          type: "fault.add",
          fault: { id: "gen:1", type: "fan_failure", target: "srv-a1", params: {} },
        },
      },
      {
        kind: "world",
        t: 3700,
        cause: "physics",
        command: {
          type: "alarm.raise",
          alarm: {
            id: "a:srv-a1",
            entityId: "srv-a1",
            code: "a",
            severity: "warning",
            message: "x",
            since: 3700,
          },
        },
      },
      {
        kind: "counterpart",
        t: 3800,
        handoff: "h1",
        domain: "server",
        team: "서버 팀",
        summary: "",
        what: "handed",
        faults: [
          {
            faultId: "gen:1",
            faultType: "fan_failure",
            target: "srv-a1",
            etaSeconds: 7200,
            doneAt: 11_000,
            startsAt: 9000,
            kind: "replace",
            onSite: true,
            who: "team",
          },
        ],
      },
      {
        kind: "tool",
        t: 50_400,
        tool: "get_entity",
        args: {},
        ok: true,
        effect: "observe",
        targets: [],
        summary: "",
      },
    ]);
    expect(nextTeamDone(list.slice(0, 4), 3800)).toBe(7200);
    const card = checkCard(list.slice(0, 4), 8);
    expect(checkText(card)).toBe("2시간째 · 열린 사건 1 · 놓친 알람 1 · 다음 담당자 완료 2시간 뒤");
  });
});

describe("the guide is shown from its own text [REQ-090]", () => {
  test("headings, tables, lists, code and inline marks come out as blocks", () => {
    const blocks = parseMarkdown(
      "---\ntitle: 가이드\n---\n# 제목\n\n문장 `code` 와 **굵게**\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- 하나\n- 둘\n\n```\nx = 1\n```\n",
    );
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "para", "table", "list", "code"]);
    expect(inline("문장 `code` 와 **굵게**").map((p) => [p.text, !!p.code, !!p.bold])).toEqual([
      ["문장 ", false, false],
      ["code", true, false],
      [" 와 ", false, false],
      ["굵게", false, true],
    ]);
    expect(titleOf("---\ntitle: 가이드\nkind: guide\n---\n# x")).toBe("가이드");
  });
});
