import { describe, expect, test } from "vitest";
import { outsideFigures, outsideLine } from "./shell-outside";

describe("흉내 밖 명령 in the words of a result [REQ-098]", () => {
  test("the line names the count and the most frequent items", () => {
    expect(
      outsideLine({
        commands: 9,
        count: 4,
        items: [
          { what: "kubectl", n: 2 },
          { what: "tail -f", n: 1 },
          { what: "셸 문법 $", n: 1 },
        ],
      }),
    ).toBe("흉내 밖 명령 4번 (kubectl 2번, tail -f, 셸 문법 $)");
  });

  test("a long list is cut with 외 N가지, none says 0번, and a run without the shell says nothing", () => {
    const items = ["a", "b", "c", "d", "e", "f"].map((what) => ({ what, n: 1 }));
    expect(outsideLine({ commands: 6, count: 6, items })).toBe(
      "흉내 밖 명령 6번 (a, b, c, d 외 2가지)",
    );
    expect(outsideLine({ commands: 3, count: 0, items: [] })).toBe("흉내 밖 명령 0번");
    expect(outsideLine(undefined)).toBeUndefined();
    expect(outsideFigures(undefined)).toEqual([]);
  });

  test("the figure says it is not in the score", () => {
    const [fig] = outsideFigures({ commands: 5, count: 2, items: [{ what: "vim", n: 2 }] });
    expect(fig).toMatchObject({ label: "흉내 밖 명령", value: "2번" });
    expect(fig?.hint).toContain("점수에는 섞이지 않아요");
  });
});
