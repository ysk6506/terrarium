import { SCENARIO_TEMPLATES } from "@terrarium/core/scenario";
import { DEFAULT_TOOLSET } from "@terrarium/core/tools";
import { BlueprintIndex, type RunEvent } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../world/test-support/sample";
import { Session, stampReal } from ".";

function started(): Session {
  const blueprint = sampleBlueprint();
  const scenario = SCENARIO_TEMPLATES.find((t) => t.id === "cooling-failure")?.build(
    new BlueprintIndex(blueprint),
    "sample",
  );
  if (!scenario) throw new Error("template");
  const session = Session.create({
    blueprint,
    scenario,
    tools: [...DEFAULT_TOOLSET, "get_impact"],
    seed: 7,
  });
  session.start();
  return session;
}

describe("a run is recorded as an append-only list of events [REQ-083]", () => {
  test("tool calls, world events and the score are in one list, in time order, numbered from 0", () => {
    const session = started();
    session.call("list_alarms", { severity: "critical" });
    session.call("get_impact", { id: "crah-1" });
    session.call("submit_diagnosis", {
      rootCause: "crah-1",
      faultType: "cooling_unit_failure",
      summary: "x",
    });
    const events = session.finish().events as readonly RunEvent[];
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
    const times = events.map((e) => e.t);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(events.map((e) => e.kind))).toEqual(new Set(["world", "tool", "score"]));
    const tools = events.filter((e) => e.kind === "tool");
    expect(tools.map((e) => e.tool)).toEqual(["list_alarms", "get_impact", "submit_diagnosis"]);
    expect(tools[1]).toMatchObject({ effect: "observe", ok: true, targets: ["crah-1"] });
    expect(tools[2]).toMatchObject({ effect: "answer" });
    expect(events.some((e) => e.kind === "world" && e.command.type === "fault.add")).toBe(true);
    expect(events.some((e) => e.kind === "world" && e.command.type === "alarm.raise")).toBe(true);
    expect(events.some((e) => e.kind === "world" && e.command.type === "note")).toBe(false);
  });

  test("the run ends with 'closed' and then 'graded', and the grade names the answer", () => {
    const session = started();
    session.call("submit_diagnosis", {
      rootCause: "crah-1",
      faultType: "cooling_unit_failure",
      summary: "x",
    });
    const result = session.finish();
    const [closed, graded] = (result.events as readonly RunEvent[]).slice(-2);
    expect(closed).toMatchObject({
      kind: "score",
      what: "closed",
      reason: "diagnosed",
      diagnosed: true,
    });
    expect(graded).toMatchObject({
      kind: "score",
      what: "graded",
      total: result.score.total,
      rootCause: ["crah-1"],
    });
    expect((graded as RunEvent).t).toBeGreaterThanOrEqual((closed as RunEvent).t);
  });

  test("a host reading while the run goes sees only what is new, and the list never changes under it", () => {
    const session = started();
    const first = session.eventsSince(0);
    session.call("list_alarms", {});
    const second = session.eventsSince(first.length);
    expect(second.some((e) => e.kind === "tool" && e.tool === "list_alarms")).toBe(true);
    expect(second.every((e) => e.seq >= first.length)).toBe(true);
    expect(session.eventsSince(0).slice(0, first.length)).toEqual(first);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
  });
});

describe("the wall clock is put on a finished run [REQ-083]", () => {
  const events: RunEvent[] = [
    {
      kind: "world",
      seq: 0,
      t: 5,
      cause: "scenario:x",
      command: { type: "outdoor.set", celsius: 30 },
    },
    {
      kind: "tool",
      seq: 1,
      t: 10,
      tool: "a",
      args: {},
      ok: true,
      effect: "observe",
      targets: [],
      summary: "",
    },
    {
      kind: "world",
      seq: 2,
      t: 12,
      cause: "physics",
      command: { type: "alarm.clear", alarmId: "x" },
    },
    {
      kind: "tool",
      seq: 3,
      t: 40,
      tool: "a",
      args: {},
      ok: true,
      effect: "observe",
      targets: [],
      summary: "",
    },
  ];

  test("a call gets the time of its own call; the rest the time of the last call before it", () => {
    const stamped = stampReal(
      events,
      [
        { t: 10, tool: "a", real: "2026-11-05T10:00:10.000Z" },
        { t: 40, tool: "a", real: "2026-11-05T10:00:40.000Z" },
      ],
      "2026-11-05T10:00:00.000Z",
    );
    expect(stamped.map((e) => e.real)).toEqual([
      "2026-11-05T10:00:00.000Z",
      "2026-11-05T10:00:10.000Z",
      "2026-11-05T10:00:10.000Z",
      "2026-11-05T10:00:40.000Z",
    ]);
    expect(events[0]?.real).toBeUndefined();
  });

  test("a call the host saw but the session refused (after the end) does not shift the others", () => {
    const stamped = stampReal(
      events,
      [
        { t: 10, tool: "a", real: "r1" },
        { t: 10, tool: "late", real: "r-late" },
        { t: 40, tool: "a", real: "r2" },
      ],
      undefined,
    );
    expect(stamped.map((e) => e.real)).toEqual([undefined, "r1", "r1", "r2"]);
  });
});
