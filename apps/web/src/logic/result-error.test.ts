import { describe, expect, test } from "vitest";
import { errorNote } from "./result-words";

const score = (n: number, ci95: number) => ({
  n,
  mean: 70,
  median: 70,
  stdev: 0,
  min: 70,
  max: 70,
  ci95,
});

describe("what the result page says when the error is unknown", () => {
  test("[REQ-118] with one situation the page says the error is not known yet", () => {
    expect(errorNote(score(1, 0))).toContain("오차는 아직 몰라요");
    expect(errorNote(score(5, 12))).toBeUndefined();
    expect(errorNote(undefined)).toBeUndefined();
  });

  test("[REQ-118] when every situation scored the same the page says there is no error", () => {
    expect(errorNote(score(5, 0))).toContain("오차가 없어요");
  });
});
