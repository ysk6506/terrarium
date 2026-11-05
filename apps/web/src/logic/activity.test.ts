import type { ActivityEvent, ActivityWho } from "@terrarium/core/contract";
import { describe, expect, test } from "vitest";
import {
  type ActivityState,
  applyActivity,
  doingOf,
  IDLE_MS,
  isIdle,
  MAX_WORKERS,
  nameOf,
  noActivity,
  parseActivity,
  TRAIL_LENGTH,
  WORKER_HUES,
} from "./activity";

const who = (n: number): ActivityWho => ({
  experimentId: `e-${n}`,
  experiment: `실험 ${n}`,
  owner: "연수",
  harness: "하네스",
  agent: `에이전트 ${n}`,
  model: "gpt-사내",
});

const start = (n: number): ActivityEvent => ({ type: "start", runId: `r-${n}`, who: who(n) });
const call = (
  n: number,
  tool: string,
  targets: string[],
  effect: "observe" | "act" | "wait" | "answer" = "observe",
  ok = true,
): ActivityEvent => ({ type: "call", runId: `r-${n}`, t: 1, tool, ok, effect, targets });

const play = (
  events: ActivityEvent[],
  from: ActivityState = noActivity,
  at = 1000,
): ActivityState => events.reduce((s, e, i) => applyActivity(s, e, at + i * 100), from);

describe("who is working in a world, folded from the activity events [REQ-050]", () => {
  test("a run appears when it starts and goes when it ends; runs do not mix", () => {
    const two = play([
      start(1),
      start(2),
      call(1, "get_entity", ["a"]),
      call(2, "list_alarms", []),
    ]);
    expect(two.workers.map((w) => [w.runId, w.calls, w.at])).toEqual([
      ["r-1", 1, "a"],
      ["r-2", 1, undefined],
    ]);
    expect(play([{ type: "end", runId: "r-1" }], two).workers.map((w) => w.runId)).toEqual(["r-2"]);
  });

  test("the equipment named last is where the run is, and the places before it make its trail", () => {
    const s = play([
      start(1),
      call(1, "get_entity", ["a"]),
      call(1, "get_entity", ["a"]),
      call(1, "get_topology", ["b"]),
      call(1, "list_alarms", []),
      call(1, "power_server", ["c"], "act"),
    ]);
    const w = s.workers[0];
    expect(w?.at).toBe("c");
    expect(w?.trail).toEqual(["a", "b"]);
    expect(w?.calls).toBe(5);
    expect(w?.last).toMatchObject({ tool: "power_server", effect: "act" });
  });

  test("the trail keeps only the last few places", () => {
    const ids = Array.from({ length: TRAIL_LENGTH + 4 }, (_, i) => `e${i}`);
    const s = play([start(1), ...ids.map((id) => call(1, "get_entity", [id]))]);
    expect(s.workers[0]?.trail).toEqual(ids.slice(-TRAIL_LENGTH - 1, -1));
  });

  test("runs wear different colours while there are colours to spare, and a colour freed is worn again", () => {
    const many = play(Array.from({ length: WORKER_HUES }, (_, i) => start(i)));
    expect(new Set(many.workers.map((w) => w.hue)).size).toBe(WORKER_HUES);
    const freed = play([{ type: "end", runId: "r-3" }], many);
    expect(play([start(99)], freed).workers.at(-1)?.hue).toBe(3);
    const over = play([start(100)], many);
    expect(over.workers.at(-1)?.hue).toBeLessThan(WORKER_HUES);
  });

  test("a start seen again (the server tells late viewers) renames the run and keeps what it did", () => {
    const s = play([start(1), call(1, "get_entity", ["a"])]);
    const again = applyActivity(
      s,
      { type: "start", runId: "r-1", who: { ...who(1), agent: "새 이름" } },
      5000,
    );
    expect(again.workers).toHaveLength(1);
    expect(again.workers[0]).toMatchObject({ calls: 1, at: "a", who: { agent: "새 이름" } });
  });

  test("a call from a run that never started is ignored, and the picture holds at most MAX_WORKERS runs", () => {
    expect(play([call(7, "get_entity", ["a"])]).workers).toEqual([]);
    const flood = play(Array.from({ length: MAX_WORKERS + 5 }, (_, i) => start(i)));
    expect(flood.workers).toHaveLength(MAX_WORKERS);
    expect(flood.workers.at(-1)?.runId).toBe(`r-${MAX_WORKERS + 4}`);
  });

  test("what a run is doing is said in words; a failed call says so; quiet runs are told apart", () => {
    const s = play([
      start(1),
      call(1, "get_entity", ["a"]),
      call(1, "power_server", ["a"], "act", false),
    ]);
    const w = s.workers[0];
    if (!w) throw new Error("no worker");
    expect(doingOf(w)).toBe("서버 전원 제어 · 실패했어요");
    expect(doingOf({ ...w, last: { tool: "get_entity", effect: "observe", ok: true, t: 1 } })).toBe(
      "장비 상세 · 살펴보는 중",
    );
    expect(doingOf({ ...w, last: undefined })).toBe("시작했어요");
    expect(isIdle(w, w.lastAt + IDLE_MS - 1)).toBe(false);
    expect(isIdle(w, w.lastAt + IDLE_MS + 1)).toBe(true);
    expect(nameOf(who(1))).toEqual({
      title: "에이전트 1 · gpt-사내",
      detail: "하네스 · 실험 1",
    });
    expect(nameOf({ ...who(1), model: undefined }).title).toBe("에이전트 1");
  });

  test("an event that is not one is not taken", () => {
    expect(parseActivity("{")).toBeUndefined();
    expect(parseActivity('{"type":"run"}')).toBeUndefined();
    expect(parseActivity("null")).toBeUndefined();
    expect(parseActivity(JSON.stringify(start(1)))).toMatchObject({ type: "start" });
  });
});
