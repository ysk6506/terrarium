import type { RunEvent } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { incidentSpans, isOperation, operationMarks } from "./operation-marks";

const list = (events: Record<string, unknown>[]): RunEvent[] =>
  events.map((e, seq) => ({ ...e, seq }) as unknown as RunEvent);

const alarm = (t: number, entity: string, raise = true) => ({
  kind: "world",
  t,
  cause: "physics",
  command: raise
    ? {
        type: "alarm.raise",
        alarm: {
          id: `a:${entity}`,
          entityId: entity,
          code: "a",
          severity: "warning",
          message: "x",
          since: t,
        },
      }
    : { type: "alarm.clear", alarmId: `a:${entity}` },
});

const call = (t: number, tool: string) => ({
  kind: "tool",
  t,
  tool,
  args: {},
  ok: true,
  effect: "observe",
  targets: [],
  summary: "",
});

const events = list([
  { kind: "score", what: "agent_start", t: 0, scenarioStart: 0 },
  {
    kind: "world",
    t: 100,
    cause: "generator",
    command: {
      type: "fault.add",
      fault: { id: "gen:1", type: "fan_failure", target: "srv-a1", params: {} },
    },
  },
  alarm(160, "srv-a1"),
  call(200, "get_entity"),
  call(300, "events_since"),
  { kind: "human", what: "asked", t: 320, request: "도와 주세요", recent: [] },
  { kind: "link", what: "lost", t: 340, reason: "끊겼어요" },
  { kind: "link", what: "back", t: 345 },
  alarm(900, "srv-a1", false),
  {
    kind: "world",
    t: 2000,
    cause: "generator",
    command: {
      type: "fault.add",
      fault: { id: "gen:2", type: "disk_full", target: "vm-web", params: {} },
    },
  },
]);

describe("the time bar of an operation [REQ-090]", () => {
  test("an operation is told by the faults the generator made", () => {
    expect(isOperation(events)).toBe(true);
    expect(isOperation(events.slice(0, 1))).toBe(false);
  });

  test("the marks keep only the looks at the alarms (봤다), and add the people who stepped in", () => {
    const marks = operationMarks(events);
    expect(marks.map((m) => m.kind)).toEqual([
      "fault",
      "alarm",
      "look",
      "human",
      "link",
      "recover",
    ]);
    expect(marks.find((m) => m.kind === "look")?.at).toEqual([300]);
    expect(marks.find((m) => m.kind === "human")?.at).toEqual([320]);
  });

  test("each incident has a bar from its fault to its end; an open one has no end", () => {
    expect(incidentSpans(events)).toEqual([
      { from: 100, to: 900, target: "srv-a1" },
      { from: 2000, target: "vm-web" },
    ]);
  });
});
