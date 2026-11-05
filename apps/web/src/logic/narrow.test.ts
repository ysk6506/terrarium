import { describe, expect, it } from "vitest";
import { NARROW_LIMIT, narrowNote, narrowOptions } from "./narrow";

const many = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    value: `s${i}`,
    label: `서버 ${i}`,
    group: i % 2 === 0 ? "17라인 3층 서버룸" : "V1 2층 서버룸",
  }));

describe("a long pick list shows the first few and a way to search [REQ-034]", () => {
  it("shows only the first few of a long list when nothing is typed", () => {
    const n = narrowOptions(many(5000), "");
    expect(n.shown).toHaveLength(NARROW_LIMIT);
    expect(n.matching).toBe(5000);
    expect(n.total).toBe(5000);
  });

  it("finds by any part of the name or of the group, every word, in any order", () => {
    const options = many(5000);
    expect(narrowOptions(options, "서버 4999").shown.map((o) => o.value)).toEqual(["s4999"]);
    const inV1With17 = options
      .filter((o) => o.group?.startsWith("V1") && o.label.includes("17"))
      .map((o) => o.value)
      .slice(0, NARROW_LIMIT);
    expect(narrowOptions(options, "v1 서버 17").shown.map((o) => o.value)).toEqual(inV1With17);
    expect(narrowOptions(options, "17라인").matching).toBe(2500);
    expect(narrowOptions(options, "   ").matching).toBe(5000);
  });

  it("keeps the chosen one in front even when the search or the cut hides it", () => {
    const options = many(5000);
    expect(narrowOptions(options, "", "s4000").shown[0]?.value).toBe("s4000");
    expect(narrowOptions(options, "서버 1", "s4000").shown[0]?.value).toBe("s4000");
    expect(narrowOptions(options, "", "s3").shown.filter((o) => o.value === "s3")).toHaveLength(1);
  });

  it("says nothing was found, rather than showing an empty list with no explanation", () => {
    const n = narrowOptions(many(300), "없는 이름");
    expect(n.shown).toHaveLength(0);
    expect(narrowNote(n, true)).toContain("찾는 이름이 없어요");
  });

  it("tells the person when the list is cut short, and what to do", () => {
    const options = many(5000);
    expect(narrowNote(narrowOptions(options, ""), false)).toBe(
      "5000개 가운데 100개만 보여요. 이름을 적어 찾아보세요.",
    );
    expect(narrowNote(narrowOptions(options, "서버"), true)).toContain("더 적어 좁혀 보세요");
    expect(narrowNote(narrowOptions(options, "서버 4999"), true)).toBe("1개를 찾았어요.");
    expect(narrowNote(narrowOptions(many(50), ""), false)).toBeUndefined();
  });
});
