import { describe, expect, test } from "vitest";
import { legacyEvents } from ".";

const run = (
  over: Partial<Parameters<typeof legacyEvents>[0]> = {},
): Parameters<typeof legacyEvents>[0] => ({
  toolCalls: [
    { t: 100, tool: "list_alarms", args: {}, ok: true },
    { t: 160, tool: "get_alarm", args: { id: "a1" }, ok: false, error: "없어요" },
  ] as Parameters<typeof legacyEvents>[0]["toolCalls"],
  endReason: "diagnosed",
  diagnosis: { rootCause: "crah-1" },
  score: { total: 80, passed: true },
  simTime: { scenarioStart: 0, agentStart: 60, end: 400 },
  ...over,
});

describe("a run saved before the record existed is rebuilt as events [REQ-083]", () => {
  test("it starts with the agent, ends with the close and the grade, and numbers every event in order", () => {
    const events = legacyEvents(run());
    expect(events.map((e) => (e.kind === "score" ? `score:${e.what}` : e.kind))).toEqual([
      "score:agent_start",
      "tool",
      "tool",
      "score:closed",
      "score:graded",
    ]);
    expect(events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(events[0]).toMatchObject({ t: 60, scenarioStart: 0 });
    expect(events[3]).toMatchObject({ t: 400, reason: "diagnosed", diagnosed: true });
    expect(events[4]).toMatchObject({ total: 80, passed: true, rootCause: [] });
  });

  test("a failed call keeps its error as the summary and an ok one has none, and a run with no diagnosis says so", () => {
    const events = legacyEvents(run({ diagnosis: undefined, endReason: "time_limit" }));
    const [ok, failed] = events.filter((e) => e.kind === "tool");
    expect(ok).toMatchObject({ ok: true, summary: "", tool: "list_alarms", t: 100 });
    expect(failed).toMatchObject({ ok: false, summary: "없어요", error: "없어요" });
    expect(events[3]).toMatchObject({ reason: "time_limit", diagnosed: false });
  });

  test("a failed call with no error text still says that it failed, and a run with no calls has the three score events", () => {
    const bare = legacyEvents(
      run({
        toolCalls: [{ t: 1, tool: "x", args: {}, ok: false }] as Parameters<
          typeof legacyEvents
        >[0]["toolCalls"],
      }),
    );
    expect(bare[1]).toMatchObject({ summary: "실패했어요" });
    expect(bare[1]).not.toHaveProperty("error");
    expect(legacyEvents(run({ toolCalls: [] }))).toHaveLength(3);
  });
});
