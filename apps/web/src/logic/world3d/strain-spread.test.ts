import { describe, expect, test } from "vitest";
import { keptAmong, shownAt } from "./strain";

/** Paths of a room as the layer numbers them: each path's puffs follow the last one's. */
function numbered(counts: readonly number[]): Array<{ first: number; count: number }> {
  let first = 0;
  return counts.map((count) => {
    const at = { first, count };
    first += count;
    return at;
  });
}

const totalAt = (paths: Array<{ first: number; count: number }>, level: number) =>
  paths.reduce((n, p) => n + keptAmong(p.first, p.count, level), 0);

describe("each level halves what the whole room shows, spread over its paths [REQ-036]", () => {
  test("600 puffs become 300, 150, 75, however they are split into paths", () => {
    for (const split of [[600], Array(200).fill(3), Array(150).fill(4), [1, 599], [7, 13, 580]]) {
      const paths = numbered(split);
      expect(
        [0, 1, 2, 3].map((l) => totalAt(paths, l)),
        split.length.toString(),
      ).toEqual([600, 300, 150, 75]);
    }
  });

  test("the total is the same as taking half of all of them, rounded up, and never none", () => {
    for (const total of [1, 2, 5, 33, 194, 599]) {
      const paths = numbered([total]);
      for (const level of [0, 1, 2, 3]) {
        expect(totalAt(paths, level)).toBe(shownAt(total, level));
        expect(totalAt(paths, level)).toBeGreaterThanOrEqual(1);
      }
    }
  });

  test("many short paths do not each keep one: the ones that stay are every eighth of all", () => {
    const paths = numbered(Array(194).fill(3));
    expect(totalAt(paths, 3)).toBe(73);
    expect(paths.filter((p) => keptAmong(p.first, p.count, 3) > 0).length).toBeLessThan(194);
  });

  test("a path with nothing, and a level below the first, keep what they have", () => {
    expect(keptAmong(10, 0, 3)).toBe(0);
    expect(keptAmong(10, -2, 3)).toBe(0);
    expect(keptAmong(10, 5, 0)).toBe(5);
    expect(keptAmong(10, 5, -1)).toBe(5);
  });
});
