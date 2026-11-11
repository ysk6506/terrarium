/**
 * "상황마다" (ADR-0171): the same situation run again, one row each and one cell for each time it ran. It answers
 * whether the score can be trusted: a situation whose runs differ is one the agent did not settle.
 */
import { DOT_LABELS, type SeedDot, type SeedRow } from "./seed-rows";

const FINISHED = new Set(["pass", "fail"]);
const isFinished = (d: SeedDot): boolean => FINISHED.has(d.state);

/** Situations with a finished run, and how many of them came out both ways. */
export function situationCounts(rows: readonly SeedRow[]): { situations: number; split: number } {
  const done = rows.filter((r) => r.dots.some(isFinished));
  return { situations: done.length, split: done.filter((r) => r.split).length };
}

/** The sentence above the table. One run for each situation says that; repeats say how many split. */
export function situationsSentence(rows: readonly SeedRow[], repeats: number): string {
  if (repeats <= 1) return "상황마다 한 번씩 돌렸어요.";
  const { situations, split } = situationCounts(rows);
  const tail =
    situations === 0
      ? ""
      : split === 0
        ? ` ${situations}개 모두 결과가 같았어요.`
        : ` ${situations}개 중 ${split}개에서 결과가 갈렸어요.`;
  return `같은 상황을 ${repeats}번씩 돌렸어요.${tail}`;
}

/** The headers: "1번째", "2번째" …, or one "결과" column when each situation ran once. */
export function repeatHeaders(rows: readonly SeedRow[], repeats: number): string[] {
  const n = Math.max(repeats, ...rows.map((r) => r.dots.length));
  return n <= 1 ? ["결과"] : Array.from({ length: n }, (_, i) => `${i + 1}번째`);
}

/** What a cell says: "90.9 합격", "47.3 불합격", or where the run is. */
export function cellText(d: SeedDot): string {
  if (!isFinished(d) || d.score === null) return DOT_LABELS[d.state];
  return `${d.score.toFixed(1)} ${DOT_LABELS[d.state]}`;
}

/** The dot of a row for a given time it ran, if it did. */
export const cellOf = (row: SeedRow, repeat: number): SeedDot | undefined =>
  row.dots.find((d) => d.repeat === repeat);

/** The tag at the end of a row: where results differ, or that a situation never passed. */
export function rowTag(row: SeedRow): "갈렸어요" | "늘 불합격" | undefined {
  const done = row.dots.filter(isFinished);
  if (row.split) return "갈렸어요";
  return done.length >= 2 && done.every((d) => d.state === "fail") ? "늘 불합격" : undefined;
}

/** How much one situation shakes, when two of its runs are done: the line under the table. */
export function shakeLine(spread: number | undefined): string | undefined {
  return spread === undefined
    ? undefined
    : `같은 상황에서도 점수가 ±${spread.toFixed(1)}점 흔들려요.`;
}

/**
 * Where the score differences come from (ADR-0160): the sentence of the findings that says so, which the core writes
 * only when situations were repeated. The other spread finding (a standard deviation) is not shown: the suggestions
 * say what to do about a wide interval.
 */
export const sourceOfDifference = (findings: readonly string[]): string | undefined =>
  findings.find((f) => f.startsWith("점수 차이는 주로"));
