/**
 * "다음에 해 볼 것" (ADR-0171): at most three suggestions, each there only when its condition holds. Computed from the
 * numbers on the page, so none of them is a claim the page does not show.
 */
import type { Summary } from "@terrarium/core/analysis";
import { pointsText } from "./result-words";
import type { Page } from "./router";
import type { SeedRow } from "./seed-rows";

export interface Suggestion {
  readonly id: "more-situations" | "look-at-one" | "swap-agent";
  readonly title: string;
  readonly why: string;
  readonly to: Page;
}

export interface SuggestionInput {
  readonly experimentId: string;
  /** Situations the experiment was set up with. */
  readonly situations: number;
  readonly score?: Summary | undefined;
  readonly rows: readonly SeedRow[];
  /** An operation has no score, so nothing about one is said. */
  readonly operation?: boolean;
}

/** An interval this wide (half-width, in points) is too wide to tell two agents apart. */
export const WIDE_INTERVAL = 10;

/** Fewer situations than this and the interval is still wide for want of them. */
export const ENOUGH_SITUATIONS = 10;

function moreSituations(i: SuggestionInput): Suggestion | undefined {
  const s = i.score;
  if (!s || s.n < 2 || s.ci95 < WIDE_INTERVAL || i.situations >= ENOUGH_SITUATIONS)
    return undefined;
  return {
    id: "more-situations",
    title: `상황을 ${ENOUGH_SITUATIONS}개로 늘려 돌리기`,
    why: `오차 ±${pointsText(s.ci95)}점은 넓어요. 상황이 늘면 좁아져요.`,
    to: { name: "newExperiment", forkOf: i.experimentId, runs: ENOUGH_SITUATIONS },
  };
}

/** The first situation that was run at least twice and never passed, with its first run. */
function failedEveryTime(
  rows: readonly SeedRow[],
): { seed: number; runId: string; times: number } | undefined {
  for (const row of rows) {
    const done = row.dots.filter((d) => d.state === "pass" || d.state === "fail");
    const first = done[0];
    if (first && done.length >= 2 && done.every((d) => d.state === "fail"))
      return { seed: row.seed, runId: first.runId, times: done.length };
  }
  return undefined;
}

function lookAtOne(i: SuggestionInput): Suggestion | undefined {
  const hit = failedEveryTime(i.rows);
  if (!hit) return undefined;
  return {
    id: "look-at-one",
    title: `상황 ${hit.seed}만 들여다보기`,
    why: `${hit.times}번 모두 합격하지 못했어요.`,
    to: { name: "run", id: hit.runId },
  };
}

function swapAgent(i: SuggestionInput): Suggestion {
  return {
    id: "swap-agent",
    title: "에이전트만 바꿔 견주기",
    why: i.operation
      ? "같은 조건으로 돌려 나란히 봐요."
      : `같은 상황 ${i.situations}개로 돌려 나란히 봐요.`,
    to: { name: "newExperiment", forkOf: i.experimentId },
  };
}

/** Wide interval and few situations, a situation that failed every time, and swapping the agent: in that order. */
export function suggestions(i: SuggestionInput): Suggestion[] {
  const found = i.operation ? [] : [moreSituations(i), lookAtOne(i)];
  return [...found, swapAgent(i)].filter((s): s is Suggestion => s !== undefined);
}
