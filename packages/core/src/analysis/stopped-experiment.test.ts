import { describe, expect, test } from "vitest";
import { analyzeExperiment, buildLeaderboards } from ".";
import { experimentOf, SCRIPTS } from "./test-support/runs";

const { good, partial, wrong } = SCRIPTS;

type Spec = Parameters<typeof experimentOf>[0];

/** Everything the statistics say about an experiment, which is all but its state word. */
function statistics(spec: Spec) {
  const { status: _word, ...rest } = analyzeExperiment(experimentOf(spec));
  return rest;
}

/** One finished experiment, and one a person stopped after three of its five runs ended. */
const FINISHED: Spec = { id: "fin", runs: [good, partial, wrong, good] };
const STOPPED: Spec = {
  id: "stp",
  agentId: "deep",
  runs: [good, partial, good, "cancel", "cancel"],
};

/** cyrb53: two 32-bit mixes joined into one 53-bit number; core has no node:crypto, and a stray change moves it. */
function fingerprint(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${text.length}:${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)}`;
}

function output(): string {
  const board = buildLeaderboards(
    [FINISHED, STOPPED].map((s) => analyzeExperiment(experimentOf(s))),
    2,
  );
  return JSON.stringify({ board, finished: statistics(FINISHED), stopped: statistics(STOPPED) });
}

/**
 * The length and fingerprint of `output()` taken on the code before a stopped experiment read as stopped (ADR-0163 item 4): the
 * leaderboard and every statistic of both experiments, byte for byte. Only the state word was left out.
 */
const BEFORE = "12517:18108e26a8601d";

describe("stopping an experiment moves only its state word [REQ-039] [REQ-118]", () => {
  test("the leaderboard and the statistics of a finished and a stopped experiment are as they were", () => {
    expect(fingerprint(output())).toBe(BEFORE);
  });

  test("the stopped experiment still counts its finished runs on the board", () => {
    const rows = buildLeaderboards(
      [FINISHED, STOPPED].map((s) => analyzeExperiment(experimentOf(s))),
      2,
    )[0]?.rows;
    expect(rows?.map((r) => [r.agentId, r.runs, r.seeds])).toEqual([
      ["deep", 3, 3],
      ["triage", 4, 4],
    ]);
  });
});
