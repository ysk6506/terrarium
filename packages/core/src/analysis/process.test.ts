import type { RunEvent, ToolEvent } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { baselineNumbers, deltaNumbers, foldRun, meanNumbers, remainingLine, typicalRun } from ".";

type ToolEffect = ToolEvent["effect"];
let seq = 0;
const tool = (t: number, name: string, effect: ToolEffect = "observe"): RunEvent => ({
  kind: "tool",
  seq: seq++,
  t,
  tool: name,
  args: {},
  ok: true,
  effect,
  targets: [],
  summary: "",
});
const handed = (t: number, doneAt: number, onSite: boolean, team = "서버 팀"): RunEvent => ({
  kind: "counterpart",
  what: "handed",
  seq: seq++,
  t,
  handoff: `h${t}`,
  domain: "server",
  team,
  summary: "",
  faults: [
    {
      faultId: "f1",
      faultType: "disk_failure",
      target: "srv-1",
      etaSeconds: doneAt - t,
      doneAt,
      startsAt: t,
      kind: "part",
      onSite,
      who: "team",
    } as never,
  ],
});
const asked = (t: number): RunEvent => ({
  kind: "human",
  what: "asked",
  seq: seq++,
  t,
  request: "옮겨도 될까요?",
  recent: [],
});
const answered = (t: number): RunEvent => ({
  kind: "human",
  what: "answered",
  seq: seq++,
  t,
  by: "human",
  answer: "reply",
  waitedSeconds: 3,
});

const input = (events: RunEvent[], end = 5000) => ({ events, origin: 1000, end: 1000 + end });

describe("한 실행을 단계로 접기 [REQ-112]", () => {
  test("[REQ-112] 에이전트의 툴 호출은 한 줄로 접히고 툴 수가 센다", () => {
    const p = foldRun(
      input([
        tool(1000, "list_alarms"),
        tool(1060, "get_server"),
        tool(1120, "submit_diagnosis", "answer"),
      ]),
    );
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]).toMatchObject({ tag: "agent", tools: 3, from: 0, to: 120 });
    expect(p.rows[0]?.text).toContain("확인");
    expect(p.rows[0]?.text).toContain("진단");
    expect(p.steps).toBe(0);
    expect(p.people).toBe(0);
    expect(p.seconds).toBe(120);
  });

  test("[REQ-112] 넘기기는 리드타임과 함께 한 단계이고, 현장에 가면 물리다", () => {
    const remote = foldRun(
      input([tool(1000, "list_alarms"), tool(1100, "escalate", "act"), handed(1100, 1700, false)]),
    );
    expect(remote.rows.map((r) => r.tag)).toEqual(["agent", "handoff"]);
    expect(remote.rows[1]).toMatchObject({ who: "서버 팀", from: 100, to: 700 });
    expect(remote.rows[1]?.note).toContain("리드타임 10분");
    const onSite = foldRun(input([tool(1100, "escalate", "act"), handed(1100, 4700, true)]));
    expect(onSite.rows[0]?.tag).toBe("physical");
    expect(onSite.rows[0]?.note).toContain("1시간");
    // escalate itself is the hand-off, not a tool the agent used
    expect(onSite.tools).toBe(0);
  });

  test("[REQ-112] ask_human은 승인 한 단계이고 사람은 운영자 한 명이다", () => {
    const p = foldRun(
      input([
        tool(1000, "get_server"),
        tool(1200, "ask_human"),
        asked(1200),
        answered(1260),
        tool(1300, "vm_migrate", "act"),
      ]),
    );
    expect(p.rows.map((r) => r.tag)).toEqual(["agent", "approve", "agent"]);
    expect(p.rows[1]).toMatchObject({ who: "운영자", from: 200, to: 260, note: "ask_human" });
    expect(p.steps).toBe(1);
    expect(p.people).toBe(1);
    expect(p.tools).toBe(2);
  });

  test("[REQ-112] 기록이 없는 ask_human 호출도 한 단계로 센다", () => {
    const p = foldRun(input([tool(1200, "ask_human")]));
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]?.tag).toBe("approve");
  });

  test("[REQ-112] 기다리는 동안의 기다림 호출은 넘기기에 속하고, 일하는 호출은 에이전트 줄로 남는다", () => {
    const p = foldRun(
      input([
        tool(1000, "escalate", "act"),
        handed(1000, 2000, true),
        tool(1300, "events_since"),
        tool(1400, "wait", "wait"),
        tool(1500, "get_server"),
        tool(2100, "submit_diagnosis", "answer"),
      ]),
    );
    expect(p.tools).toBe(2);
    expect(p.rows.map((r) => r.tag)).toEqual(["physical", "agent"]);
  });

  test("[REQ-112] 사람 수는 남은 단계의 서로 다른 '누가'이고 같은 팀은 한 번만 센다", () => {
    const p = foldRun(
      input([
        tool(1000, "escalate", "act"),
        handed(1000, 1500, true, "서버 팀"),
        tool(1600, "escalate", "act"),
        handed(1600, 2000, true, "서버 팀"),
        tool(2100, "ask_human"),
        asked(2100),
        answered(2160),
      ]),
    );
    expect(p.steps).toBe(3);
    expect(p.people).toBe(2);
  });

  test("[REQ-112] 끝나기 전에 실행이 끝나면 실행 끝까지만 세고 그렇게 말한다", () => {
    const p = foldRun({
      events: [tool(1000, "escalate", "act"), handed(1000, 9000, true)],
      origin: 1000,
      end: 2000,
    });
    expect(p.rows[0]?.to).toBe(1000);
    expect(p.rows[0]?.text).toContain("끝났어요");
    expect(p.rows[0]?.note).toContain("끝나기 전");
  });

  test("[REQ-112] 사람이 한 단계도 안 남으면 그렇게 말한다", () => {
    expect(remainingLine(foldRun(input([tool(1000, "get_server")])).rows)).toContain(
      "남은 단계가 없어요",
    );
    const rows = foldRun(
      input([
        tool(1100, "escalate", "act"),
        handed(1100, 1700, true),
        tool(1800, "ask_human"),
        asked(1800),
        answered(1860),
      ]),
    ).rows;
    expect(remainingLine(rows)).toBe(
      "남은 2단계는 사람이 현장에 가야 하는 일(물리), 바꾸기 전 승인이에요.",
    );
  });
});

