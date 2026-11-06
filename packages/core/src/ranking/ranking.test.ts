import { describe, expect, it } from "vitest";
import {
  awardMedals,
  countMedals,
  higherTier,
  medalCutoffs,
  medalFor,
  NO_MEDALS,
  TIER_LABELS,
  tierOf,
} from "./index";

describe("medals [REQ-101]", () => {
  it("[REQ-101] up to 99 people the cuts are the top 10%, 25% and 50%", () => {
    expect(medalCutoffs(40)).toEqual({ gold: 4, silver: 10, bronze: 20 });
    expect(medalCutoffs(99)).toEqual({ gold: 9, silver: 24, bronze: 49 });
  });

  it("[REQ-101] from 100 people the cuts are the top 5%, 15% and 40%, with no float error", () => {
    expect(medalCutoffs(100)).toEqual({ gold: 5, silver: 15, bronze: 40 });
    expect(medalCutoffs(200)).toEqual({ gold: 10, silver: 30, bronze: 80 });
    expect(medalCutoffs(1000)).toEqual({ gold: 50, silver: 150, bronze: 400 });
  });

  it("[REQ-101] every competition has at least one gold, even a tiny one", () => {
    for (const n of [1, 2, 5, 9]) expect(medalFor(1, n)).toBe("gold");
    expect(medalCutoffs(9).gold).toBe(1);
    expect(medalCutoffs(0)).toEqual({ gold: 0, silver: 0, bronze: 0 });
  });

  it("[REQ-101] a rank gets the best medal whose cut it is inside", () => {
    // 10 people: gold 1, silver 2, bronze 5
    expect(medalFor(1, 10)).toBe("gold");
    expect(medalFor(2, 10)).toBe("silver");
    expect(medalFor(3, 10)).toBe("bronze");
    expect(medalFor(5, 10)).toBe("bronze");
    expect(medalFor(6, 10)).toBeUndefined();
  });

  it("[REQ-101] a rank outside the field gets nothing", () => {
    expect(medalFor(0, 10)).toBeUndefined();
    expect(medalFor(11, 10)).toBeUndefined();
    expect(medalFor(1.5, 10)).toBeUndefined();
  });

  it("[REQ-101] ranks people by score and ties share the better rank", () => {
    const placed = awardMedals([
      { key: "a", score: 50 },
      { key: "b", score: 90 },
      { key: "c", score: 90 },
      { key: "d", score: 10 },
    ]);
    expect(placed.map((p) => [p.key, p.rank])).toEqual([
      ["b", 1],
      ["c", 1],
      ["a", 3],
      ["d", 4],
    ]);
    expect(placed[0]?.medal).toBe("gold");
    expect(placed[1]?.medal).toBe("gold");
  });

  it("[REQ-101] counts medals and ignores the empty ones", () => {
    expect(countMedals(["gold", undefined, "bronze", "gold"])).toEqual({
      gold: 2,
      silver: 0,
      bronze: 1,
    });
  });
});

describe("tiers [REQ-101]", () => {
  const t = (gold: number, silver: number, bronze: number) => tierOf({ gold, silver, bronze });

  it("[REQ-101] nobody starts above 새싹", () => {
    expect(tierOf(NO_MEDALS)).toBe("sprout");
    expect(TIER_LABELS[tierOf(NO_MEDALS)]).toBe("새싹");
  });

  it("[REQ-101] one medal of any kind makes a 참가자 (a lone bronze)", () => {
    expect(t(0, 0, 1)).toBe("participant");
  });

  it("[REQ-101] 전문가 is two bronze or one silver", () => {
    expect(t(0, 0, 2)).toBe("expert");
    expect(t(0, 1, 0)).toBe("expert");
  });

  it("[REQ-101] a gold also counts as a silver and a bronze", () => {
    expect(t(1, 0, 0)).toBe("expert");
  });

  it("[REQ-101] 마스터 is a gold and two more silvers or better", () => {
    expect(t(1, 2, 0)).toBe("master");
    expect(t(1, 1, 0)).toBe("expert");
    expect(t(3, 0, 0)).toBe("master");
    expect(t(2, 0, 9)).toBe("expert");
  });

  it("[REQ-101] 그랜드마스터 is five golds", () => {
    expect(t(5, 0, 0)).toBe("grandmaster");
    expect(t(4, 9, 9)).toBe("master");
  });

  it("[REQ-101] tiers order from low to high", () => {
    expect(higherTier("master", "expert")).toBe(true);
    expect(higherTier("sprout", "participant")).toBe(false);
  });
});
