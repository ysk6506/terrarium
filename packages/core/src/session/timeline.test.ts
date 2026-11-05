import type { ScenarioDoc, ToolCallRecord, TraceEntry } from "@terrarium/core/scenario";
import type { WorldEvent } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { buildTimeline } from ".";

const node = (
  id: string,
  type: string,
  params: Record<string, string | number> = {},
  label?: string,
) => ({
  id,
  type,
  params,
  position: { x: 0, y: 0 },
  ...(label ? { label } : {}),
});

const doc = {
  schemaVersion: 1,
  id: "s",
  name: "s",
  description: "",
  worldId: "w",
  nodes: [
    node("a", "start"),
    node("f", "inject_fault", { faultType: "cooling_unit_failure", target: "crah-1" }),
    node("g", "inject_fault", { faultType: "not-a-fault" }),
    node("b", "branch"),
    node("r", "random", {}, "내 이름표"),
    node("n", "no-such-block-type"),
  ],
  edges: [],
  expectations: [],
} as unknown as ScenarioDoc;

const step = (nodeId: string, what: TraceEntry["what"], detail?: string, t = 0): TraceEntry => ({
  t,
  nodeId,
  what,
  ...(detail !== undefined ? { detail } : {}),
});

const textOf = (trace: TraceEntry[], nameOf?: (id: string) => string) =>
  buildTimeline(doc, trace, [], [], 0, nameOf).map((e) => e.text);

describe("a run's timeline says what the scenario did in words [REQ-037]", () => {
  test("a block is named by its caption, else by its kind, else by its id", () => {
    expect(
      textOf([step("r", "ran"), step("a", "ran"), step("n", "ran"), step("zzz", "ran")]),
    ).toEqual(["내 이름표", "시작", "n", "zzz"]);
  });

  test("a fault block says which fault and, by name, where", () => {
    const names: Record<string, string> = { "crah-1": "냉방기 1" };
    expect(textOf([step("f", "ran")], (id) => names[id] ?? id)[0]).toBe(
      "냉방기 정지 발생 (냉방기 1)",
    );
  });

  test("a fault block with a fault type nobody knows falls back to the block's name", () => {
    expect(textOf([step("g", "ran")])[0]).toContain("고장 발생");
  });

  test("waiting, resuming, meeting a condition and timing out each have a word", () => {
    const out = textOf([
      step("a", "waiting"),
      step("a", "resumed"),
      step("a", "met"),
      step("a", "timeout"),
      step("a", "error"),
    ]);
    expect(out).toEqual([
      "시작 시작",
      "시작 끝",
      "시작 조건 충족",
      "시작 시간 초과",
      "시작 실행 못 함",
    ]);
  });

  test("a choice says yes or no on a branch and the number of the way on a random block", () => {
    const out = textOf([
      step("b", "chose", "yes"),
      step("b", "chose", "no"),
      step("r", "chose", "2"),
      step("r", "chose"),
    ]);
    expect(out.map((t) => t.split(": ")[1])).toEqual(["예", "아니오", "2번 갈래", undefined]);
  });

  test("an automatic recovery does not show the fault's internal id; any other detail is shown", () => {
    expect(textOf([step("f", "expired", "fault-77")])[0]).not.toContain("fault-77");
    expect(textOf([step("a", "ran", "열 줄")])[0]).toBe("시작: 열 줄");
  });
});

const raise = (
  t: number,
  id: string,
  message: string,
  severity: "warning" | "critical" = "warning",
): WorldEvent =>
  ({
    type: "alarm.raise",
    seq: 1,
    t,
    cause: "physics",
    alarm: { id, entityId: "rack-1", code: "temp", severity, message, since: t },
  }) as WorldEvent;
const clear = (t: number, alarmId: string): WorldEvent =>
  ({ type: "alarm.clear", seq: 2, t, cause: "physics", alarmId }) as WorldEvent;
const call = (t: number, tool: string, extra: Partial<ToolCallRecord> = {}): ToolCallRecord => ({
  t,
  tool,
  args: {},
  ok: true,
  ...extra,
});

describe("alarms and the agent's calls share one axis with the scenario [REQ-037]", () => {
  test("only alarms from the run's start on are listed, but a cleared one is still named", () => {
    const events = [
      raise(10, "x", "온도 높음"),
      clear(100, "x"),
      clear(120, "unknown-id"),
      raise(200, "y", "습도", "critical"),
    ];
    const out = buildTimeline(doc, [], events, [], 50);
    expect(out.map((e) => e.text)).toEqual(["복구: 온도 높음", "복구: unknown-id", "습도"]);
    expect(out[2]).toMatchObject({ source: "alarm", severity: "critical", entityId: "rack-1" });
  });

  test("a wait reads as minutes; a plain call is its name; arguments and effects follow", () => {
    const out = buildTimeline(
      doc,
      [],
      [],
      [
        call(1, "wait", { args: { seconds: 300 } }),
        call(2, "list_alarms"),
        call(3, "set_setpoint", {
          args: { celsius: 20 },
          effects: [{ action: "setpoint_change", target: "crah-1" }],
        }),
        call(4, "power_off", { effects: [{ action: "power_off", target: "srv-1" }] }),
        call(5, "restart", { ok: false, error: "없는 장비예요" }),
        call(6, "restart", { ok: false }),
        call(7, "wait", { ok: false, args: { seconds: 60 }, error: "안 돼요" }),
      ],
      0,
    ).map((e) => e.text);
    expect(out[0]).toContain("기다려요");
    expect(out.slice(1)).toEqual([
      "list_alarms",
      'set_setpoint {"celsius":20} → crah-1 냉방 설정 변경',
      "power_off → srv-1 전원 끄기",
      "restart — 실패: 없는 장비예요",
      "restart — 실패: 알 수 없음",
      'wait {"seconds":60} — 실패: 안 돼요',
    ]);
  });

  test("at the same moment the scenario comes first, then the alarm, then the agent", () => {
    const out = buildTimeline(
      doc,
      [step("a", "ran", undefined, 5)],
      [raise(5, "x", "알람")],
      [call(5, "list_alarms")],
      0,
    );
    expect(out.map((e) => e.source)).toEqual(["scenario", "alarm", "agent"]);
  });

  test("the entries are in time order, and equal times keep the order they came in", () => {
    const out = buildTimeline(doc, [], [], [call(9, "b"), call(3, "a"), call(9, "c")], 0);
    expect(out.map((e) => e.text)).toEqual(["a", "b", "c"]);
  });
});
