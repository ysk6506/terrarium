import { describe, expect, test } from "vitest";
import { type ActivityState, IDLE_MS, type Worker } from "../activity";
import { freshness, markersOf } from "./markers";
import type { Spot } from "./spot";

const spots: Record<string, Spot> = {
  a: { x: 10, y: 1, z: 10 },
  b: { x: 40, y: 1, z: 10 },
  c: { x: 10.2, y: 1, z: 10.1 },
};
const resolve = (id: string) => spots[id];

const worker = (runId: string, extra: Partial<Worker> = {}): Worker => ({
  runId,
  who: {
    experimentId: "e",
    experiment: "실험",
    owner: "연수",
    harness: "하네스",
    agent: "에이전트",
  },
  hue: 0,
  calls: 1,
  trail: [],
  startedAt: 0,
  lastAt: 1000,
  ...extra,
});

describe("what the 3D view draws for the runs at work [REQ-050]", () => {
  test("a run that named equipment with a place gets a marker there, with the places before it as a line", () => {
    const state: ActivityState = {
      workers: [
        worker("r-1", {
          at: "a",
          trail: ["b", "nowhere"],
          last: { tool: "power_server", effect: "act", ok: true, t: 3 },
        }),
      ],
    };
    const [m] = markersOf(state, resolve);
    expect(m).toMatchObject({ runId: "r-1", target: "a", effect: "act", ok: true, lastAt: 1000 });
    expect(m?.at).toEqual(spots.a);
    expect(m?.trail).toEqual([spots.b]);
  });

  test("a run that has named nothing, or only things with no place, has no marker", () => {
    const state: ActivityState = {
      workers: [worker("r-1"), worker("r-2", { at: "nowhere" })],
    };
    expect(markersOf(state, resolve)).toEqual([]);
  });

  test("a marker fades as the run stays quiet, down to nothing", () => {
    expect(freshness(1000, 1000)).toBe(1);
    expect(freshness(1000, 1000 + IDLE_MS / 2)).toBeCloseTo(0.5);
    expect(freshness(1000, 1000 + IDLE_MS * 3)).toBe(0);
    expect(freshness(1000, 500)).toBe(1);
  });

  test("runs at the same place are stacked in the order they come, and a run elsewhere stands alone", () => {
    const state: ActivityState = {
      workers: [
        worker("r-1", { at: "a" }),
        worker("r-2", { at: "c" }),
        worker("r-3", { at: "b" }),
        worker("r-4", { at: "a" }),
      ],
    };
    expect(markersOf(state, resolve).map((m) => [m.runId, m.pile])).toEqual([
      ["r-1", 0],
      ["r-2", 1],
      ["r-3", 0],
      ["r-4", 2],
    ]);
  });
});
