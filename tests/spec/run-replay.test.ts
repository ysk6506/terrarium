import { Catalog } from "@terrarium/core/catalog";
import { SCENARIO_TEMPLATES } from "@terrarium/core/scenario";
import { Session } from "@terrarium/core/session";
import { DEFAULT_TOOLSET } from "@terrarium/core/tools";
import {
  callLabel,
  callWhen,
  clockText,
  impactOf,
  markers,
  replaySource,
  restingSource,
  stateAt,
  storyLine,
} from "@terrarium/core/topology";
import { BlueprintIndex, type RunEvent } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import { sampleBlueprint } from "../../packages/core/src/world/test-support/sample";

/** A real run of the cooling-failure template: two looks, one change, the diagnosis. */
function run(): { events: readonly RunEvent[]; origin: number } {
  const blueprint = sampleBlueprint();
  const scenario = SCENARIO_TEMPLATES.find((t) => t.id === "cooling-failure")?.build(
    new BlueprintIndex(blueprint),
    "sample",
  );
  if (!scenario) throw new Error("template");
  const session = Session.create({
    blueprint,
    scenario,
    tools: [...DEFAULT_TOOLSET, "set_cooling_setpoint"],
    seed: 7,
  });
  session.start();
  session.call("list_alarms", { severity: "critical" });
  session.call("get_impact", { id: "crah-1" });
  session.call("set_cooling_setpoint", { unitId: "crah-2", celsius: 18 });
  session.call("submit_diagnosis", {
    rootCause: "crah-1",
    faultType: "cooling_unit_failure",
    summary: "CRAH-1 정지",
  });
  const result = session.finish();
  return { events: result.events ?? [], origin: result.simTime.scenarioStart };
}

describe("a run's events can be replayed to any moment [REQ-078] [REQ-083]", () => {
  const { events, origin } = run();
  const catalog = new Catalog();
  const index = new BlueprintIndex(sampleBlueprint());

  test("before the fault the board is calm; after it the fault, the alarm and the range show", () => {
    const fault = events.find((e) => e.kind === "world" && e.command.type === "fault.add");
    expect(fault).toBeDefined();
    const t = (fault as RunEvent).t;
    const before = stateAt(events, t - 1);
    expect(before.faults).toHaveLength(0);
    expect(before.alarms).toHaveLength(0);
    const base = restingSource(index, catalog);
    expect(impactOf(replaySource(base, before)).servers).toBe(0);
    const during = stateAt(events, t + 600);
    expect(during.faults.map((f) => f.target)).toEqual(["crah-1"]);
    expect(during.alarms.length).toBeGreaterThan(0);
    expect(impactOf(replaySource(base, during)).servers).toBe(3);
  });

  test("what the agent touched stays until the next call that names equipment", () => {
    const calls = events.filter((e) => e.kind === "tool");
    const second = calls[1];
    const third = calls[2];
    if (second?.kind !== "tool" || third?.kind !== "tool") throw new Error("calls");
    const at = stateAt(events, second.t);
    expect(at.touched).toEqual(new Set(second.targets));
    expect(at.last?.seq).toBe(second.seq);
    expect(stateAt(events, third.t - 0.5).last?.seq).toBe(second.seq);
    expect(stateAt(events, third.t).touched).toEqual(new Set(third.targets));
    expect(stateAt(events, third.t).calls).toBeGreaterThanOrEqual(3);
  });

  test("the run closes at the end, and the same moment always gives the same board", () => {
    const last = events.at(-1) as RunEvent;
    expect(stateAt(events, last.t).closed).toBe(true);
    expect(stateAt(events, origin).closed).toBe(false);
    expect(JSON.stringify(stateAt(events, origin + 90).faults)).toBe(
      JSON.stringify(stateAt(events, origin + 90).faults),
    );
  });

  test("ten thousand events replay well inside 100 ms", () => {
    const many: RunEvent[] = [];
    for (let i = 0; i < 10_000; i++) {
      const id = `f${i % 40}`;
      many.push(
        i % 3 === 0
          ? {
              kind: "world",
              seq: i,
              t: i,
              cause: "scenario:x",
              command: {
                type: "fault.add",
                fault: { id, type: "cooling_unit_failure", target: "crah-1", params: {} },
              },
            }
          : i % 3 === 1
            ? {
                kind: "world",
                seq: i,
                t: i,
                cause: "physics",
                command: {
                  type: "alarm.raise",
                  alarm: {
                    id: `a${i % 90}`,
                    entityId: "rack-a",
                    code: "x",
                    severity: "warning",
                    message: "",
                    since: i,
                  },
                },
              }
            : {
                kind: "tool",
                seq: i,
                t: i,
                tool: "get_impact",
                args: { id: "rack-a" },
                ok: true,
                effect: "observe",
                targets: ["rack-a"],
                summary: "",
              },
      );
    }
    stateAt(many, 9_999);
    const started = performance.now();
    for (let k = 0; k < 10; k++) stateAt(many, 9_999 - k * 500);
    const each = (performance.now() - started) / 10;
    expect(each).toBeLessThan(100);
    expect(stateAt(many, 100).calls).toBeLessThan(stateAt(many, 9_999).calls);
  });
});

