/**
 * The sentences at the head of an experiment's result (ADR-0171): how many runs passed, what the average is and how
 * far to trust it, and the quiet line of the rest. Runs are counted with "번", never "회".
 */
import type { ExperimentAnalysis } from "@terrarium/core/analysis";
import type { RunSummary } from "@terrarium/core/contract";
import type { ExperimentStatus, Progress } from "@terrarium/core/experiments";
import { formatDuration } from "@terrarium/core/kernel";
import { PASS_MARK } from "@terrarium/core/oracle";

/** What a pass takes, as the tail of a sentence about the average. */
export const PASS_TAIL = `합격은 진단을 맞히고 ${PASS_MARK}점 이상이에요.`;

/** The runs that ended with a score: what the verdict counts. */
export const finishedRuns = (runs: readonly RunSummary[]): RunSummary[] =>
  runs.filter((r) => r.status === "completed");

/** "15번 중 7번 합격했어요"; before any run is done, what is going on instead. */
export function passLine(done: number, passed: number, failed = 0): string {
  if (done > 0) return `${done}번 중 ${passed}번 합격했어요`;
  return failed > 0 ? `실행 ${failed}번이 모두 실패했어요` : "아직 끝난 실행이 없어요";
}

/** "73.5" or "70", without a trailing ".0". */
export const pointsText = (n: number): string => String(Math.round(n * 10) / 10);

/**
 * "평균 70.5점, 오차 ±19.7점. 합격은 …". The interval is the situation-level 95% one (ADR-0158); with none (one
 * situation, or a spread of nothing) the 오차 part is left out rather than shown as ±0.
 */
export function scoreLine(score: ExperimentAnalysis["score"]): string {
  if (!score) return PASS_TAIL;
  const spread = score.n > 1 && score.ci95 > 0 ? `, 오차 ±${pointsText(score.ci95)}점` : "";
  return `평균 ${score.mean.toFixed(1)}점${spread}. ${PASS_TAIL}`;
}

/** With one situation there is no spread to give, so say that the error is not known yet rather than say nothing. */
export function errorNote(score: ExperimentAnalysis["score"]): string | undefined {
  if (!score) return undefined;
  if (score.n <= 1) return "한 상황만 돌려서 오차는 아직 몰라요. 상황을 늘리면 보여요.";
  return score.ci95 === 0 ? "상황마다 점수가 같아서 오차가 없어요." : undefined;
}

/** "진단까지 30초 · 툴 3번 사용 · 토큰 1,204": only what has a value, or nothing. */
export function quietLine(a: ExperimentAnalysis): string | undefined {
  const parts = [
    a.timeToDiagnosis ? `진단까지 ${formatDuration(a.timeToDiagnosis.mean)}` : undefined,
    a.calls ? `툴 ${pointsText(a.calls.mean)}번 사용` : undefined,
    a.tokens ? `토큰 ${Math.round(a.tokens.mean).toLocaleString("ko-KR")}` : undefined,
  ].filter((p): p is string => p !== undefined);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** How far a stopped experiment got: "20번 중 1번 끝" beside what it planned (ADR-0163). */
export const stoppedLine = (p: Progress): string => `${p.total}번 중 ${p.completed}번 끝`;

/** The progress in the header: a stopped one says what it planned, one that is going says how far. */
export const progressLine = (status: ExperimentStatus, p: Progress): string =>
  status === "cancelled" ? stoppedLine(p) : `${p.finished}/${p.total}번 끝`;

/** What is still to come under a verdict that is not final: nothing once the experiment is over. */
export function pendingLine(p: Progress, status: ExperimentStatus): string | undefined {
  if (status === "cancelled") return "멈춘 실험이라 끝난 실행만 셌어요.";
  const left = p.total - p.finished;
  return left > 0 ? `아직 ${left}번이 남았어요. 끝나는 대로 이 화면이 바뀌어요.` : undefined;
}
