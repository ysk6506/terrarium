/**
 * 여러 단계 일의 체크리스트 (REQ-103, ADR-0124): 단계마다 할 일·상태가 있고, 사용자가 화면을 직접 누르면 멈춘다.
 * 순수한 값과 함수만 있고, 단계를 실제로 하는 일은 패널이 해요.
 */
import { actionById } from "./registry";
import type { ActionArgs, ActionSpec } from "./types";

export type StepStatus = "todo" | "now" | "done" | "skipped";
export type PlanStatus = "running" | "paused" | "confirm" | "done" | "cancelled" | "failed";

export interface PlanStep {
  readonly id: string;
  readonly label: string;
  readonly status: StepStatus;
  /** 한 뒤에 덧붙이는 말 ("IAP 실험용"). */
  readonly note?: string;
}

export interface Plan {
  readonly title: string;
  readonly args: ActionArgs;
  readonly steps: readonly PlanStep[];
  readonly status: PlanStatus;
  readonly error?: string;
}

/** 동작 하나가 `steps`를 가졌으면 그 체크리스트, 아니면 한 단계짜리. */
export function planOf(spec: ActionSpec, args: ActionArgs): Plan {
  const ids = spec.steps ?? [spec.id];
  return {
    title: spec.label,
    args,
    status: "running",
    steps: ids.map((id) => ({
      id,
      label: actionById(id)?.label ?? id,
      status: "todo" as const,
    })),
  };
}

export function mark(plan: Plan, index: number, status: StepStatus, note?: string): Plan {
  return {
    ...plan,
    steps: plan.steps.map((s, i) =>
      i === index ? { ...s, status, ...(note ? { note } : {}) } : s,
    ),
  };
}

export const withStatus = (plan: Plan, status: PlanStatus, error?: string): Plan => ({
  ...plan,
  status,
  ...(error ? { error } : {}),
});

/** 다음에 할 단계의 자리. 모두 했으면 -1. */
export const nextStep = (plan: Plan): number =>
  plan.steps.findIndex((s) => s.status === "todo" || s.status === "now");

export const isLive = (plan: Plan | undefined): plan is Plan =>
  plan !== undefined &&
  (plan.status === "running" || plan.status === "paused" || plan.status === "confirm");
