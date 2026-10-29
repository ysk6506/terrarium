import { describe, expect, test } from "vitest";
import {
  CreateShareBody,
  DryRunBody,
  LeaderboardQuery,
  parseWith,
  TwinQuery,
  UpdateScenarioBody,
} from ".";

const messages = (r: ReturnType<typeof parseWith>) =>
  r.ok ? [] : r.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message));

describe("saving scenarios and the smaller requests [REQ-034] [REQ-038] [REQ-039]", () => {
  test("a scenario save needs its starting version and something to change", () => {
    expect(parseWith(UpdateScenarioBody, { baseDigest: "d1", name: "냉방 고장 2" }).ok).toBe(true);
    expect(messages(parseWith(UpdateScenarioBody, { baseDigest: "d1" }))).toEqual([
      "바꿀 이름이나 시나리오가 없다",
    ]);
  });

  test("a dry run defaults to seed 1; leaderboards and twin exports take optional filters", () => {
    expect(parseWith(DryRunBody, {})).toEqual({ ok: true, value: { seed: 1 } });
    expect(parseWith(LeaderboardQuery, { minRuns: "5", worldId: "" })).toEqual({
      ok: true,
      value: { minRuns: 5 },
    });
    expect(messages(parseWith(LeaderboardQuery, { minRuns: "0" }))).toEqual([
      "minRuns: 1 이상이어야 한다",
    ]);
    expect(parseWith(TwinQuery, { agentId: "deep" })).toEqual({
      ok: true,
      value: { agentId: "deep" },
    });
    expect(messages(parseWith(CreateShareBody, { expiresInDays: 400 }))).toEqual([
      "expiresInDays: 365 이하여야 한다",
    ]);
  });
});
