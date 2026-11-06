import { describe, expect, test } from "vitest";
import { SqliteStore } from "./sqlite-store";

describe("hearts, marks and awards on SQLite [REQ-101]", () => {
  test("[REQ-101] a heart is one per person per world and survives asking twice", async () => {
    const store = new SqliteStore(":memory:");
    await store.putLike({ worldId: "w", user: "연수", at: "2026-11-01T00:00:00.000Z" });
    await store.putLike({ worldId: "w", user: "연수", at: "2026-11-02T00:00:00.000Z" });
    await store.putLike({ worldId: "w", user: "지민", at: "2026-11-03T00:00:00.000Z" });
    expect(await store.listLikes()).toEqual([
      { worldId: "w", user: "연수", at: "2026-11-01T00:00:00.000Z" },
      { worldId: "w", user: "지민", at: "2026-11-03T00:00:00.000Z" },
    ]);
    expect(await store.deleteLike("w", "연수")).toBe(true);
    expect(await store.deleteLike("w", "연수")).toBe(false);
    expect(await store.listLikes()).toHaveLength(1);
  });

  test("[REQ-101] awards keep the first time; marks keep the latest per scenario version", async () => {
    const store = new SqliteStore(":memory:");
    await store.putTitleAwards([
      { user: "연수", key: "runs-100", earnedAt: "2026-11-01T00:00:00.000Z" },
    ]);
    await store.putTitleAwards([
      { user: "연수", key: "runs-100", earnedAt: "2026-11-05T00:00:00.000Z" },
    ]);
    expect(await store.listTitleAwards()).toEqual([
      { user: "연수", key: "runs-100", earnedAt: "2026-11-01T00:00:00.000Z" },
    ]);
    await store.putCalibrationMark({
      scenarioId: "s",
      digest: "d",
      at: "2026-11-01T00:00:00.000Z",
      clean: false,
    });
    await store.putCalibrationMark({
      scenarioId: "s",
      digest: "d",
      at: "2026-11-02T00:00:00.000Z",
      clean: true,
    });
    expect(await store.listCalibrationMarks()).toEqual([
      { scenarioId: "s", digest: "d", at: "2026-11-02T00:00:00.000Z", clean: true },
    ]);
  });
});
