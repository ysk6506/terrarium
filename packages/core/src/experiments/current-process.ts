/**
 * "지금 하는 방식" (REQ-112, ADR-0135): the steps people take today for the situation a scenario plays, as the person
 * wrote them. It is what the company's E2E workflow count starts from (steps, people, time) and what the measured side
 * of the comparison is set beside. These are written values, never measurements: the screens always say so.
 */

/** What kind of step it is: a check, an approval, work that needs a person on site, or handing over to another team. */
export type ProcessStepKind = "check" | "approve" | "physical" | "handoff";

export const PROCESS_STEP_KINDS: readonly ProcessStepKind[] = [
  "check",
  "approve",
  "physical",
  "handoff",
];

export const PROCESS_KIND_LABELS: Readonly<Record<ProcessStepKind, string>> = {
  check: "확인",
  approve: "승인",
  physical: "물리",
  handoff: "넘기기",
};

export interface CurrentProcessStep {
  /** The role that does it ("모니터링 담당"); two steps with the same text are the same person. */
  readonly who: string;
  readonly what: string;
  /** How long it takes, in minutes. */
  readonly minutes: number;
  readonly kind: ProcessStepKind;
}

export interface CurrentProcessRecord {
  /** The scenario's id: a scenario has one table. */
  readonly id: string;
  /** Who wrote it first; only they change it (full permissions come later). */
  readonly owner: string;
  readonly steps: readonly CurrentProcessStep[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The longest table and the longest single step the contract accepts. */
export const PROCESS_MAX_STEPS = 30;
export const PROCESS_MAX_MINUTES = 43_200;