describe("the marks and the first line of a result [REQ-078] [REQ-083]", () => {
  const { events, origin } = run();

  test("the bar has a mark for each thing that happened, at its first time, in the fixed order", () => {
    const marks = markers(events);
    expect(marks.map((m) => m.kind)).toEqual(["fault", "alarm", "read", "act"]);
    const fault = marks.find((m) => m.kind === "fault");
    expect(fault?.t).toBe(
      events.find((e) => e.kind === "world" && e.command.type === "fault.add")?.t,
    );
    const read = marks.find((m) => m.kind === "read");
    expect(read?.at.length).toBeGreaterThan(1);
    expect(read?.t).toBe(Math.min(...(read?.at ?? [])));
  });

  test("the line reads fault, alarm, looked-at (with the answer), acted-on, servers, then time and calls", () => {
    const line = storyLine(events, { origin, servers: { before: 3, after: 0, at: origin + 120 } });
    const text = line.parts.map((p) => p.text);
    expect(text[0]).toBe("고장 1곳");
    expect(text[1]).toMatch(/^알람 \d+곳$/);
    expect(text[2]).toMatch(/^짚은 곳 \d+곳\(정답 포함\)$/);
    expect(text[3]).toBe("조치 1곳");
    expect(text[4]).toBe("영향 범위 서버 3 → 0");
    expect(line.tail).toMatch(/^\d+분 \d+초 · 툴 호출 4번$|^\d+초 · 툴 호출 4번$/);
    expect(line.parts.every((p) => p.t >= origin)).toBe(true);
    expect(line.parts[4]?.t).toBe(origin + 120);
  });

  test("a line for a run with no events is empty, and says the answer was missed when it was", () => {
    expect(storyLine([]).parts).toHaveLength(0);
    const missed = events.map((e) =>
      e.kind === "score" && e.what === "graded" ? { ...e, rootCause: ["somewhere-else"] } : e,
    );
    expect(storyLine(missed).parts[2]?.text).toContain("(정답은 못 짚었어요)");
  });
});

describe("the words of the bubble [REQ-078]", () => {
  test("a time is said in minutes and seconds", () => {
    expect(clockText(0)).toBe("0초");
    expect(clockText(46)).toBe("46초");
    expect(clockText(252)).toBe("4분 12초");
    expect(clockText(3720)).toBe("1시간 2분");
  });

  test("the call is written as the agent wrote it, with units, and told apart by what it does", () => {
    const call = {
      kind: "tool",
      seq: 1,
      t: 400,
      tool: "set_cooling_setpoint",
      args: { unitId: "crah-2", celsius: 18 },
      ok: true,
      effect: "act",
      targets: ["crah-2"],
      summary: "",
    } as const;
    expect(callLabel(call, (id) => id.toUpperCase())).toBe("set_cooling_setpoint(CRAH-2, 18°C)");
    expect(callWhen(call, 148)).toBe("4분 12초 · 응답 기다리는 중");
    expect(callWhen({ ...call, ok: false, effect: "observe" }, 148)).toBe("4분 12초 · 실패했어요");
  });
});
