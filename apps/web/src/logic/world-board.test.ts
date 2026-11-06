import type { WorldCardView } from "@terrarium/core/contract";
import { describe, expect, it } from "vitest";
import {
  boardEmpty,
  DEFAULT_WORLD_SORT,
  earnedDay,
  evidenceHint,
  evidenceLine,
  likeLabel,
  NO_TITLES,
  quietPopular,
  readWorldSort,
  SORT_NOTES,
  saveWorldSort,
  settledLike,
  titleHint,
  titleRow,
  toggledLike,
  WORLD_SORT_KEY,
  WORLD_SORT_OPTIONS,
} from "./index";

const card = (over: Partial<WorldCardView["stats"]> = {}, likes = 0, likedByMe = false) =>
  ({
    id: "w",
    name: "화성",
    likes,
    likedByMe,
    stats: {
      experiments30d: 0,
      experiments: 0,
      likes,
      startedByOthers: 0,
      score: 0,
      week: 0,
      ...over,
    },
  }) as unknown as WorldCardView;

class Mem {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

describe("world sorts [REQ-101]", () => {
  it("[REQ-101] there are exactly four, 인기 first", () => {
    expect(WORLD_SORT_OPTIONS.map((o) => o.label)).toEqual([
      "인기",
      "요즘 활발",
      "새로 생김",
      "내 세계",
    ]);
    expect(DEFAULT_WORLD_SORT).toBe("popular");
    for (const o of WORLD_SORT_OPTIONS) expect(SORT_NOTES[o.value]).toBeTruthy();
  });

  it("[REQ-101] the choice is remembered per browser and falls back to 인기", () => {
    const store = new Mem();
    expect(readWorldSort(store)).toBe("popular");
    saveWorldSort(store, "new");
    expect(readWorldSort(store)).toBe("new");
    store.setItem(WORLD_SORT_KEY, "best");
    expect(readWorldSort(store)).toBe("popular");
    expect(readWorldSort(undefined)).toBe("popular");
  });

  it("[REQ-101] a storage that throws does not break the screen", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readWorldSort(broken)).toBe("popular");
    expect(() => saveWorldSort(broken, "mine")).not.toThrow();
  });
});

describe("the evidence line [REQ-101]", () => {
  it("[REQ-101] says experiments, hearts and this week, with units", () => {
    expect(evidenceLine(card({ experiments30d: 128, week: 12 }, 24))).toBe(
      "실험 128번 · 좋아요 24 · 이번 주 +12",
    );
  });

  it("[REQ-101] leaves out a quiet week and says when others started from it", () => {
    expect(evidenceLine(card({ experiments30d: 1_280 }, 2))).toBe("실험 1,280번 · 좋아요 2");
    expect(evidenceLine(card({ experiments30d: 3, startedByOthers: 2 }, 0))).toBe(
      "실험 3번 · 좋아요 0 · 남이 시작 2번",
    );
  });

  it("[REQ-101] a world nobody touched says so instead of showing zeros", () => {
    expect(evidenceLine(card())).toBe("아직 실험이 없어요");
  });

  it("[REQ-101] the hover says the experiment number is the last 30 days", () => {
    expect(evidenceHint(card({ experiments30d: 5, experiments: 40 }))).toBe(
      "실험은 최근 30일(5번), 지금까지는 40번이에요",
    );
  });
});

describe("empty boards [REQ-101]", () => {
  it("[REQ-101] 인기 with nothing counted says it comes with experiments", () => {
    expect(quietPopular("popular", [card(), card()])).toBe(
      "아직 실험이 없어요 — 인기는 실험이 쌓이면 생겨요",
    );
    expect(quietPopular("popular", [card({ score: 1 })])).toBeUndefined();
    expect(quietPopular("new", [card()])).toBeUndefined();
    expect(quietPopular("active", [card()])).toContain("이번 주");
  });

  it("[REQ-101] no worlds is said per sort", () => {
    expect(boardEmpty("popular", 0)?.title).toBe("아직 세계가 없어요");
    expect(boardEmpty("mine", 0)?.title).toBe("아직 만든 세계가 없어요");
    expect(boardEmpty("mine", 2)).toBeUndefined();
  });
});

describe("the heart [REQ-101]", () => {
  it("[REQ-101] toggles at once and never goes below zero", () => {
    const on = toggledLike(card({}, 3));
    expect(on).toMatchObject({ likes: 4, likedByMe: true });
    expect(toggledLike(on)).toMatchObject({ likes: 3, likedByMe: false });
    expect(toggledLike({ ...card({}, 0), likedByMe: true })).toMatchObject({ likes: 0 });
  });

  it("[REQ-101] the server's answer settles the count and the score", () => {
    const guess = toggledLike(card({ score: 5 }, 3));
    const settled = settledLike(guess, { worldId: "w", likes: 6, likedByMe: true });
    expect(settled.likes).toBe(6);
    expect(settled.stats.score).toBe(5 + (6 - 4));
  });

  it("[REQ-101] the button says what pressing does", () => {
    expect(likeLabel(card({}, 2))).toBe("화성 좋아요 (지금 2)");
    expect(likeLabel(card({}, 2, true))).toBe("화성 좋아요 취소 (지금 2)");
  });
});

describe("title text [REQ-101]", () => {
  const t = (label: string, earnedAt = "2026-11-02T01:00:00.000Z") => ({
    key: label,
    label,
    means: "",
    earnedAt,
  });

  it("[REQ-101] the hover names the title and the day in Korea", () => {
    expect(titleHint(t("실험 100번"))).toBe("실험 100번 · 2026-11-02에 얻었어요");
    expect(earnedDay("2026-11-01T20:00:00.000Z")).toBe("2026-11-02");
  });

  it("[REQ-101] two sit by the name and the rest are counted for the popover", () => {
    const row = titleRow([t("a"), t("b"), t("c"), t("d")]);
    expect(row.shown.map((x) => x.label)).toEqual(["a", "b"]);
    expect(row.more).toBe(2);
    expect(titleRow([]).more).toBe(0);
    expect(NO_TITLES).toContain("아직 얻은 칭호가 없어요");
  });
});