describe("적은 값과 잰 값 [REQ-112]", () => {
  const steps = [
    { who: "모니터링 담당", what: "알람 확인", minutes: 10, kind: "check" as const },
    { who: "가상화팀", what: "VM 상태 확인", minutes: 50, kind: "check" as const },
    { who: "서버팀", what: "현장 점검", minutes: 120, kind: "physical" as const },
    { who: "가상화팀", what: "VM 옮기기", minutes: 30, kind: "approve" as const },
    { who: " 서비스팀 ", what: "서비스 확인", minutes: 20, kind: "check" as const },
    { who: "서비스팀", what: "다시 확인", minutes: 0, kind: "check" as const },
  ];

  test("[REQ-112] 적은 표의 단계·사람·시간을 더한다 (사람은 서로 다른 누가)", () => {
    expect(baselineNumbers(steps)).toEqual({ steps: 6, people: 4, seconds: 230 * 60 });
  });

  test("[REQ-112] 평균은 소수 한 자리이고 차이는 잰 값에서 적은 값을 뺀다", () => {
    const run = (n: number, people: number, seconds: number) => ({
      rows: [],
      steps: n,
      people,
      seconds,
      tools: 0,
    });
    const mean = meanNumbers([run(2, 1, 5100), run(3, 2, 5400), run(2, 1, 5100)]);
    expect(mean).toEqual({ steps: 2.3, people: 1.3, seconds: 5200 });
    expect(deltaNumbers(mean, { steps: 5, people: 4, seconds: 13800 })).toEqual({
      steps: -2.7,
      people: -2.7,
      seconds: -8600,
    });
    expect(meanNumbers([])).toEqual({ steps: 0, people: 0, seconds: 0 });
  });

  test("[REQ-112] 장부는 평균 시간에 가장 가까운 실행을 보여 준다", () => {
    const run = (seconds: number) => ({ rows: [], steps: 1, people: 1, seconds, tools: 0 });
    expect(typicalRun([run(100), run(900), run(500), run(520)])).toBe(2);
    expect(typicalRun([])).toBe(-1);
  });
});
