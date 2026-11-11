/**
 * The comparison the company asks for (REQ-112, ADR-0135): "지금 하는 방식" as a person wrote it, set beside what the
 * runs measured. Both sides are three numbers — steps, people, time — and the difference is what the agent took over.
 * Pure arithmetic: the same inputs give the same words every time.
 */
import type { CurrentProcessStep } from "@terrarium/core/experiments";
import { PROCESS_KIND_LABELS } from "@terrarium/core/experiments";
import type { LedgerRow, RunProcess } from "./process-steps";

export interface ProcessNumbers {
  readonly steps: number;
  readonly people: number;
  readonly seconds: number;
}

/** What a written table adds up to: its rows, its distinct roles, its minutes. */
export function baselineNumbers(steps: readonly CurrentProcessStep[]): ProcessNumbers {
  return {
    steps: steps.length,
    people: new Set(steps.map((s) => s.who.trim())).size,
    seconds: steps.reduce((sum, s) => sum + s.minutes, 0) * 60,
  };
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** The mean of the runs, to one decimal (seconds to the whole second). */
export function meanNumbers(runs: readonly RunProcess[]): ProcessNumbers {
  const n = runs.length;
  if (n === 0) return { steps: 0, people: 0, seconds: 0 };
  const mean = (pick: (r: RunProcess) => number) => runs.reduce((s, r) => s + pick(r), 0) / n;
  return {
    steps: round1(mean((r) => r.steps)),
    people: round1(mean((r) => r.people)),
    seconds: Math.round(mean((r) => r.seconds)),
  };
}

/** Measured minus written: negative is what the agent took off the table. */
export function deltaNumbers(measured: ProcessNumbers, baseline: ProcessNumbers): ProcessNumbers {
  return {
    steps: round1(measured.steps - baseline.steps),
    people: round1(measured.people - baseline.people),
    seconds: measured.seconds - baseline.seconds,
  };
}

/** The run whose time is nearest the mean (the first of them), so the ledger shows a typical run, not the best or worst. */
export function typicalRun(runs: readonly RunProcess[]): number {
  if (runs.length === 0) return -1;
  const mean = meanNumbers(runs).seconds;
  let best = 0;
  runs.forEach((r, i) => {
    if (Math.abs(r.seconds - mean) < Math.abs((runs[best] as RunProcess).seconds - mean)) best = i;
  });
  return best;
}

const REMAIN_PARTS: ReadonlyArray<readonly [LedgerRow["tag"], string]> = [
  ["physical", "사람이 현장에 가야 하는 일(물리)"],
  ["approve", "바꾸기 전 승인"],
  ["handoff", "다른 팀에 넘기고 기다리는 일"],
];

/** One line on what the remaining steps are. */
export function remainingLine(rows: readonly LedgerRow[]): string {
  const remaining = rows.filter((r) => r.tag !== "agent");
  if (remaining.length === 0)
    return "사람 손이 남은 단계가 없어요. 에이전트가 처음부터 끝까지 했어요.";
  const parts = REMAIN_PARTS.filter(([tag]) => remaining.some((r) => r.tag === tag)).map(
    ([, text]) => text,
  );
  return `남은 ${remaining.length}단계는 ${parts.join(", ")}이에요.`;
}

/** The tag's name in the ledger: the four kinds of a written step, plus the agent's own. */
export const TAG_LABELS: Readonly<Record<LedgerRow["tag"], string>> = {
  agent: "에이전트",
  physical: PROCESS_KIND_LABELS.physical,
  approve: PROCESS_KIND_LABELS.approve,
  handoff: PROCESS_KIND_LABELS.handoff,
};
