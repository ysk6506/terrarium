/**
 * The heads of the board's columns do not run into each other (REQ-100): with the application layer the network board can
 * have twenty columns, and the head of one used to be printed over the next. This reads the geometry only (boxes from the
 * layout's own text widths), so it needs no browser. The picture is 1,100 units wide and is scaled to its container, so the
 * boxes of a 1,200 px container are the same boxes, 9% larger.
 */
import { type Board, NETWORK_STAGES, stageHead } from "@terrarium/core/topology";
import { describe, expect, test } from "vitest";
import { BOARD_W, fitHead, headWidth, layout } from ".";

const WIDTH_PX = 1200;

function boardOf(stages: number): Board {
  return {
    layer: "network",
    stages: NETWORK_STAGES.slice(0, stages),
    tiles: [],
    edges: [],
    path: [],
    stats: { tiles: 0, entities: 0, folded: 0 },
  };
}

/** The box a head takes, in pixels of a container 1,200 px wide: from its left edge to its right. */
function boxes(stages: number) {
  const scale = WIDTH_PX / BOARD_W;
  return layout(boardOf(stages)).columns.map((c) => {
    const w = Math.max(...c.lines.map((l) => headWidth(l, c.size))) * scale;
    return {
      label: c.label,
      left: c.x * scale - w / 2,
      right: c.x * scale + w / 2,
      lines: c.lines,
    };
  });
}

describe("the column heads of the board do not overlap [REQ-100]", () => {
  for (let n = 2; n <= NETWORK_STAGES.length; n++) {
    test(`${n} columns: no two head boxes meet, and all are inside the picture`, () => {
      const list = boxes(n);
      list.forEach((b, i) => {
        expect(b.left, b.label).toBeGreaterThanOrEqual(0);
        expect(b.right, b.label).toBeLessThanOrEqual(WIDTH_PX);
        const next = list[i + 1];
        if (next) expect(b.right, `${b.label} / ${next.label}`).toBeLessThan(next.left);
      });
    });
  }

  test("a head that is wider than its room is broken into lines or drawn smaller, never cut off", () => {
    const list = layout(boardOf(NETWORK_STAGES.length)).columns;
    for (const c of list) {
      expect(c.lines.join("").replace(/ /g, "")).toBe(
        stageHead(NETWORK_STAGES.find((s) => s.label === c.label) as never).replace(/ /g, ""),
      );
      expect(c.size).toBeGreaterThanOrEqual(9);
      expect(c.lines.length).toBeLessThanOrEqual(3);
    }
  });

  test("the short heads of the network board are five characters or fewer", () => {
    expect(NETWORK_STAGES.map(stageHead).filter((h) => [...h].length > 5)).toEqual([]);
  });

  test("a head that fits is left alone, and a long one gets lines", () => {
    expect(fitHead("서버", 60)).toEqual({ lines: ["서버"], size: 12 });
    const wide = fitHead("쿠버네티스 클러스터", 40);
    expect(wide.lines.length).toBeGreaterThan(1);
    expect(wide.lines.every((l) => headWidth(l, wide.size) <= 40)).toBe(true);
  });
});
