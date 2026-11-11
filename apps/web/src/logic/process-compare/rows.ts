/**
 * The "지금 하는 방식" table as a person edits it (REQ-112, ADR-0135): rows of text boxes that are not yet steps. A row
 * becomes a step when it is whole; the summary below the table counts only the whole rows, so it moves while typing.
 */

import { baselineNumbers, type ProcessNumbers } from "@terrarium/core/analysis";
import {
  type CurrentProcessStep,
  PROCESS_KIND_LABELS,
  PROCESS_MAX_MINUTES,
  PROCESS_MAX_STEPS,
  PROCESS_STEP_KINDS,
  type ProcessStepKind,
} from "@terrarium/core/experiments";

export type TimeUnit = "분" | "시간";

export interface DraftRow {
  /** Only for React keys; never saved. */
  readonly key: number;
  readonly who: string;
  readonly what: string;
  /** The number as typed. */
  readonly amount: string;
  readonly unit: TimeUnit;
  readonly kind: ProcessStepKind;
}

export const KIND_CHOICES: readonly { readonly value: ProcessStepKind; readonly label: string }[] =
  PROCESS_STEP_KINDS.map((value) => ({ value, label: PROCESS_KIND_LABELS[value] }));

export const MAX_ROWS = PROCESS_MAX_STEPS;

let nextKey = 1;

export const blankRow = (): DraftRow => ({
  key: nextKey++,
  who: "",
  what: "",
  amount: "",
  unit: "분",
  kind: "check",
});

/** Minutes shown the way people write them: 120 minutes is "2" 시간, 50 is "50" 분. */
export function rowOf(step: CurrentProcessStep): DraftRow {
  const hours = step.minutes >= 60 && step.minutes % 60 === 0;
  return {
    key: nextKey++,
    who: step.who,
    what: step.what,
    amount: String(hours ? step.minutes / 60 : step.minutes),
    unit: hours ? "시간" : "분",
    kind: step.kind,
  };
}

/** A table to start from: what was saved, or one empty row so the first thing to do is obvious. */
export const rowsOf = (steps: readonly CurrentProcessStep[]): DraftRow[] =>
  steps.length > 0 ? steps.map(rowOf) : [blankRow()];

/** The minutes a row says, or undefined when the number is not one (empty, negative, too long, not whole minutes). */
export function minutesOf(row: Pick<DraftRow, "amount" | "unit">): number | undefined {
  const text = row.amount.trim().replace(",", ".");
  if (text === "") return undefined;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return undefined;
  const minutes = Math.round(row.unit === "시간" ? n * 60 : n);
  return minutes <= PROCESS_MAX_MINUTES ? minutes : undefined;
}

export type RowIssue = "who" | "what" | "time";

/** What is missing in a row, in the order the row reads. A row with nothing in it is left out, not wrong. */
export function issuesOf(row: DraftRow): readonly RowIssue[] {
  if (isEmpty(row)) return [];
  const issues: RowIssue[] = [];
  if (row.who.trim() === "") issues.push("who");
  if (row.what.trim() === "") issues.push("what");
  if (minutesOf(row) === undefined) issues.push("time");
  return issues;
}

export const isEmpty = (row: DraftRow): boolean =>
  row.who.trim() === "" && row.what.trim() === "" && row.amount.trim() === "";

export const ISSUE_WORDS: Readonly<Record<RowIssue, string>> = {
  who: "누가 하는지 적어 주세요",
  what: "무엇을 하는지 적어 주세요",
  time: "걸리는 시간을 숫자로 적어 주세요",
};

/** The whole rows as steps, in order. */
export function stepsOf(rows: readonly DraftRow[]): CurrentProcessStep[] {
  return rows.flatMap((r) => {
    const minutes = minutesOf(r);
    if (isEmpty(r) || issuesOf(r).length > 0 || minutes === undefined) return [];
    return [{ who: r.who.trim(), what: r.what.trim(), minutes, kind: r.kind }];
  });
}

export interface Draft {
  readonly steps: readonly CurrentProcessStep[];
  readonly numbers: ProcessNumbers;
  /** Rows with something missing: saving waits until they are filled or deleted. */
  readonly incomplete: number;
  readonly canSave: boolean;
}

export function draftOf(rows: readonly DraftRow[]): Draft {
  const steps = stepsOf(rows);
  const incomplete = rows.filter((r) => issuesOf(r).length > 0).length;
  return {
    steps,
    numbers: baselineNumbers(steps),
    incomplete,
    canSave: steps.length > 0 && incomplete === 0,
  };
}

/** The same rows with one changed. */
export const change = (
  rows: readonly DraftRow[],
  key: number,
  patch: Partial<Omit<DraftRow, "key">>,
): DraftRow[] => rows.map((r) => (r.key === key ? { ...r, ...patch } : r));

/** Delete a row; the table never goes below one row. */
export function remove(rows: readonly DraftRow[], key: number): DraftRow[] {
  const left = rows.filter((r) => r.key !== key);
  return left.length > 0 ? left : [blankRow()];
}

export const add = (rows: readonly DraftRow[]): DraftRow[] =>
  rows.length >= MAX_ROWS ? [...rows] : [...rows, blankRow()];

/** Move a row one place up (-1) or down (1). */
export function move(rows: readonly DraftRow[], key: number, by: -1 | 1): DraftRow[] {
  const from = rows.findIndex((r) => r.key === key);
  const to = from + by;
  if (from < 0 || to < 0 || to >= rows.length) return [...rows];
  const out = [...rows];
  const [row] = out.splice(from, 1);
  out.splice(to, 0, row as DraftRow);
  return out;
}
