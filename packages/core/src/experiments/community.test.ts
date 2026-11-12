import { describe, expect, it } from "vitest";
import {
  type Competition,
  MemoryCompetitions,
  MemoryStore,
  medalCountsOf,
  type PopularWorld,
  resultsOf,
  sortWorlds,
  tierOfUser,
  worldStats,
} from "./index";

const NOW = "2026-11-06T12:00:00.000Z";
const day = (n: number) => new Date(Date.parse(NOW) - n * 86_400_000).toISOString();

const world = (id: string, owner: string, created: number, startedFrom?: string): PopularWorld => ({
  id,
  owner,
  createdAt: day(created),
  updatedAt: day(created),
  ...(startedFrom ? { startedFrom } : {}),
});

describe("world popularity [REQ-101]", () => {
  const worlds = [world("a", "하늘", 50), world("b", "지민", 40), world("c", "지민", 30)];

  it("[REQ-101] score = experiments in 30 days + hearts + worlds others started from it", () => {
    const stats = worldStats({
      worlds: [...worlds, world("d", "민호", 2, "a"), world("e", "하늘", 1, "a")],
      experiments: [
        { worldId: "a", createdAt: day(1) },
        { worldId: "a", createdAt: day(29) },
        { worldId: "a", createdAt: day(31) },
      ],
      likes: [{ worldId: "a", user: "x", at: day(100) }],
      now: NOW,
    });
    // the world 하늘 started from her own world does not count; 민호's does
    expect(stats.get("a")).toEqual({
      experiments30d: 2,
      experiments: 3,
      likes: 1,
      startedByOthers: 1,
      score: 4,
      week: 2,
    });
  });

  it("[REQ-101] week counts what happened in the last 7 days: experiments, hearts, starts", () => {
    const stats = worldStats({
      worlds: [...worlds, world("d", "민호", 3, "b")],
      experiments: [
        { worldId: "b", createdAt: day(6) },
        { worldId: "b", createdAt: day(8) },
      ],
      likes: [{ worldId: "b", user: "x", at: day(1) }],
      now: NOW,
    });
    expect(stats.get("b")?.week).toBe(3);
  });

  it("[REQ-101] a started-from that points nowhere counts for nothing", () => {
    const stats = worldStats({
      worlds: [world("a", "하늘", 5, "gone")],
      experiments: [],
      likes: [],
      now: NOW,
    });
    expect(stats.get("a")?.score).toBe(0);
  });

  it("[REQ-101] sorts by score and breaks ties by the newer world, then id", () => {
    const list = [world("a", "하늘", 50), world("b", "하늘", 10), world("c", "하늘", 10)];
    const stats = worldStats({
      worlds: list,
      experiments: [{ worldId: "a", createdAt: day(1) }],
      likes: [],
      now: NOW,
    });
    expect(sortWorlds(list, stats, "popular", "하늘").map((w) => w.id)).toEqual(["a", "b", "c"]);
    expect(sortWorlds([...list].reverse(), stats, "popular", "하늘").map((w) => w.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("[REQ-101] 새로 생김 is newest first; 내 세계 keeps only mine, last edited first", () => {
    const list = [
      { ...world("a", "하늘", 50), updatedAt: day(1) },
      { ...world("b", "지민", 10) },
      { ...world("c", "하늘", 20), updatedAt: day(9) },
    ];
    const stats = worldStats({ worlds: list, experiments: [], likes: [], now: NOW });
    expect(sortWorlds(list, stats, "new", "하늘").map((w) => w.id)).toEqual(["b", "c", "a"]);
    expect(sortWorlds(list, stats, "mine", "하늘").map((w) => w.id)).toEqual(["a", "c"]);
  });
});

describe("competitions [REQ-101]", () => {
  const entries = (scores: Record<string, number>) =>
    Object.entries(scores).map(([user, score]) => ({
      user,
      agentKey: `${user}/agent`,
      score,
      submittedAt: day(1),
    }));

  const comp = (id: string, scores: Record<string, number>): Competition => ({
    id,
    name: id,
    entries: entries(scores),
  });

  it("[REQ-101] a person is ranked once, on their best agent", () => {
    const c: Competition = {
      id: "c1",
      name: "c1",
      entries: [...entries({ 하늘: 40, 지민: 60 }), ...entries({ 하늘: 90 })],
    };
    const r = resultsOf(c);
    expect(r.get("하늘")).toMatchObject({ rank: 1, participants: 2, medal: "gold" });
    expect(r.get("지민")?.rank).toBe(2);
  });

  it("[REQ-101] medals add up across competitions and give a tier", async () => {
    const port = new MemoryCompetitions();
    for (const id of ["a", "b"]) await port.put(comp(id, { 하늘: 90, 지민: 50, 민호: 10 }));
    const all = await port.list();
    expect(medalCountsOf("하늘", all)).toEqual({ gold: 2, silver: 0, bronze: 0 });
    expect(tierOfUser("하늘", all)).toBe("expert");
    expect(tierOfUser("아무개", all)).toBe("sprout");
    expect((await port.get("a"))?.entries).toHaveLength(3);
    expect(await port.get("none")).toBeUndefined();
  });
});

describe("hearts, marks and awards in the memory store [REQ-101]", () => {
  it("[REQ-101] one heart per person per world; taking it back removes it", async () => {
    const store = new MemoryStore();
    await store.putLike({ worldId: "a", user: "하늘", at: day(2) });
    await store.putLike({ worldId: "a", user: "하늘", at: day(1) });
    await store.putLike({ worldId: "a", user: "지민", at: day(1) });
    expect((await store.listLikes()).map((l) => l.user).sort()).toEqual(["지민", "하늘"]);
    expect((await store.listLikes()).find((l) => l.user === "하늘")?.at).toBe(day(2));
    expect(await store.deleteLike("a", "하늘")).toBe(true);
    expect(await store.deleteLike("a", "하늘")).toBe(false);
  });

  it("[REQ-101] awards are kept as first written", async () => {
    const store = new MemoryStore();
    await store.putTitleAwards([{ user: "하늘", key: "first-world", earnedAt: day(5) }]);
    await store.putTitleAwards([{ user: "하늘", key: "first-world", earnedAt: day(1) }]);
    expect(await store.listTitleAwards()).toEqual([
      { user: "하늘", key: "first-world", earnedAt: day(5) },
    ]);
    await store.putCalibrationMark({ scenarioId: "s", digest: "d", at: day(1), clean: true });
    expect(await store.listCalibrationMarks()).toHaveLength(1);
  });
});
