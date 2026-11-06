import type { Mark } from "@terrarium/core/topology";
import type { ToolEvent } from "@terrarium/core/world";
import { describe, expect, test } from "vitest";
import {
  advance,
  bubbleOf,
  keyedT,
  nearestFrame,
  pct,
  ratioOf,
  relative,
  ticks,
  valueText,
  whoText,
} from "./replay";

describe("the time bar moves by the clock, the keys and the pointer [REQ-078]", () => {
  test("a screen reader hears where the bar is and how long the run is", () => {
    expect(valueText(260, 570)).toBe("4분 20초 / 9분 30초");
  });

  test("arrows move five seconds, Home and End go to the ends, nothing goes past them", () => {
    expect(keyedT("ArrowRight", 100, 570)).toBe(105);
    expect(keyedT("ArrowLeft", 100, 570)).toBe(95);
    expect(keyedT("ArrowLeft", 3, 570)).toBe(0);
    expect(keyedT("ArrowRight", 568, 570)).toBe(570);
    expect(keyedT("Home", 100, 570)).toBe(0);
    expect(keyedT("End", 100, 570)).toBe(570);
    expect(keyedT("ArrowRight", 100, 570, 30)).toBe(130);
    expect(keyedT("a", 100, 570)).toBeUndefined();
  });

  test("the pointer maps to the line, and the clock runs ten world seconds to a real one", () => {
    expect(ratioOf(150, 100, 200)).toBe(0.25);
    expect(ratioOf(50, 100, 200)).toBe(0);
    expect(ratioOf(900, 100, 200)).toBe(1);
    expect(advance(0, 1000, 10, 570)).toEqual({ t: 10, done: false });
    expect(advance(565, 1000, 10, 570)).toEqual({ t: 570, done: true });
    expect(pct(285, 570)).toBe(50);
  });

  test("labels of marks that sit close together go on different rows", () => {
    const mark = (kind: Mark["kind"], t: number): Mark => ({ kind, t, at: [t] });
    const rows = ticks(
      [
        mark("fault", 46),
        mark("alarm", 80),
        mark("read", 171),
        mark("act", 252),
        mark("recover", 410),
      ],
      570,
    ).map((x) => x.row);
    expect(rows).toEqual([0, 1, 0, 0, 0]);
  });

  test("the builder's run snaps to its nearest frame", () => {
    const frames = [{ t: 0 }, { t: 30 }, { t: 60 }];
    expect(nearestFrame(frames, 41)).toBe(1);
    expect(nearestFrame(frames, 50)).toBe(2);
    expect(nearestFrame(frames, 999)).toBe(2);
  });

  test("marks are counted from the start of the run", () => {
    const [m] = relative([{ kind: "fault", t: 946, at: [946, 1000] }], 900);
    expect(m).toEqual({ kind: "fault", t: 46, at: [46, 100] });
  });
});

describe("the speech bubble says who, what and when [REQ-078]", () => {
  const call: ToolEvent = {
    kind: "tool",
    seq: 3,
    t: 1152,
    tool: "set_cooling_setpoint",
    args: { unitId: "crah-2", celsius: 18 },
    ok: true,
    effect: "act",
    targets: ["crah-2"],
    summary: "",
  };

  test("a change is a write, a look is a read, and the call is spelled as the agent made it", () => {
    const who = { harness: "OpenCode", agent: "a1", model: "claude-sonnet" };
    expect(whoText(who)).toBe("OpenCode · claude-sonnet");
    expect(whoText({ harness: "OpenCode", agent: "a1" })).toBe("OpenCode · a1");
    const b = bubbleOf(call, who, 900, (id) => (id === "crah-2" ? "CRAH-1F-A-2" : id));
    expect(b).toMatchObject({
      who: "OpenCode · claude-sonnet",
      call: "set_cooling_setpoint(CRAH-1F-A-2, 18°C)",
      when: "4분 12초 · 응답 기다리는 중",
      effect: "write",
      failed: false,
    });
    expect(bubbleOf({ ...call, effect: "observe" }, who, 900, (id) => id)?.effect).toBe("read");
    expect(bubbleOf(undefined, who, 900, (id) => id)).toBeUndefined();
  });
});
