import type { RunEvent } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { AlarmFeed, alarmSummary } from "./alarm-wake";

const raised = (severity: "warning" | "critical"): RunEvent => ({
  kind: "world",
  seq: 0,
  t: 10,
  cause: "physics",
  command: {
    type: "alarm.raise",
    alarm: {
      id: "hot:srv-a1",
      entityId: "srv-a1",
      code: "hot",
      severity,
      message: "흡기 온도가 높아요",
      since: 10,
    },
  },
});

describe("waking a harness on every alarm [REQ-090]", () => {
  test("a new alarm becomes one line; anything else is not an alarm", () => {
    expect(alarmSummary(raised("critical"))).toBe("[심각] 흡기 온도가 높아요 (srv-a1)");
    expect(alarmSummary(raised("warning"))).toBe("[경고] 흡기 온도가 높아요 (srv-a1)");
    expect(
      alarmSummary({ kind: "score", what: "agent_start", seq: 1, t: 0, scenarioStart: 0 }),
    ).toBeUndefined();
  });

  test("the listeners are told about alarms only, and stop when they unsubscribe", () => {
    const feed = new AlarmFeed();
    const told: string[] = [];
    const off = feed.subscribe((s) => told.push(s));
    expect(
      feed.offer([
        raised("warning"),
        { kind: "score", what: "agent_start", seq: 1, t: 0, scenarioStart: 0 },
      ]),
    ).toBe(1);
    off();
    feed.offer([raised("critical")]);
    expect(told).toEqual(["[경고] 흡기 온도가 높아요 (srv-a1)"]);
  });
});
