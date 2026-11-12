/**
 * "실험장 한계" (ADR-0184): a call that hit something the real tool does and the proving ground does not. It is not
 * the agent's mistake, so the step list tags it and the run header counts it. Pure text from the result.
 */

/** What the step tag says when pointed at. */
export const GAP_TAG = "실험장 한계";
export const GAP_EXPLAIN =
  "실험장이 이 명령의 일부를 지원하지 못했어요. 에이전트의 실수가 아니에요.";

interface WithGaps {
  readonly gaps?: readonly unknown[];
}

/** How many gaps the calls of a run hit. */
export const gapCount = (calls: readonly WithGaps[] | undefined): number =>
  (calls ?? []).reduce((sum, c) => sum + (c.gaps?.length ?? 0), 0);

/** `실험장 한계 2번`, or nothing when there were none. */
export const gapLine = (calls: readonly WithGaps[] | undefined): string | undefined => {
  const n = gapCount(calls);
  return n > 0 ? `${GAP_TAG} ${n}번` : undefined;
};
