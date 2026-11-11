import { CLUSTER_CAUSE } from "@terrarium/core/physics";
import type { RunEvent } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { visibleEvent, visibleSince } from "./ops";

const name = (id: string) => `이름-${id}`;
const world = (command: Record<string, unknown>, cause = "scenario", t = 100): RunEvent =>
  ({ kind: "world", seq: 0, t, cause, command }) as unknown as RunEvent;

describe("events_since shows an operator only what an operator would see [REQ-093]", () => {
  test("an alarm that comes is shown with its text, entity, severity and code", () => {
    const e = world({
      type: "alarm.raise",
      alarm: {
        id: "a:crah-1",
        message: "냉방기가 멈췄어요",
        entityId: "crah-1",
        severity: "critical",
        code: "unit_down",
      },
    });
    expect(visibleEvent(e, name)).toEqual({
      t: 100,
      type: "alarm_raised",
      text: "냉방기가 멈췄어요",
      entity: "crah-1",
      severity: "critical",
      code: "unit_down",
    });
  });

  test("an alarm that goes is shown with the name of its entity and its code, taken from the alarm's id", () => {
    expect(visibleEvent(world({ type: "alarm.clear", alarmId: "unit_down:crah-1" }), name)).toEqual(
      {
        t: 100,
        type: "alarm_cleared",
        text: "이름-crah-1 알람이 풀렸어요",
        entity: "crah-1",
        code: "unit_down",
      },
    );
    const bare = visibleEvent(world({ type: "alarm.clear", alarmId: "plain" }), name);
    expect(bare).toEqual({
      t: 100,
      type: "alarm_cleared",
      text: "plain 알람이 풀렸어요",
      code: "plain",
    });
  });

  test("a machine that shuts itself down because of heat is shown, and the faults and other commands are not", () => {
    const shut = visibleEvent(world({ type: "thermal.shutdown", target: "srv-1" }), name);
    expect(shut).toMatchObject({ type: "shutdown", entity: "srv-1" });
    expect(shut?.text).toContain("열 때문에 꺼졌어요");
    expect(visibleEvent(world({ type: "fault.add" }), name)).toBeUndefined();
    expect(
      visibleEvent(
        { kind: "score", what: "agent_start", seq: 0, t: 0 } as unknown as RunEvent,
        name,
      ),
    ).toBeUndefined();
  });

  test("what the system did by itself is shown as auto recovery, in its own words or the note's", () => {
    expect(visibleEvent(world({ type: "db.promote" }, CLUSTER_CAUSE), name)).toMatchObject({
      type: "auto_recovery",
      text: "데이터베이스가 스스로 새 주 인스턴스를 올렸어요",
    });
    expect(visibleEvent(world({ type: "something.else" }, CLUSTER_CAUSE), name)?.text).toBe(
      "시스템이 스스로 복구하고 있어요",
    );
    expect(
      visibleEvent(world({ type: "note", text: "복제본을 올리는 중" }, CLUSTER_CAUSE), name)?.text,
    ).toBe("복제본을 올리는 중");
    expect(
      visibleEvent(world({ type: "alarm.clear", alarmId: "x:y" }, CLUSTER_CAUSE), name)?.type,
    ).toBe("alarm_cleared");
  });

  test("a team's hand-off is shown with its faults, and a team's finish with the fault it fixed", () => {
    const handed = {
      kind: "counterpart",
      what: "handed",
      t: 50,
      summary: "넘겼어요",
      handoff: "h1",
      domain: "service_os",
      faults: [{ faultId: "f1", faultType: "cooling_unit_failure", target: "crah-1", doneAt: 900 }],
    } as unknown as RunEvent;
    expect(visibleEvent(handed, name)).toMatchObject({
      type: "handed",
      handoff: "h1",
      faults: [{ fault: "f1", type: "cooling_unit_failure", target: "crah-1", doneAt: 900 }],
    });
    const done = {
      ...handed,
      what: "done",
      fault: { faultId: "f1", target: "crah-1" },
    } as unknown as RunEvent;
    expect(visibleEvent(done, name)).toMatchObject({ type: "done", entity: "crah-1", fault: "f1" });
  });

  test("the cursor moves to the end, nothing from before the agent had the task is shown, and a second ask gives only what is new", () => {
    const early = world({ type: "alarm.clear", alarmId: "a:x" }, "scenario", 1);
    const start = { kind: "score", what: "agent_start", seq: 1, t: 10 } as unknown as RunEvent;
    const late = world({ type: "alarm.clear", alarmId: "b:y" }, "scenario", 20);
    const events = [early, start, late];
    const first = visibleSince(events, 0, name);
    expect(first.cursor).toBe(3);
    expect(first.events.map((v) => v.code)).toEqual(["b"]);
    expect(visibleSince(events, first.cursor, name)).toEqual({ cursor: 3, events: [] });
    const more = [...events, world({ type: "alarm.clear", alarmId: "c:z" }, "scenario", 30)];
    expect(visibleSince(more, first.cursor, name).events.map((v) => v.code)).toEqual(["c"]);
    expect(visibleSince([early], 0, name).events.map((v) => v.code)).toEqual(["a"]);
  });
});
