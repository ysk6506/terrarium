import type { ExperimentSummary } from "@terrarium/core/contract";
import { describe, expect, test } from "vitest";
import { applyEvent, initialLive } from "./live";

const summary = (finished: number): ExperimentSummary =>
  ({ status: "running", progress: { total: 5, finished } }) as unknown as ExperimentSummary;

describe("an experiment that finished runs before the live stream opened [REQ-030]", () => {
  test("a summary further along than the page's own asks for the full view again", () => {
    const state = initialLive([], summary(0));
    expect(applyEvent(state, { type: "experiment", summary: summary(5) }).stale).toBe(true);
  });

  test("a summary that agrees with the page changes nothing to fetch", () => {
    const state = initialLive([], summary(2));
    expect(applyEvent(state, { type: "experiment", summary: summary(2) }).stale).toBe(false);
  });
});
